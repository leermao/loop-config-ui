<script setup>
import { computed, nextTick, ref, watch } from 'vue';

import { formatClock } from '../lib/format.js';
import { dismissJob, notify, useConsoleStore } from '../stores/console.js';

const store = useConsoleStore();
const outputRef = ref(null);
const job = computed(() => store.activeJob);
const output = computed(() => (store.jobOutput || '').slice(-24000));
const running = computed(() => job.value?.status === 'running');
const statusLabel = computed(() => ({
  running: '正在执行',
  succeeded: '执行成功',
  failed: '执行失败'
}[job.value?.status] || job.value?.status));

watch(
  () => [store.jobOutput, job.value?.status],
  async () => {
    await nextTick();
    if (outputRef.value) outputRef.value.scrollTop = outputRef.value.scrollHeight;
  }
);

async function copyOutput() {
  await navigator.clipboard.writeText(store.jobOutput || '');
  notify('已复制任务输出', 'success');
}
</script>

<template>
<Teleport to="body">
  <Transition name="dock">
    <aside v-if="job" class="job-dock" :class="`status-${job.status}`" aria-live="polite">
      <header class="dock-head">
        <div class="dock-title">
          <span class="dock-signal" aria-hidden="true"></span>
          <div>
            <span class="eyebrow">Action telemetry</span>
            <strong>{{ job.label }}</strong>
          </div>
        </div>
        <div class="dock-meta">
          <span class="badge" :class="running ? 'badge-warn' : job.status === 'succeeded' ? 'badge-success' : 'badge-danger'">
            {{ statusLabel }}
          </span>
          <span class="mono-small">{{ formatClock(job.startedAt) }}</span>
          <button class="dock-close" type="button" :disabled="running" aria-label="关闭执行面板" @click="dismissJob">
            {{ running ? '执行中' : '关闭' }}
          </button>
        </div>
      </header>
      <pre ref="outputRef" class="dock-output">{{ output || '等待输出…' }}</pre>
      <footer v-if="!running" class="dock-foot">
        <span v-if="store.jobError" class="text-danger">{{ store.jobError }}</span>
        <span v-else class="muted">操作已记录到审计日志</span>
        <button class="button button-small button-quiet" type="button" @click="copyOutput">复制输出</button>
      </footer>
    </aside>
  </Transition>
</Teleport>
</template>

<style scoped>
.job-dock {
  position: fixed;
  z-index: 900;
  right: 22px;
  bottom: 22px;
  width: min(650px, calc(100vw - 44px));
  max-height: min(55vh, 520px);
  display: grid;
  grid-template-rows: auto minmax(120px, 1fr) auto;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-top: 3px solid var(--brass);
  border-radius: var(--radius);
  background: #16201d;
  color: #e8ece8;
  box-shadow: var(--shadow-float);
}

.job-dock.status-succeeded {
  border-top-color: var(--copper);
}

.job-dock.status-failed {
  border-top-color: var(--danger);
}

.dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.dock-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dock-title strong {
  display: block;
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dock-title .eyebrow {
  color: var(--brass);
}

.dock-signal {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brass);
  box-shadow: 0 0 0 4px rgba(178, 128, 45, 0.16);
}

.status-succeeded .dock-signal {
  background: #55b89f;
}

.status-failed .dock-signal {
  background: #d26a6a;
}

.dock-meta {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.dock-meta .mono-small {
  color: #a7b2ac;
}

.dock-close {
  padding: 4px 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  background: transparent;
  color: #e8ece8;
  font-size: 11px;
  cursor: pointer;
}

.dock-close:disabled {
  cursor: default;
  opacity: 0.5;
}

.dock-output {
  min-height: 120px;
  padding: 13px 15px;
  margin: 0;
  overflow: auto;
  color: #cbd4cf;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.dock-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  font-size: 11px;
}

.dock-foot .button {
  border-color: rgba(255, 255, 255, 0.16);
  color: #e8ece8;
}

.dock-enter-active,
.dock-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.dock-enter-from,
.dock-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

@media (max-width: 700px) {
  .job-dock {
    right: 10px;
    bottom: 10px;
    width: calc(100vw - 20px);
    max-height: 62vh;
  }

  .dock-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
