<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Pause, Play } from '@lucide/vue';

import { formatDuration } from '../lib/format.js';

const props = defineProps({
  stages: { type: Array, required: true },
  activeIndex: { type: Number, default: -1 },
  currentTask: { type: Object, default: null },
  status: { type: String, default: 'stopped' }
});

const emit = defineEmits(['open-stage']);
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const sceneRef = ref(null);
const viewportRef = ref(null);
const reducedMotion = ref(motionQuery.matches);
const motionEnabled = ref(!motionQuery.matches);
const sceneVisible = ref(true);
const pageVisible = ref(!document.hidden);
const sweepActive = ref(false);
const sweepKey = ref(0);
const selectedIndex = ref(props.activeIndex >= 0 ? props.activeIndex : 0);
const motes = Array.from({ length: 26 }, (_, index) => ({
  id: index,
  left: (index * 37 + 13) % 100,
  top: (index * 53 + 9) % 100,
  size: 1 + (index % 3),
  delay: -((index * 0.63) % 8),
  duration: 5.6 + (index % 6) * 1.15
}));

let motionObserver = null;
let sweepTimer = null;
let pointerFrame = 0;
let pointerTarget = null;

const motionActive = computed(() => (
  motionEnabled.value
  && sceneVisible.value
  && pageVisible.value
  && !reducedMotion.value
));

const selectedStage = computed(() => props.stages[selectedIndex.value] || props.stages[0] || null);
const selectedState = computed(() => stageState(selectedIndex.value));
const stateLabel = computed(() => ({
  complete: '已完成',
  active: '当前阶段',
  pending: '待执行'
}[selectedState.value] || '待执行'));
const actionLabel = computed(() => selectedStage.value?.target === 'tasks' ? '打开任务案卷' : '打开日志');
const sceneLabel = computed(() => props.currentTask
  ? `${props.currentTask.id} / ${props.currentTask.stage}`
  : '等待下一条修复任务');
const elapsedLabel = computed(() => props.currentTask?.elapsedSeconds != null
  ? `本阶段 ${formatDuration(props.currentTask.elapsedSeconds)}`
  : '工位待命');

watch(() => props.activeIndex, (next) => {
  if (next >= 0) selectedIndex.value = next;
});

watch(() => props.stages.length, (length) => {
  selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, length - 1));
});

watch(() => props.activeIndex, (next, previous) => {
  if (next === previous || next < 0 || !motionActive.value) return;
  sweepKey.value += 1;
  sweepActive.value = true;
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    sweepActive.value = false;
  }, 950);
});

watch(motionActive, (active) => {
  if (!active) resetPointer();
});

function stageState(index) {
  if (props.activeIndex < 0) return 'pending';
  if (index < props.activeIndex) return 'complete';
  if (index === props.activeIndex) return 'active';
  return 'pending';
}

function selectStage(index) {
  selectedIndex.value = index;
}

function openSelectedStage() {
  if (!selectedStage.value) return;
  emit('open-stage', {
    ...selectedStage.value,
    state: selectedState.value
  });
}

function toggleMotion() {
  if (reducedMotion.value) return;
  motionEnabled.value = !motionEnabled.value;
  if (!motionEnabled.value) resetPointer();
}

function handlePointerMove(event) {
  if (!motionActive.value || !viewportRef.value) return;
  const rect = viewportRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  pointerTarget = {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  };
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    if (!pointerTarget || !viewportRef.value) return;
    const { x, y } = pointerTarget;
    const style = viewportRef.value.style;
    style.setProperty('--scene-rotate-x', `${((0.5 - y) * 4).toFixed(2)}deg`);
    style.setProperty('--scene-rotate-z', `${((x - 0.5) * 5).toFixed(2)}deg`);
    style.setProperty('--scene-shift-x', `${((x - 0.5) * 10).toFixed(2)}px`);
    style.setProperty('--scene-shift-y', `${((y - 0.5) * 6).toFixed(2)}px`);
    style.setProperty('--scene-spot-x', `${(x * 100).toFixed(1)}%`);
    style.setProperty('--scene-spot-y', `${(y * 100).toFixed(1)}%`);
  });
}

