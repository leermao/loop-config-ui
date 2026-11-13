<script setup>
import { computed } from 'vue';

import { formatDuration, formatRelative } from '../lib/format.js';

const props = defineProps({
  currentTask: { type: Object, default: null },
  sync: { type: Object, default: null },
  status: { type: String, default: 'stopped' }
});

const stages = [
  { code: 'SYNC', label: '同步' },
  { code: 'DESIGN', label: '设计' },
  { code: 'FIX', label: '修复' },
  { code: 'TEST', label: '测试' },
  { code: 'REVIEW', label: 'Review' },
  { code: 'COMMIT', label: 'Commit' },
  { code: 'SETTLE', label: '结算' }
];

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
      </div>
    </div>
    <ol class="stage-rail" :class="`status-${status}`">
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
  </section>
</template>

<style scoped>
.stage-panel {
  position: relative;
  overflow: hidden;
  padding: 20px 22px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background:
    linear-gradient(90deg, rgba(214, 90, 52, 0.07), transparent 28%),
    rgba(248, 246, 239, 0.92);
  box-shadow: var(--shadow);
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
  font-size: 21px;
  line-height: 1.15;
}

.stage-meta .eyebrow {
  margin-bottom: 2px;
}

.stage-meta-right {
  display: grid;
  justify-items: end;
  gap: 2px;
  color: var(--ink-muted);
  font-size: 12px;
}

.elapsed {
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 11px;
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
  width: 24px;
  height: 24px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: var(--paper-light);
}

.node-index {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8px;
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
  font-size: 8px;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
}

.node-label {
  overflow: hidden;
  font-size: 12px;
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
