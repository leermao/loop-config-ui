<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  Activity,
  Clock3,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  Radio,
  RefreshCw,
  ScrollText,
  SlidersHorizontal,
  Wrench
} from '@lucide/vue';

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
const pageStageRef = ref(null);
let clockTimer;
let revealObserver = null;
let revealMutation = null;
let revealMotionQuery = null;
let revealMotionHandler = null;

const revealSeen = new WeakSet();

const routes = [
  { id: 'overview', label: '总览', icon: LayoutDashboard, hint: '运行态与阶段' },
  { id: 'tasks', label: '任务', icon: ListTodo, hint: '队列与案卷' },
  { id: 'logs', label: '日志', icon: ScrollText, hint: '实时追踪' },
  { id: 'config', label: '配置', icon: SlidersHorizontal, hint: '参数与诊断' },
  { id: 'operations', label: '运维', icon: Wrench, hint: '生命周期与维护' }
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
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}

function retryConnection() {
  refreshState().catch(() => {});
}

function revealAllSections() {
  pageStageRef.value?.querySelectorAll('.reveal-section').forEach((element) => {
    element.classList.add('is-revealed');
  });
}

function setupSectionReveal() {
  const root = pageStageRef.value;
  if (!root) return;
  revealMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        revealObserver.unobserve(entry.target);
      }
    }, {
      threshold: 0.08,
      rootMargin: '0px 0px -6% 0px'
    });
  }

  const scan = () => {
    const view = root.querySelector('.view');
    if (!view) return;
    [...view.children].forEach((element, index) => {
      if (!(element instanceof HTMLElement) || revealSeen.has(element)) return;
      revealSeen.add(element);
      element.classList.add('reveal-section');
      element.style.setProperty('--reveal-delay', `${Math.min(index, 5) * 55}ms`);
      if (revealMotionQuery.matches || !revealObserver) {
        element.classList.add('is-revealed');
      } else {
        revealObserver.observe(element);
      }
    });
  };

  revealMutation = new MutationObserver(scan);
  revealMutation.observe(root, { childList: true });
  revealMotionHandler = (event) => {
    if (event.matches) revealAllSections();
  };
  revealMotionQuery.addEventListener('change', revealMotionHandler);
  scan();
}

onMounted(() => {
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
  setupSectionReveal();
  clockTimer = setInterval(() => {
    clock.value = new Date();
  }, 1000);
  startConsole();
});

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', routeFromHash);
  revealObserver?.disconnect();
  revealMutation?.disconnect();
  if (revealMotionQuery && revealMotionHandler) {
    revealMotionQuery.removeEventListener('change', revealMotionHandler);
  }
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
          <component
            :is="item.icon"
            class="rail-icon"
            :size="21"
            :stroke-width="1.65"
            aria-hidden="true"
          />
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
            <span class="cell-key"><Activity :size="10" aria-hidden="true" />Pipeline</span>
            <StatusLamp :tone="statusTone" :label="statusLabel" />
          </div>
          <div class="instrument-cell">
            <span class="cell-key"><GitBranch :size="10" aria-hidden="true" />Version</span>
            <span class="cell-value" :class="{ warn: versionTone === 'warn' }">{{ versionLabel }}</span>
          </div>
          <div class="instrument-cell">
            <span class="cell-key"><Clock3 :size="10" aria-hidden="true" />Sync window</span>
            <span class="cell-value">{{ syncWindow }}</span>
          </div>
          <div class="instrument-cell">
            <span class="cell-key"><Radio :size="10" aria-hidden="true" />Stream</span>
            <StatusLamp :tone="connectionTone" :label="connectionLabel" />
          </div>
          <time class="instrument-clock" :datetime="clock.toISOString()">{{ formatClock(clock) }}</time>
        </div>
      </header>

      <div v-if="store.error" class="global-error" role="alert">
        <span><strong>控制台连接异常：</strong>{{ store.error }}</span>
        <button class="button button-small" type="button" @click="retryConnection">
          <RefreshCw :size="13" aria-hidden="true" />
          重试状态同步
        </button>
      </div>

      <main ref="pageStageRef" class="page-stage">
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
  padding: 20px 11px 16px;
  background:
    linear-gradient(180deg, rgba(214, 90, 52, 0.16), transparent 24%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.024) 1px, transparent 1px),
    var(--ink);
  background-size: auto, 12px 100%, auto;
  color: var(--paper-light);
  box-shadow: 6px 0 22px rgba(28, 39, 36, 0.16);
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
  min-width: 44px;
  min-height: 44px;
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
  border: 1px solid rgba(248, 246, 239, 0.78);
  background: var(--paper-light);
  color: var(--ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.04em;
  box-shadow: inset 0 -3px 0 var(--signal);
}