function resetPointer() {
  if (pointerFrame) {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
  }
  pointerTarget = null;
  if (!viewportRef.value) return;
  const style = viewportRef.value.style;
  style.setProperty('--scene-rotate-x', '0deg');
  style.setProperty('--scene-rotate-z', '0deg');
  style.setProperty('--scene-shift-x', '0px');
  style.setProperty('--scene-shift-y', '0px');
  style.setProperty('--scene-spot-x', '58%');
  style.setProperty('--scene-spot-y', '42%');
}

function handleMotionPreference(event) {
  reducedMotion.value = event.matches;
  motionEnabled.value = !event.matches;
  if (event.matches) resetPointer();
}

function handleVisibility() {
  pageVisible.value = !document.hidden;
}

onMounted(() => {
  motionQuery.addEventListener('change', handleMotionPreference);
  document.addEventListener('visibilitychange', handleVisibility);
  if ('IntersectionObserver' in window && sceneRef.value) {
    motionObserver = new IntersectionObserver(([entry]) => {
      sceneVisible.value = entry.isIntersecting;
    }, { threshold: 0.05 });
    motionObserver.observe(sceneRef.value);
  }
});

onBeforeUnmount(() => {
  motionQuery.removeEventListener('change', handleMotionPreference);
  document.removeEventListener('visibilitychange', handleVisibility);
  motionObserver?.disconnect();
  if (sweepTimer) clearTimeout(sweepTimer);
  resetPointer();
});
</script>

<template>
  <section
    ref="sceneRef"
    class="pipeline-scene"
    :class="[`status-${status}`, { 'motion-paused': !motionActive }]"
    aria-label="三维修复流水线"
  >
    <div class="scene-caption">
      <span>{{ sceneLabel }}</span>
      <div class="scene-caption-tools">
        <span class="scene-hint">{{ elapsedLabel }} · 点选工位查看阶段证据</span>
        <button
          class="motion-toggle"
          type="button"
          :aria-pressed="motionEnabled"
          :disabled="reducedMotion"
          :title="reducedMotion ? '系统已启用减少动效' : motionEnabled ? '暂停场景动效' : '播放场景动效'"
          @click="toggleMotion"
        >
          <Pause v-if="motionEnabled" :size="10" aria-hidden="true" />
          <Play v-else :size="10" aria-hidden="true" />
          {{ reducedMotion ? '已减少动效' : motionEnabled ? '动效开' : '动效关' }}
        </button>
      </div>
    </div>

    <div
      ref="viewportRef"
      class="scene-viewport"
      aria-hidden="true"
      @pointermove="handlePointerMove"
      @pointerleave="resetPointer"
    >
      <div class="scene-aura"></div>
      <div class="scene-horizon"></div>
      <div class="scene-grid"></div>
      <div class="scene-motes">
        <span
          v-for="mote in motes"
          :key="mote.id"
          class="scene-mote"
          :style="{
            left: `${mote.left}%`,
            top: `${mote.top}%`,
            '--mote-size': `${mote.size}px`,
            '--mote-delay': `${mote.delay.toFixed(2)}s`,
            '--mote-duration': `${mote.duration.toFixed(2)}s`
          }"
        ></span>
      </div>
      <div class="scene-deck">
        <span class="scene-rail"></span>
        <span
          v-for="packet in 3"
          :key="`packet-${packet}`"
          class="rail-packet"
          :style="{ '--packet-delay': `${(packet - 1) * -1.6}s` }"
        ></span>
        <span
          v-for="(stage, index) in stages"
          :key="stage.code"
          class="station-slab"
          :class="[
            `is-${stageState(index)}`,
            { 'is-selected': selectedIndex === index }
          ]"
          :style="{ '--stage-index': index }"
        >
          <span v-if="stageState(index) === 'active'" class="slab-beacon" aria-hidden="true">
            {{ stage.label }}
          </span>
          <span class="slab-top">
            <span class="slab-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="slab-code">{{ stage.code }}</span>
            <span class="slab-light"></span>
          </span>
        </span>
      </div>
      <span v-if="sweepActive" :key="sweepKey" class="scene-stage-sweep"></span>
    </div>

    <div class="stage-axis" role="group" aria-label="选择流水线工位">
      <button
        v-for="(stage, index) in stages"
        :key="stage.code"
        class="axis-node"
        :class="[
          `is-${stageState(index)}`,
          { 'is-selected': selectedIndex === index }
        ]"
        type="button"
        :aria-pressed="selectedIndex === index"
        :aria-label="`${stage.code} ${stage.label}，${stageState(index) === 'active' ? '当前阶段' : stageState(index) === 'complete' ? '已完成' : '待执行'}`"
        @click="selectStage(index)"
      >
        <span class="axis-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <span class="axis-code">{{ stage.code }}</span>
        <span class="axis-label">{{ stage.label }}</span>
      </button>
    </div>

    <div class="inspector-shell">
      <Transition name="inspector" mode="out-in">
        <div v-if="selectedStage" :key="selectedStage.code" class="stage-inspector" aria-live="polite">
          <div class="inspector-stage">
            <span>{{ selectedStage.code }}</span>
            <strong>{{ selectedStage.label }}</strong>
          </div>
          <p>{{ selectedStage.description }}</p>
          <span class="state-chip" :class="`state-${selectedState}`">{{ stateLabel }}</span>
          <button class="button button-small inspector-action" type="button" @click="openSelectedStage">
            {{ actionLabel }}
          </button>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.pipeline-scene {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 30%),
    rgba(248, 246, 239, 0.88);
}

