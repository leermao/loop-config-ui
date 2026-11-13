<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';

import { formatDuration, formatRelative } from '../lib/format.js';

const PipelineScene = defineAsyncComponent(() => import('./PipelineScene.vue'));

const props = defineProps({
  currentTask: { type: Object, default: null },
  sync: { type: Object, default: null },
  status: { type: String, default: 'stopped' }
});

const emit = defineEmits(['open-stage']);

const stages = [
  { code: 'SYNC', label: '同步', description: '同步队列与基线，确认本轮工作区起点。', target: 'logs' },
  { code: 'DESIGN', label: '设计', description: '定位缺陷路径，整理修复方案与影响面。', target: 'tasks' },
  { code: 'FIX', label: '修复', description: '在独立 worktree 中执行代码修复。', target: 'tasks' },
  { code: 'TEST', label: '测试', description: '运行回归用例与构建，验证修复结果。', target: 'logs' },
  { code: 'REVIEW', label: 'Review', description: '检查改动质量与遗漏，补齐 review 发现。', target: 'tasks' },
  { code: 'COMMIT', label: 'Commit', description: '整理提交，并记录本轮修复证据。', target: 'tasks' },
  { code: 'SETTLE', label: '结算', description: '回收任务结果，更新队列与事件流。', target: 'logs' }
];

const narrowMedia = window.matchMedia('(max-width: 720px)');
const isNarrow = ref(narrowMedia.matches);
const viewMode = ref('3d');
const effectiveView = computed(() => isNarrow.value ? 'flat' : viewMode.value);

const activeIndex = computed(() => {
  const stage = props.currentTask?.stage || '';
  if (!stage) return -1;
  if (stage.includes('设计')) return 1;
  if (/修复|codex/i.test(stage)) return 2;
  if (/测试/.test(stage)) return 3;
  if (/review/i.test(stage)) return 4;
  if (/commit/i.test(stage)) return 5;
  if (/结算/.test(stage)) return 6;
  return 0;
});

const syncLabel = computed(() => {
  if (!props.sync?.lastSyncAt) return '尚未同步';
  return `上次同步 ${formatRelative(props.sync.lastSyncAt)}`;
});

function handleNarrowChange(event) {
  isNarrow.value = event.matches;
}

onMounted(() => {
  isNarrow.value = narrowMedia.matches;
  narrowMedia.addEventListener('change', handleNarrowChange);
});

onBeforeUnmount(() => {
  narrowMedia.removeEventListener('change', handleNarrowChange);
});
</script>

<template>
  <section class="stage-panel" aria-label="修复流水线阶段">
    <div class="stage-meta">
      <div>
        <span class="eyebrow">Repair line</span>
        <strong>{{ currentTask ? `${currentTask.id} · ${currentTask.stage}` : '等待下一条修复任务' }}</strong>
      </div>
      <div class="stage-meta-right">
        <span class="mono-small">{{ syncLabel }}</span>
        <span v-if="currentTask?.elapsedSeconds != null" class="elapsed">
          本阶段 {{ formatDuration(currentTask.elapsedSeconds) }}
        </span>
        <div v-if="!isNarrow" class="view-switch" role="group" aria-label="流水线视图">
          <button
            type="button"
            :class="{ active: effectiveView === 'flat' }"
            :aria-pressed="effectiveView === 'flat'"
            @click="viewMode = 'flat'"
          >
            轨道
          </button>
          <button
            type="button"
            :class="{ active: effectiveView === '3d' }"
            :aria-pressed="effectiveView === '3d'"
            @click="viewMode = '3d'"
          >
            3D
          </button>
        </div>
      </div>
    </div>
    <div class="stage-shell">
      <template v-if="effectiveView === '3d'">
        <Suspense>
          <PipelineScene
            :stages="stages"
            :active-index="activeIndex"
            :current-task="currentTask"
            :status="status"
            @open-stage="emit('open-stage', $event)"
          />
          <template #fallback>
            <div class="scene-loading" role="status">正在装配 3D 工位…</div>
          </template>
        </Suspense>
      </template>
      <ol v-else class="stage-rail" :class="`status-${status}`">
        <li
          v-for="(stage, index) in stages"
          :key="stage.code"
          class="stage-node"
          :class="{
            complete: activeIndex > index,
            active: activeIndex === index,
            pending: activeIndex < index || activeIndex === -1
          }"
          :aria-current="activeIndex === index ? 'step' : undefined"
        >
          <span class="node-marker">
            <span class="node-index">{{ String(index + 1).padStart(2, '0') }}</span>
          </span>
          <span class="node-copy">
            <span class="node-code">{{ stage.code }}</span>
            <span class="node-label">{{ stage.label }}</span>
          </span>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.stage-panel {
  position: relative;
  overflow: hidden;
  padding: 21px 22px 19px;
  border: 1px solid var(--line-strong);
  border-top: 2px solid var(--copper);
  border-radius: var(--radius);
  background:
    linear-gradient(90deg, rgba(214, 90, 52, 0.07), transparent 28%),
    rgba(248, 246, 239, 0.94);
  box-shadow: var(--shadow-panel);
}

