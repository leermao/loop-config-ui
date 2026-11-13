<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import JobDock from './components/JobDock.vue';
import StatusLamp from './components/StatusLamp.vue';
import ConfigView from './views/ConfigView.vue';
import LogsView from './views/LogsView.vue';
import OperationsView from './views/OperationsView.vue';
import OverviewView from './views/OverviewView.vue';
import TasksView from './views/TasksView.vue';
import { formatClock } from './lib/format.js';
import { refreshState, startConsole, useConsoleStore } from './stores/console.js';

const store = useConsoleStore();
const route = ref('overview');
const clock = ref(new Date());
let clockTimer;

const routes = [
  { id: 'overview', label: '总览', symbol: '◎', hint: '运行态与阶段' },
  { id: 'tasks', label: '任务', symbol: '▤', hint: '队列与案卷' },
  { id: 'logs', label: '日志', symbol: '≋', hint: '实时追踪' },
  { id: 'config', label: '配置', symbol: '⌘', hint: '参数与诊断' },
  { id: 'operations', label: '运维', symbol: '⚑', hint: '生命周期与维护' }
];

const views = {
  overview: OverviewView,
  tasks: TasksView,
  logs: LogsView,
  config: ConfigView,
  operations: OperationsView
};

const activeView = computed(() => views[route.value] || OverviewView);
const snapshot = computed(() => store.snapshot);
const statusTone = computed(() => snapshot.value?.statusTone || (store.error ? 'danger' : 'neutral'));
const statusLabel = computed(() => snapshot.value?.statusLabel || (store.loading ? '连接中' : '状态未知'));
const connectionLabel = computed(() => ({
  live: '实时连接',
  connecting: '正在连接',
  reconnecting: '重新连接中',
  polling: '轮询更新'
}[store.connection] || store.connection));
const connectionTone = computed(() => store.connection === 'live' ? 'running' : 'warn');
const versionLabel = computed(() => {
  const versions = snapshot.value?.versions;
  if (!versions?.source) return '—';
  return versions.match ? versions.source : `${versions.source} → ${versions.installed || '未安装'}`;
});
const versionTone = computed(() => snapshot.value?.versions?.match === false ? 'warn' : 'neutral');
const syncWindow = computed(() => {
  const sync = snapshot.value?.sync;
  if (!sync) return '—';
  return `${String(sync.startHour).padStart(2, '0')}:00–${String(sync.endHour).padStart(2, '0')}:00`;
});

function routeFromHash() {
  const next = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  route.value = views[next] ? next : 'overview';
}