.pipeline-scene.motion-paused *,
.pipeline-scene.motion-paused *::before,
.pipeline-scene.motion-paused *::after {
  animation-play-state: paused !important;
}

.scene-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 34px;
  padding: 8px 13px;
  border-bottom: 1px solid var(--line-faint);
}

.scene-caption > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  color: var(--ink-soft);
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.075em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.scene-caption > span:first-child::before {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--signal);
  box-shadow: 0 0 0 4px rgba(214, 90, 52, 0.1);
  content: "";
}

.status-stopped .scene-caption > span:first-child::before {
  background: var(--ink-muted);
  box-shadow: none;
}

.status-error .scene-caption > span:first-child::before,
.status-halted .scene-caption > span:first-child::before {
  background: var(--danger);
  box-shadow: 0 0 0 4px rgba(161, 61, 61, 0.1);
}

.scene-hint {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 11px;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scene-caption-tools {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  min-width: 0;
}

.motion-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-small);
  background: rgba(248, 246, 239, 0.72);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition:
    color var(--transition),
    border-color var(--transition),
    background var(--transition);
}

.motion-toggle:hover:not(:disabled) {
  border-color: rgba(47, 117, 101, 0.42);
  background: var(--copper-light);
  color: var(--copper-dark);
}

.motion-toggle[aria-pressed="true"] {
  border-color: rgba(47, 117, 101, 0.32);
  color: var(--copper-dark);
}

.motion-toggle:disabled {
  cursor: default;
  opacity: 0.68;
}

.scene-viewport {
  position: relative;
  --scene-rotate-x: 0deg;
  --scene-rotate-z: 0deg;
  --scene-shift-x: 0px;
  --scene-shift-y: 0px;
  --scene-spot-x: 58%;
  --scene-spot-y: 42%;
  height: 214px;
  overflow: hidden;
  isolation: isolate;
  perspective: 980px;
  perspective-origin: 50% 16%;
  background:
    radial-gradient(circle at 50% 58%, rgba(47, 117, 101, 0.09), transparent 42%),
    linear-gradient(180deg, rgba(28, 39, 36, 0.015), transparent 55%);
}

.scene-viewport::after {
  position: absolute;
  z-index: 5;
  right: 12px;
  bottom: 10px;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.1em;
  content: "WORKCELL / ISO 03";
  opacity: 0.52;
}