.brand-word {
  color: rgba(248, 246, 239, 0.68);
  font-family: var(--font-mono);
  font-size: 8.5px;
  line-height: 1.45;
  letter-spacing: 0.14em;
  text-align: center;
}

.rail-nav {
  display: grid;
  align-content: center;
  gap: 7px;
  margin: 26px 0;
}

.rail-link {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 3px;
  width: 100%;
  min-height: 63px;
  padding: 10px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: rgba(248, 246, 239, 0.6);
  cursor: pointer;
  transition:
    color var(--transition),
    background var(--transition),
    border-color var(--transition),
    box-shadow var(--transition);
}

.rail-link:hover:not(.active) {
  color: var(--paper-light);
  background: rgba(255, 255, 255, 0.04);
}

.rail-link.active {
  border-color: rgba(248, 246, 239, 0.48);
  background: var(--paper-light);
  color: var(--ink);
  box-shadow:
    inset 3px 0 0 var(--signal),
    0 7px 18px rgba(0, 0, 0, 0.16);
}

.rail-link.active .rail-icon {
  color: var(--signal-dark);
}

.rail-icon {
  color: currentColor;
  transition: transform var(--transition);
}

.rail-link:hover .rail-icon {
  transform: translateY(-1px);
}

.rail-label {
  font-size: 11.5px;
  font-weight: 700;
}

.rail-foot {
  display: grid;
  justify-items: center;
  gap: 3px;
  color: rgba(248, 246, 239, 0.6);
  font-family: var(--font-mono);
  font-size: 8.5px;
  line-height: 1.4;
  letter-spacing: 0.08em;
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
  min-height: 72px;
  padding: 0 28px;
  border-bottom: 1px solid var(--line-strong);
  background: rgba(241, 239, 232, 0.93);
  backdrop-filter: blur(14px);
}

.instrument-bar::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 5px;
  background: repeating-linear-gradient(
    90deg,
    var(--line-strong) 0,
    var(--line-strong) 1px,
    transparent 1px,
    transparent 8px
  );
  content: "";
  opacity: 0.34;
  pointer-events: none;
}

.instrument-title {
  display: grid;
  align-content: center;
  gap: 2px;
  min-width: 220px;
  padding-left: 13px;
  border-left: 3px solid var(--signal);
}

.instrument-kicker {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.13em;
}

.instrument-sub {
  color: var(--ink-muted);
  font-size: 11.5px;
}

.instrument-strip {
  display: flex;
  align-items: stretch;
  min-width: 0;
}

.instrument-cell {
  display: grid;
  align-content: center;
  gap: 2px;
  min-width: 124px;
  padding: 0 16px;
  border-left: 1px solid var(--line);
}

.cell-key {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.095em;
  text-transform: uppercase;
}

.cell-value {
  overflow: hidden;
  max-width: 166px;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-value.warn {
  color: #795416;
}

.instrument-clock {
  display: grid;
  place-items: center;
  min-width: 100px;
  padding-left: 16px;
  border-left: 1px solid var(--line);
  color: var(--signal-dark);
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.025em;
}

.global-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 28px;
  border-bottom: 1px solid rgba(161, 61, 61, 0.25);
  background: var(--danger-light);
  color: var(--danger);
  font-size: var(--text-small);
}

.page-stage {
  width: min(100%, var(--content-width));
  padding: 30px 28px 44px;
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
  box-shadow: var(--shadow-float);
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
  will-change: opacity, transform, filter;
}

.view-enter-active {
  transition:
    opacity 280ms ease,
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
    filter 320ms ease;
}

.view-leave-active {
  transition:
    opacity 140ms ease,
    transform 180ms ease,
    filter 140ms ease;
}

.view-enter-from {
  opacity: 0;
  filter: blur(4px);
  transform: translateY(10px) scale(0.995);
}

.view-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(-4px) scale(1.002);
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
    min-height: 66px;
  }

  .instrument-cell {
    min-width: 106px;
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
    height: 64px;
    padding: 8px 12px;
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
    width: 40px;
    height: 40px;
    font-size: 18px;
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
    min-height: 48px;
    max-width: 86px;
    padding: 5px 7px;
  }

  .rail-link.active {
    box-shadow: inset 0 -2px 0 var(--signal);
  }

  .rail-label {
    font-size: 10.5px;
  }

  .workspace {
    width: 100%;
  }

  .instrument-bar {
    top: 64px;
    min-height: 54px;
    padding: 0 14px;
    overflow-x: auto;
  }

  .instrument-strip {
    width: max-content;
  }

  .instrument-cell {
    min-width: 94px;
    padding: 0 11px;
  }

  .instrument-cell:nth-child(3) {
    display: none;
  }

  .page-stage {
    padding: 20px 16px 32px;
  }
}

@media (max-width: 540px) {
  .rail-link {
    max-width: 64px;
    padding-inline: 3px;
  }

  .rail-label {
    font-size: 9.5px;
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