.stage-panel::after {
  position: absolute;
  top: 0;
  right: 0;
  width: 150px;
  height: 100%;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 7px,
    rgba(28, 39, 36, 0.035) 7px,
    rgba(28, 39, 36, 0.035) 8px
  );
  content: "";
  pointer-events: none;
}

.stage-meta {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}

.stage-meta strong {
  display: block;
  font-family: var(--font-display);
  font-size: 22px;
  line-height: 1.15;
}

.stage-meta .eyebrow {
  margin-bottom: 2px;
}

.stage-meta-right {
  display: grid;
  justify-items: end;
  gap: 4px;
  color: var(--ink-muted);
  font-size: 12.5px;
}

.elapsed {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.view-switch {
  display: inline-flex;
  padding: 2px;
  margin-top: 2px;
  border: 1px solid var(--line);
  background: rgba(241, 239, 232, 0.74);
}

.view-switch button {
  min-width: 40px;
  min-height: 26px;
  padding: 3px 8px;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.view-switch button:hover {
  color: var(--ink);
}

.view-switch button.active {
  background: var(--ink);
  color: var(--paper-light);
}

.stage-shell {
  position: relative;
  z-index: 1;
}

.scene-loading {
  display: grid;
  place-items: center;
  min-height: 286px;
  border: 1px solid var(--line);
  background: rgba(248, 246, 239, 0.72);
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.stage-rail {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0;
  padding: 0;
  margin: 0;
  list-style: none;
}

.stage-node {
  position: relative;
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
}

.stage-node::before {
  position: absolute;
  top: 12px;
  right: 0;
  left: 24px;
  height: 1px;
  background: var(--line);
  content: "";
}

.stage-node:last-child::before {
  display: none;
}

.stage-node.complete::before {
  background: var(--copper);
}

.stage-node.active::before {
  background: linear-gradient(90deg, var(--signal), var(--line));
}

.node-marker {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--paper-light);
}

.node-index {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.stage-node.complete .node-marker {
  border-color: var(--copper);
  background: var(--copper);
}

.stage-node.complete .node-index {
  color: white;
}

.stage-node.active .node-marker {
  border-color: var(--signal);
  background: var(--signal);
  box-shadow: 0 0 0 5px rgba(214, 90, 52, 0.13);
}

.stage-node.active .node-index {
  color: white;
}

.stage-node.active .node-marker::after {
  position: absolute;
  inset: -6px;
  border: 1px solid var(--signal);
  border-radius: 50%;
  content: "";
  animation: stage-pulse 2.4s ease-out infinite;
}

.node-copy {
  display: grid;
  gap: 0;
  min-width: 0;
}

.node-code {
  overflow: hidden;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
}

.node-label {
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-node.active .node-code,
.stage-node.active .node-label {
  color: var(--signal-dark);
}

.stage-node.pending {
  opacity: 0.62;
}

@keyframes stage-pulse {
  0% {
    opacity: 0.65;
    transform: scale(0.8);
  }
  80%,
  100% {
    opacity: 0;
    transform: scale(1.5);
  }
}

@media (max-width: 760px) {
  .stage-panel {
    padding: 16px;
  }

  .stage-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .stage-meta-right {
    justify-items: start;
  }

  .stage-rail {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    row-gap: 16px;
  }

  .stage-node:nth-child(4)::before {
    display: none;
  }
}
</style>