.scene-aura {
  position: absolute;
  z-index: 0;
  inset: -14%;
  background:
    radial-gradient(
      circle at var(--scene-spot-x) var(--scene-spot-y),
      rgba(214, 90, 52, 0.17),
      transparent 19%
    ),
    radial-gradient(circle at 60% 62%, rgba(47, 117, 101, 0.16), transparent 34%);
  filter: blur(10px);
  pointer-events: none;
  animation: aura-breathe 8.5s ease-in-out infinite alternate;
}

.scene-horizon {
  position: absolute;
  z-index: 1;
  top: 22%;
  right: 7%;
  left: 7%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(47, 117, 101, 0.2),
    rgba(214, 90, 52, 0.42),
    rgba(47, 117, 101, 0.2),
    transparent
  );
  box-shadow: 0 0 22px rgba(214, 90, 52, 0.13);
  opacity: 0.58;
  pointer-events: none;
  animation: horizon-glow 7s ease-in-out infinite alternate;
}

.scene-grid {
  position: absolute;
  z-index: 1;
  inset: -24% -12% -32%;
  background:
    linear-gradient(rgba(28, 39, 36, 0.075) 1px, transparent 1px),
    linear-gradient(90deg, rgba(28, 39, 36, 0.075) 1px, transparent 1px),
    radial-gradient(circle at center, rgba(47, 117, 101, 0.14), transparent 62%);
  background-size: 42px 42px, 42px 42px, auto;
  transform: perspective(680px) rotateX(64deg) translateY(19%);
  transform-origin: center 52%;
  opacity: 0.62;
  animation: grid-drift 24s linear infinite;
  -webkit-mask-image: linear-gradient(to bottom, transparent 5%, black 34%, black 70%, transparent 96%);
  mask-image: linear-gradient(to bottom, transparent 5%, black 34%, black 70%, transparent 96%);
}

.scene-motes {
  position: absolute;
  z-index: 2;
  inset: 0;
  pointer-events: none;
}

.scene-mote {
  position: absolute;
  width: var(--mote-size);
  height: var(--mote-size);
  border-radius: 50%;
  background: rgba(47, 117, 101, 0.55);
  box-shadow: 0 0 8px rgba(47, 117, 101, 0.34);
  opacity: 0.5;
  animation: mote-drift var(--mote-duration) ease-in-out var(--mote-delay) infinite alternate;
  will-change: transform, opacity;
}

.scene-mote:nth-child(3n) {
  background: rgba(214, 90, 52, 0.58);
  box-shadow: 0 0 9px rgba(214, 90, 52, 0.32);
}

.scene-mote:nth-child(4n) {
  background: rgba(178, 128, 45, 0.5);
  box-shadow: 0 0 8px rgba(178, 128, 45, 0.28);
}

.scene-deck {
  position: absolute;
  z-index: 3;
  right: 4%;
  bottom: 12px;
  left: 4%;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2.1%;
  align-items: center;
  height: 116px;
  transform:
    translate3d(var(--scene-shift-x), var(--scene-shift-y), 0)
    rotateX(calc(58deg + var(--scene-rotate-x)))
    rotateZ(calc(-7deg + var(--scene-rotate-z)));
  transform-origin: 50% 100%;
  transform-style: preserve-3d;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
  animation:
    deck-boot 760ms cubic-bezier(0.22, 1, 0.36, 1) both,
    deck-breathe 9.5s ease-in-out 1.1s infinite alternate;
}

.scene-deck::after {
  position: absolute;
  inset: -8% 0;
  background: linear-gradient(
    90deg,
    transparent 42%,
    rgba(214, 90, 52, 0.12) 50%,
    transparent 58%
  );
  content: "";
  pointer-events: none;
  transform: translateZ(-8px);
  animation: scene-scan 7.5s linear infinite;
}