function navigate(id) {
  if (id === route.value) return;
  window.location.hash = `#/${id}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function retryConnection() {
  refreshState().catch(() => {});
}

onMounted(() => {
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
  clockTimer = setInterval(() => {
    clock.value = new Date();
  }, 1000);
  startConsole();
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', routeFromHash);
  clearInterval(clockTimer);
});
</script>

<template>
  <div class="app-shell">
    <aside class="control-rail">
      <button class="brand" type="button" aria-label="返回总览" @click="navigate('overview')">
        <span class="brand-mark">AF</span>
        <span class="brand-word">REPAIR<br />LINE</span>
      </button>

      <nav class="rail-nav" aria-label="主导航">
        <button
          v-for="item in routes"
          :key="item.id"
          class="rail-link"
          :class="{ active: route === item.id }"
          type="button"
          :aria-current="route === item.id ? 'page' : undefined"
          :title="item.hint"
          @click="navigate(item.id)"
        >
          <span class="rail-symbol" aria-hidden="true">{{ item.symbol }}</span>
          <span class="rail-label">{{ item.label }}</span>
        </button>
      </nav>

      <div class="rail-foot">
        <span class="rail-axis" aria-hidden="true"></span>
        <span>LOCAL</span>
        <span>127.0.0.1</span>
      </div>
    </aside>

    <div class="workspace">
      <header class="instrument-bar">
        <div class="instrument-title">
          <span class="instrument-kicker">AUTOFIX OPS / 本地控制台</span>
          <span class="instrument-sub">Repair orchestration &amp; evidence desk</span>
        </div>
        <div class="instrument-strip">
          <div class="instrument-cell status-cell">
            <span class="cell-key">Pipeline</span>
            <StatusLamp :tone="statusTone" :label="statusLabel" />
          </div>
          <div class="instrument-cell">
            <span class="cell-key">Version</span>
            <span class="cell-value" :class="{ warn: versionTone === 'warn' }">{{ versionLabel }}</span>
          </div>
          <div class="instrument-cell">
            <span class="cell-key">Sync window</span>
            <span class="cell-value">{{ syncWindow }}</span>
          </div>
          <div class="instrument-cell">
            <span class="cell-key">Stream</span>
            <StatusLamp :tone="connectionTone" :label="connectionLabel" />
          </div>
          <time class="instrument-clock" :datetime="clock.toISOString()">{{ formatClock(clock) }}</time>
        </div>
      </header>

      <div v-if="store.error" class="global-error" role="alert">
        <span><strong>控制台连接异常：</strong>{{ store.error }}</span>
        <button class="button button-small" type="button" @click="retryConnection">重试状态同步</button>
      </div>

      <main class="page-stage">
        <Transition name="view" mode="out-in">
          <component :is="activeView" :key="route" />
        </Transition>
      </main>
    </div>

    <JobDock />

    <Transition name="toast">
      <div v-if="store.toast" class="toast" :class="`tone-${store.toastTone}`" role="status">
        {{ store.toast }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: var(--rail-width) minmax(0, 1fr);
  min-height: 100vh;
}

.control-rail {
  position: fixed;
  z-index: 50;
  inset: 0 auto 0 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: var(--rail-width);
  padding: 18px 10px 16px;
  background:
    linear-gradient(180deg, rgba(214, 90, 52, 0.13), transparent 22%),
    var(--ink);
  color: var(--paper-light);
  box-shadow: 7px 0 25px rgba(28, 39, 36, 0.18);
}

.control-rail::after {
  position: absolute;
  top: 0;
  right: 8px;
  bottom: 0;
  width: 1px;
  background: repeating-linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.16) 0,
    rgba(255, 255, 255, 0.16) 5px,
    transparent 5px,
    transparent 10px
  );
  content: "";
}

.brand {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: var(--signal);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.brand-word {
  color: rgba(248, 246, 239, 0.6);
  font-family: var(--font-mono);
  font-size: 7px;
  line-height: 1.5;
  letter-spacing: 0.17em;
  text-align: center;
}

.rail-nav {
  display: grid;
  align-content: center;
  gap: 6px;
  margin: 24px 0;
}

.rail-link {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  width: 100%;
  min-height: 61px;
  padding: 9px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: rgba(248, 246, 239, 0.55);
  cursor: pointer;
  transition:
    color var(--transition),
    background var(--transition),
    border-color var(--transition);
}

.rail-link:hover {
  color: var(--paper-light);
  background: rgba(255, 255, 255, 0.04);
}

.rail-link.active {
  border-color: rgba(214, 90, 52, 0.46);
  background: rgba(214, 90, 52, 0.13);
  color: var(--paper-light);
}

.rail-link.active::before {
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: -10px;
  width: 3px;
  background: var(--signal);
  content: "";
}

.rail-symbol {
  font-family: var(--font-display);
  font-size: 21px;
  line-height: 1;
}

.rail-label {
  font-size: 11px;
  font-weight: 700;
}

.rail-foot {
  display: grid;
  justify-items: center;
  gap: 4px;
  color: rgba(248, 246, 239, 0.35);
  font-family: var(--font-mono);
  font-size: 7px;
  letter-spacing: 0.06em;
}

.rail-axis {
  width: 1px;
  height: 30px;
  margin-bottom: 6px;
  background: linear-gradient(to bottom, transparent, var(--signal));
}

.workspace {
  grid-column: 2;
  min-width: 0;
}

.instrument-bar {
  position: sticky;
  z-index: 40;
  top: 0;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 20px;
  min-height: 67px;
  padding: 0 26px;
  border-bottom: 1px solid var(--line);
  background: rgba(241, 239, 232, 0.9);
  backdrop-filter: blur(12px);
}

.instrument-title {
  display: grid;
  align-content: center;
  gap: 1px;
  min-width: 220px;
}

.instrument-kicker {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.instrument-sub {
  color: var(--ink-muted);
  font-size: 11px;
}

.instrument-strip {
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.instrument-cell {
  display: grid;
  align-content: center;
  gap: 1px;
  min-width: 112px;
  padding: 0 14px;
  border-left: 1px solid var(--line);
}

.cell-key {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.cell-value {
  overflow: hidden;
  max-width: 150px;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-value.warn {
  color: #8b611b;
}

.instrument-clock {
  display: grid;
  place-items: center;
  min-width: 92px;
  padding-left: 14px;
  border-left: 1px solid var(--line);
  color: var(--signal-dark);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
}

.global-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 9px 26px;
  border-bottom: 1px solid rgba(161, 61, 61, 0.25);
  background: var(--danger-light);
  color: var(--danger);
  font-size: 12px;
}

.page-stage {
  width: min(100%, var(--content-width));
  padding: 26px;
  margin: 0 auto;
}

.toast {
  position: fixed;
  z-index: 1100;
  top: 18px;
  left: 50%;
  max-width: min(520px, calc(100vw - 30px));
  padding: 10px 16px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--paper-light);
  box-shadow: var(--shadow);
  font-weight: 600;
  transform: translateX(-50%);
}

.toast.tone-success {
  border-top: 2px solid var(--copper);
}

.toast.tone-danger {
  border-top: 2px solid var(--danger);
}

.view-enter-active,
.view-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}

.view-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.view-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}

@media (max-width: 1180px) {
  .instrument-title {
    display: none;
  }

  .instrument-bar {
    justify-content: flex-end;
  }

  .instrument-cell {
    min-width: 100px;
  }
}

@media (max-width: 900px) {
  .app-shell {
    display: block;
  }

  .control-rail {
    position: sticky;
    top: 0;
    display: flex;
    align-items: center;
    width: 100%;
    height: 62px;
    padding: 7px 10px;
  }

  .control-rail::after,
  .rail-foot {
    display: none;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-right: 8px;
  }

  .brand-mark {
    width: 38px;
    height: 38px;
    font-size: 17px;
  }

  .brand-word {
    display: none;
  }

  .rail-nav {
    display: flex;
    flex: 1;
    justify-content: space-around;
    gap: 2px;
    margin: 0;
  }

  .rail-link {
    min-height: 46px;
    max-width: 86px;
    padding: 4px 7px;
  }

  .rail-link.active::before {
    top: auto;
    right: 12px;
    bottom: -7px;
    left: 12px;
    width: auto;
    height: 2px;
  }

  .rail-symbol {
    font-size: 17px;
  }

  .rail-label {
    font-size: 10px;
  }

  .workspace {
    width: 100%;
  }

  .instrument-bar {
    top: 62px;
    min-height: 52px;
    padding: 0 12px;
    overflow-x: auto;
  }

  .instrument-strip {
    width: max-content;
  }

  .instrument-cell {
    min-width: 94px;
    padding: 0 10px;
  }

  .instrument-cell:nth-child(3) {
    display: none;
  }

  .page-stage {
    padding: 16px;
  }
}

@media (max-width: 540px) {
  .rail-link {
    max-width: 64px;
    padding-inline: 3px;
  }

  .rail-symbol {
    font-size: 15px;
  }

  .rail-label {
    font-size: 9px;
  }

  .instrument-cell:nth-child(2),
  .instrument-cell:nth-child(4) {
    display: none;
  }

  .instrument-clock {
    min-width: 74px;
  }

  .global-error {
    align-items: flex-start;
    flex-direction: column;
    padding: 9px 14px;
  }
}
</style>