.scene-rail {
  position: absolute;
  top: 50%;
  right: -1.5%;
  left: -1.5%;
  height: 6px;
  border: 1px solid rgba(28, 39, 36, 0.28);
  background:
    repeating-linear-gradient(90deg, rgba(248, 246, 239, 0.24) 0 11px, transparent 11px 18px),
    linear-gradient(90deg, var(--copper), var(--line-strong));
  box-shadow:
    5px 6px 0 rgba(28, 39, 36, 0.12),
    0 9px 20px rgba(28, 39, 36, 0.12);
  transform: translateY(-50%) translateZ(-8px);
}

.scene-rail::after {
  position: absolute;
  top: 50%;
  left: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--signal);
  box-shadow:
    0 0 0 4px rgba(214, 90, 52, 0.18),
    0 0 18px 5px rgba(214, 90, 52, 0.34);
  content: "";
  opacity: 0;
  transform: translate(-50%, -50%);
}

.status-running .scene-rail::after {
  opacity: 1;
  animation: rail-run 5.6s linear infinite;
}

.rail-packet {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 0;
  width: 5px;
  height: 5px;
  border: 1px solid rgba(255, 248, 242, 0.7);
  border-radius: 50%;
  background: var(--signal);
  box-shadow:
    0 0 0 3px rgba(214, 90, 52, 0.1),
    0 0 13px 4px rgba(214, 90, 52, 0.3);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) translateZ(3px);
}

.status-running .rail-packet {
  opacity: 1;
  animation: rail-packet 4.8s linear var(--packet-delay) infinite;
}

.station-slab {
  position: relative;
  --slab-opacity: 1;
  display: block;
  height: 72px;
  border: 1px solid var(--line-strong);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.68), transparent 48%),
    var(--paper-light);
  color: var(--ink-muted);
  box-shadow:
    7px 8px 0 var(--paper-deep),
    15px 17px 26px rgba(28, 39, 36, 0.13),
    inset 0 1px 0 rgba(255, 255, 255, 0.68);
  transform: translateZ(0);
  transform-style: preserve-3d;
  opacity: var(--slab-opacity);
  transition:
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow var(--transition),
    background var(--transition),
    border-color var(--transition),
    opacity var(--transition);
  will-change: transform;
  animation: slab-boot 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--stage-index) * 55ms + 120ms);
}

.station-slab::before {
  position: absolute;
  inset: 5px;
  border: 1px solid var(--line-faint);
  content: "";
  pointer-events: none;
}

.station-slab.is-complete {
  border-color: #1b4f43;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.16), transparent 48%),
    linear-gradient(145deg, #367f6e, #235b4d);
  color: var(--paper-light);
  box-shadow:
    7px 8px 0 #17453a,
    15px 17px 26px rgba(28, 39, 36, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.station-slab.is-active {
  z-index: 3;
  border-color: #87351f;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.2), transparent 48%),
    linear-gradient(145deg, #df653e, #ad4527);
  color: #fff8f2;
  box-shadow:
    8px 9px 0 #87351f,
    20px 24px 34px rgba(28, 39, 36, 0.24),
    0 0 0 4px rgba(214, 90, 52, 0.14),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
  transform: translateZ(24px);
}

.station-slab.is-active::after {
  position: absolute;
  inset: -8px;
  border: 1px solid rgba(255, 248, 242, 0.72);
  content: "";
  pointer-events: none;
  transform: translateZ(2px);
  animation: active-ring 2.8s ease-out infinite;
}

.station-slab.is-pending {
  --slab-opacity: 0.68;
}

.station-slab.is-selected {
  outline: 2px solid var(--signal);
  outline-offset: 3px;
}

.station-slab.is-selected.is-active {
  outline-color: var(--paper-light);
}

.station-slab.is-pending.is-selected {
  --slab-opacity: 1;
}

.slab-beacon {
  position: absolute;
  z-index: 5;
  top: -22px;
  right: 7px;
  padding: 2px 6px;
  border: 1px solid rgba(255, 248, 242, 0.22);
  background: var(--ink);
  color: var(--paper-light);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.45;
  white-space: nowrap;
  box-shadow:
    0 5px 12px rgba(28, 39, 36, 0.18),
    0 0 0 3px rgba(214, 90, 52, 0.09);
  transform: translateZ(30px);
  animation: beacon-float 3.2s ease-in-out infinite;
}

.slab-beacon::after {
  position: absolute;
  top: 100%;
  right: 9px;
  width: 1px;
  height: 8px;
  background: rgba(28, 39, 36, 0.42);
  content: "";
}

.slab-top {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: 1fr auto;
  gap: 3px;
  height: 100%;
  padding: 9px 10px;
}

.slab-index {
  align-self: start;
  font-family: var(--font-display);
  font-size: 23px;
  font-weight: 800;
  line-height: 0.88;
  letter-spacing: -0.035em;
}

.slab-code {
  align-self: end;
  font-family: var(--font-mono);
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.slab-light {
  align-self: start;
  justify-self: end;
  width: 7px;
  height: 7px;
  margin-top: 2px;
  border: 1px solid currentColor;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.56;
}

.station-slab.is-complete .slab-light {
  opacity: 0.9;
}

.station-slab.is-active .slab-light {
  opacity: 1;
  box-shadow:
    0 0 0 3px rgba(255, 248, 242, 0.16),
    0 0 14px rgba(255, 248, 242, 0.45);
  animation: lamp-pulse 2.2s ease-out infinite;
}

.scene-stage-sweep {
  position: absolute;
  z-index: 4;
  top: 7%;
  bottom: 7%;
  left: -24%;
  width: 22%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(214, 90, 52, 0.05) 26%,
    rgba(255, 248, 242, 0.58) 50%,
    rgba(214, 90, 52, 0.13) 74%,
    transparent
  );
  filter: blur(8px);
  mix-blend-mode: screen;
  pointer-events: none;
  transform: skewX(-10deg);
  animation: stage-sweep 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.stage-axis {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: rgba(241, 239, 232, 0.58);
}

.axis-node {
  position: relative;
  display: grid;
  align-content: start;
  gap: 0;
  min-width: 0;
  min-height: 54px;
  padding: 7px 9px 8px;
  border: 0;
  border-left: 1px solid var(--line-faint);
  background: transparent;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition:
    color var(--transition),
    background var(--transition),
    box-shadow var(--transition);
}

.axis-node:first-child {
  border-left: 0;
}

.axis-node::before {
  position: absolute;
  top: -1px;
  right: 0;
  left: 0;
  height: 2px;
  background: transparent;
  content: "";
}

.axis-node:hover {
  background: rgba(255, 255, 255, 0.42);
}

.axis-node.is-complete::before {
  background: var(--copper);
}

.axis-node.is-active {
  background: rgba(214, 90, 52, 0.06);
}

.axis-node.is-active::before {
  background: var(--signal);
}

.axis-node.is-selected {
  box-shadow: inset 0 0 0 1px var(--signal);
}

.axis-index {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8.5px;
  line-height: 1.3;
}

.axis-code {
  overflow: hidden;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.axis-label {
  overflow: hidden;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.axis-node.is-active .axis-code,
.axis-node.is-active .axis-label {
  color: var(--signal-dark);
}

.axis-node.is-selected .axis-index {
  color: var(--signal-dark);
}

.inspector-shell {
  min-height: 58px;
}

.stage-inspector {
  display: grid;
  grid-template-columns: auto minmax(160px, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  min-height: 58px;
  padding: 10px 13px;
  background: rgba(248, 246, 239, 0.78);
}

.inspector-enter-active {
  transition:
    opacity 180ms ease,
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.inspector-leave-active {
  transition: opacity 90ms ease;
}

.inspector-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

.inspector-leave-to {
  opacity: 0;
}

.inspector-stage {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding-right: 14px;
  border-right: 1px solid var(--line);
  white-space: nowrap;
}

.inspector-stage span {
  color: var(--signal-dark);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.inspector-stage strong {
  font-family: var(--font-display);
  font-size: 18px;
  line-height: 1;
}

.stage-inspector p {
  min-width: 0;
  margin: 0;
  color: var(--ink-muted);
  font-size: 11.5px;
  line-height: 1.45;
}

.state-chip {
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: var(--radius-small);
  color: var(--ink-muted);
  background: rgba(241, 239, 232, 0.7);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.state-chip.state-complete {
  border-color: rgba(47, 117, 101, 0.34);
  color: var(--copper-dark);
  background: var(--copper-light);
}

.state-chip.state-active {
  border-color: rgba(214, 90, 52, 0.34);
  color: var(--signal-dark);
  background: rgba(214, 90, 52, 0.08);
}

.inspector-action {
  white-space: nowrap;
}

@keyframes deck-boot {
  from {
    opacity: 0.25;
    filter: blur(7px) saturate(0.72);
  }
  to {
    opacity: 1;
    filter: none;
  }
}

@keyframes deck-breathe {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -3px;
  }
}

@keyframes grid-drift {
  to {
    background-position: 84px 84px, 84px 84px, center;
  }
}

@keyframes aura-breathe {
  from {
    opacity: 0.56;
    transform: scale(1);
  }
  to {
    opacity: 0.92;
    transform: scale(1.04);
  }
}

@keyframes horizon-glow {
  from {
    opacity: 0.3;
    transform: scaleX(0.92);
  }
  to {
    opacity: 0.72;
    transform: scaleX(1);
  }
}

@keyframes mote-drift {
  from {
    opacity: 0.2;
    translate: 0 6px;
    scale: 0.8;
  }
  to {
    opacity: 0.82;
    translate: 8px -12px;
    scale: 1.12;
  }
}

@keyframes rail-packet {
  0% {
    left: 0;
    opacity: 0;
  }
  8%,
  88% {
    opacity: 1;
  }
  100% {
    left: 100%;
    opacity: 0;
  }
}

@keyframes slab-boot {
  from {
    opacity: 0;
    translate: 0 14px;
    filter: blur(4px);
  }
  to {
    opacity: var(--slab-opacity);
    translate: 0 0;
    filter: none;
  }
}

@keyframes active-ring {
  0% {
    opacity: 0.52;
    transform: translateZ(2px) scale(0.96);
  }
  76%,
  100% {
    opacity: 0;
    transform: translateZ(2px) scale(1.06);
  }
}

@keyframes beacon-float {
  0%,
  100% {
    transform: translateZ(30px) translateY(0);
  }
  50% {
    transform: translateZ(30px) translateY(-5px);
  }
}

@keyframes stage-sweep {
  from {
    transform: translateX(-40%) skewX(-10deg);
  }
  to {
    transform: translateX(580%) skewX(-10deg);
  }
}

@keyframes rail-run {
  from {
    left: 0;
  }
  to {
    left: 100%;
  }
}

@keyframes scene-scan {
  from {
    transform: translateX(-76%) translateZ(-8px);
  }
  to {
    transform: translateX(76%) translateZ(-8px);
  }
}

@keyframes lamp-pulse {
  0% {
    box-shadow:
      0 0 0 0 rgba(255, 248, 242, 0.4),
      0 0 14px rgba(255, 248, 242, 0.38);
  }
  72%,
  100% {
    box-shadow:
      0 0 0 8px rgba(255, 248, 242, 0),
      0 0 14px rgba(255, 248, 242, 0.2);
  }
}

@media (max-width: 900px) {
  .stage-inspector {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .stage-inspector p {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .inspector-action {
    grid-column: 3;
    grid-row: 1;
  }

  .state-chip {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-aura,
  .scene-horizon,
  .scene-grid,
  .scene-deck,
  .scene-deck::after,
  .scene-mote,
  .scene-rail::after,
  .rail-packet,
  .station-slab,
  .station-slab.is-active::after,
  .slab-beacon,
  .station-slab.is-active .slab-light,
  .scene-stage-sweep {
    animation: none;
  }

  .scene-deck {
    transition: none;
  }
}
</style>
