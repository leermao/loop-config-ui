<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  ArrowUpRight,
  BellRing,
  Boxes,
  GitBranch,
  Layers3,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Square,
  TriangleAlert,
  Wrench
} from '@lucide/vue';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import OpsTelemetry from '../components/OpsTelemetry.vue';
import StageRail from '../components/StageRail.vue';
import StatusLamp from '../components/StatusLamp.vue';
import {
  eventTone,
  formatDateTime,
  formatDuration,
  formatRelative,
  parseEventLine,
  priorityLabel
} from '../lib/format.js';
import {
  notify,
  refreshState,
  runAction,
  selectTask,
  useConsoleStore
} from '../stores/console.js';

const store = useConsoleStore();
const now = ref(Date.now());
const pendingAction = ref(null);
const busy = ref(false);
let timer;

const snapshot = computed(() => store.snapshot);
const currentTask = computed(() => snapshot.value?.currentTask || null);
const queue = computed(() => snapshot.value?.queue?.items || []);
const status = computed(() => snapshot.value?.status || 'unknown');
const statusLabel = computed(() => snapshot.value?.statusLabel || '状态未知');
const tone = computed(() => snapshot.value?.statusTone || 'neutral');
const worktree = computed(() => snapshot.value?.worktree || {});
const versions = computed(() => snapshot.value?.versions || {});
const notifyTask = computed(() => snapshot.value?.notify || {});
const main = computed(() => snapshot.value?.main || {});

const liveStageSeconds = computed(() => {
  if (!currentTask.value) return null;
  if (currentTask.value.startedAt) {
    return Math.max(0, Math.floor(now.value / 1000 - currentTask.value.startedAt));
  }
  return currentTask.value.elapsedSeconds;
});

const events = computed(() => [...(snapshot.value?.recentLog || [])]
  .reverse()
  .map(parseEventLine)
  .map((item) => ({ ...item, tone: eventTone(item.message) }))
  .slice(0, 20));

const anomalyItems = computed(() => {
  if (!snapshot.value) return [];
  const items = [];
  if (main.value.residualAlive) items.push({ tone: 'danger', text: `检测到残留 e2e run.sh：PID ${(main.value.residualPids || []).join(', ')}` });
  if (snapshot.value.markers?.halt) items.push({ tone: 'danger', text: `halt：${snapshot.value.markers.halt}` });
  if (snapshot.value.markers?.paused) items.push({ tone: 'warn', text: `主动暂停：${snapshot.value.markers.paused}` });
  if (snapshot.value.markers?.blocked) items.push({ tone: 'warn', text: `blocked：${snapshot.value.markers.blocked}` });
  if (snapshot.value.queue?.error) items.push({ tone: 'danger', text: `队列异常：${snapshot.value.queue.error}` });
  if (versions.value.source && versions.value.installed && !versions.value.match) {
    items.push({ tone: 'warn', text: `版本不一致：源码 ${versions.value.source}，安装 ${versions.value.installed}` });
  }
  if (status.value === 'running' && !notifyTask.value.loaded) {
    items.push({ tone: 'warn', text: '通知任务未加载，进度事件不会主动推送' });
  }
  if (['error', 'blocked', 'halted'].includes(status.value)) {
    for (const reason of snapshot.value.statusReasons || []) {
      if (!items.some((item) => item.text === reason)) items.push({ tone: status.value === 'error' || status.value === 'halted' ? 'danger' : 'warn', text: reason });
    }
  }
  return items;
});

const healthCards = computed(() => [
  {
    key: 'runner',
    icon: Server,
    label: '主进程',
    value: main.value.runAlive ? `PID ${main.value.runPid}` : main.value.residualAlive ? '有残留进程' : '未运行',
    detail: main.value.residualAlive
      ? `e2e PID ${(main.value.residualPids || []).join(', ')}`
      : main.value.loaded ? 'launchd 已加载' : 'launchd 未加载',
    tone: main.value.runAlive && main.value.loaded ? 'running' : main.value.residualAlive || !main.value.loaded ? 'danger' : 'warn'
  },
  {
    key: 'notify',
    icon: BellRing,
    label: '通知任务',
    value: notifyTask.value.loaded ? '已加载' : '未加载',
    detail: notifyTask.value.pid ? `PID ${notifyTask.value.pid}` : '每分钟推送一次进度',
    tone: notifyTask.value.loaded ? 'running' : 'warn'
  },
  {
    key: 'version',
    icon: GitBranch,
    label: '版本',
    value: versions.value.source || '无',
    detail: versions.value.match ? '源码与安装一致' : `安装 ${versions.value.installed || '未安装'}`,
    tone: versions.value.match ? 'running' : 'warn'
  },
  {
    key: 'queue',
    icon: Layers3,
    label: '队列',
    value: `${snapshot.value?.queue?.count ?? 0} 条`,
    detail: snapshot.value?.queue?.error ? '队列文件异常' : queue.value[0] ? `队首 ${queue.value[0].serialNumber}` : '等待新缺陷',
    tone: snapshot.value?.queue?.error ? 'danger' : 'neutral'
  },
  {
    key: 'worktree',
    icon: Boxes,
    label: 'Worktree',
    value: worktree.value.branch || (worktree.value.exists ? 'detached' : '未创建'),
    detail: worktree.value.dirty ? `${worktree.value.changedFiles?.length || 0} 个未提交改动` : (worktree.value.exists ? '工作区干净' : '下次启动自动创建'),
    tone: !worktree.value.exists ? 'warn' : worktree.value.dirty ? 'warn' : 'running'
  }
]);

const quickActions = computed(() => [
  { id: 'main.start', label: '启动', icon: Play, tone: 'primary', description: '重新加载 com.autofix，并从现有队列继续。' },
  { id: 'main.pause', label: '暂停取任务', icon: Pause, tone: 'quiet', description: '停止同步和取新任务；当前任务继续跑完。' },
  { id: 'main.resume', label: '恢复取任务', icon: RotateCcw, tone: 'quiet', description: '删除 paused 标记，下一轮恢复同步和取任务。' },
  { id: 'main.stop', label: '停止', icon: Square, tone: 'danger', description: '卸载主任务并清理残留 run.sh / caffeinate；不会删除队列和 worktree。', requireText: '确认' },
  { id: 'version.sync', label: '同步版本', icon: Wrench, tone: 'signal', description: '停止流水线，复制当前 skill 到安装副本，再重新启动。不一致时可能中断当前任务。', requireText: '确认' }
]);

function askAction(action) {
  pendingAction.value = action;
}

async function confirmAction() {
  if (!pendingAction.value) return;
  busy.value = true;
  try {
    await runAction(pendingAction.value.id);
    pendingAction.value = null;
    await refreshState().catch(() => {});
  } catch (error) {
    notify(error.message, 'danger');
  } finally {
    busy.value = false;
  }
}

function openTask(id) {
  if (id) selectTask(id);
}

function goTasks() {
  window.location.hash = '#/tasks';
}

function goLogs() {
  window.location.hash = '#/logs';
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 10_000);
});

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="view">
    <header class="view-heading">
      <div>
        <p class="eyebrow">Repair line / 01</p>
        <h1>总览</h1>
        <p class="view-subtitle">把进程、阶段、队列和异常放在同一张工作台上。</p>
      </div>
      <div class="view-actions">
        <span v-if="snapshot?.generatedAt" class="muted mono-small">更新于 {{ formatRelative(snapshot.generatedAt) }}</span>
        <button class="button button-small" type="button" @click="refreshState().catch((error) => notify(error.message, 'danger'))">
          <RefreshCw :size="13" aria-hidden="true" />
          刷新状态
        </button>
      </div>
    </header>

    <StageRail :current-task="currentTask" :sync="snapshot?.sync" :status="status" />

    <OpsTelemetry
      :log-lines="snapshot?.recentLog || []"
      :queue="queue"
      :health-cards="healthCards"
      :generated-at="snapshot?.generatedAt || ''"
      :connection="store.connection"
    />

    <div v-if="anomalyItems.length" class="anomaly-strip" role="status">
      <div class="anomaly-label">
        <span class="anomaly-mark" aria-hidden="true"><TriangleAlert :size="12" :stroke-width="2" /></span>
        <strong>需要留意</strong>
      </div>
      <div class="anomaly-list">
        <span v-for="(item, index) in anomalyItems" :key="`${item.text}-${index}`" :class="`tone-${item.tone}`">
          {{ item.text }}
        </span>
      </div>
    </div>

    <div class="overview-grid">
      <article class="case-sheet panel">
        <div class="case-stripe" aria-hidden="true"></div>
        <header class="case-head">
          <div>
            <p class="eyebrow">Active work order</p>
            <h2>{{ currentTask ? currentTask.id : '当前没有修复任务' }}</h2>
            <p class="case-subject">{{ currentTask?.subject || '主循环空闲时，下一条命中队列的缺陷会出现在这里。' }}</p>
          </div>
          <StatusLamp :tone="currentTask ? 'running' : 'neutral'" :label="currentTask?.stage || '空闲'" />
        </header>
        <div v-if="currentTask" class="case-body">
          <div class="case-metric">
            <span>阶段</span>
            <strong>{{ currentTask.stage }}</strong>
          </div>
          <div class="case-metric">
            <span>本阶段用时</span>
            <strong>{{ formatDuration(liveStageSeconds) }}</strong>
          </div>
          <div class="case-metric">
            <span>开始时间</span>
            <strong>{{ currentTask.startedAt ? formatDateTime(currentTask.startedAt * 1000) : '—' }}</strong>
          </div>
          <div class="case-metric wide">
            <span>修复分支</span>
            <strong class="mono">{{ worktree.branch || '未在修复分支' }}</strong>
          </div>
          <div class="case-metric wide">
            <span>当前 Head</span>
            <strong class="mono">{{ worktree.head || '—' }}</strong>
          </div>
        </div>
        <div v-else class="case-empty">
          <span class="empty-orbit" aria-hidden="true">◎</span>
          <span>主循环 {{ statusLabel }}</span>
        </div>
        <footer class="case-foot">
          <button v-if="currentTask" class="button button-small button-primary" type="button" @click="openTask(currentTask.id)">
            查看任务案卷
          </button>
          <button class="button button-small" type="button" @click="askAction(quickActions[0])">启动流水线</button>
          <span class="spacer"></span>
          <span class="muted mono-small">{{ main.pid ? `launchd PID ${main.pid}` : 'launchd 未加载' }}</span>
        </footer>
      </article>

      <aside class="queue-panel panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">Incoming defects</p>
            <h2>队列 <span class="queue-count">{{ snapshot?.queue?.count ?? 0 }}</span></h2>
          </div>
          <span class="badge" :class="snapshot?.queue?.error ? 'badge-danger' : ''">
            {{ snapshot?.queue?.error ? '文件异常' : '按优先级排序' }}
          </span>
        </div>
        <div v-if="queue.length" class="queue-list">
          <button
            v-for="(item, index) in queue.slice(0, 5)"
            :key="item.serialNumber"
            class="queue-item"
            type="button"
            @click="openTask(item.serialNumber)"
          >
            <span class="queue-rank">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="queue-copy">
              <strong>{{ item.serialNumber }}</strong>
              <span>{{ item.subject || '无标题' }}</span>
            </span>
            <span class="badge">{{ priorityLabel(item.priorityRank) }}</span>
          </button>
        </div>
        <div v-else class="empty-state queue-empty">
          <div>
            <strong>队列为空</strong>
            <span>同步时段内只会在整刻度和补偿同步时拉取新缺陷。</span>
          </div>
        </div>
        <footer class="queue-foot">
          <span class="muted">{{ snapshot?.sync?.lastSyncAt ? `上次同步 ${formatRelative(snapshot.sync.lastSyncAt)}` : '尚未记录同步' }}</span>
          <button class="button button-small button-quiet" type="button" @click="goTasks">打开任务页</button>
        </footer>
      </aside>
    </div>

    <section class="health-band" aria-label="健康状态">
      <article
        v-for="(card, index) in healthCards"
        :key="card.key"
        class="health-card"
        :style="{ '--card-index': index }"
      >
        <div class="health-head">
          <span class="health-label">
            <component :is="card.icon" :size="13" :stroke-width="1.7" aria-hidden="true" />
            {{ card.label }}
          </span>
          <StatusLamp :tone="card.tone" :show-label="false" />
        </div>
        <strong>{{ card.value }}</strong>
        <small>{{ card.detail }}</small>
      </article>
    </section>

    <div class="lower-grid">
      <section class="events panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">Paper tape</p>
            <h2>最近事件</h2>
          </div>
          <span class="muted mono-small">{{ events.length }} / 20</span>
        </div>
        <div v-if="events.length" class="event-list">
          <article v-for="(item, index) in events" :key="`${item.time}-${index}`" class="event-row" :class="`tone-${item.tone}`">
            <time>{{ item.time || '—' }}</time>
            <span class="event-signal" aria-hidden="true"></span>
            <p>{{ item.message }}</p>
          </article>
        </div>
        <div v-else class="empty-state">
          <div><strong>还没有事件</strong><span>流水线启动后，进度日志会出现在这里。</span></div>
        </div>
        <footer class="events-foot">
          <button class="button button-small button-quiet" type="button" @click="goLogs">查看完整日志</button>
          <span class="muted mono-small">来源 ~/autofix/runs/log</span>
        </footer>
      </section>

      <section class="quick panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">Direct controls</p>
            <h2>快捷操作</h2>
          </div>
          <span class="badge" :class="store.activeJob?.status === 'running' ? 'badge-warn' : ''">
            {{ store.activeJob?.status === 'running' ? '动作执行中' : '单动作串行' }}
          </span>
        </div>
        <div class="quick-list">
          <button
            v-for="action in quickActions"
            :key="action.id"
            class="quick-action"
            type="button"
            :disabled="store.activeJob?.status === 'running'"
            @click="askAction(action)"
          >
            <span class="quick-action-icon" aria-hidden="true">
              <component :is="action.icon" :size="15" :stroke-width="1.7" />
            </span>
            <span class="quick-action-copy">
              <strong>{{ action.label }}</strong>
              <span>{{ action.description }}</span>
            </span>
            <ArrowUpRight class="quick-action-arrow" :size="14" aria-hidden="true" />
          </button>
        </div>
        <div class="sync-note">
          <span class="badge badge-warn">{{ syncWindow }}</span>
          <p>同步只在时段内的 15 分钟刻度发生；队列执行 24 小时持续。</p>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="Boolean(pendingAction)"
      :title="pendingAction?.label || '确认操作'"
      :description="pendingAction?.description"
      :confirm-label="pendingAction?.label || '确认'"
      :tone="pendingAction?.id === 'main.stop' || pendingAction?.id === 'version.sync' ? 'danger' : 'default'"
      :require-text="pendingAction?.requireText || ''"
      :busy="busy"
      @close="pendingAction = null"
      @confirm="confirmAction"
    >
      <div class="confirm-facts">
        <div><span>当前状态</span><strong>{{ snapshot?.statusLabel || '未知' }}</strong></div>
        <div><span>当前任务</span><strong>{{ currentTask?.id || '无' }}</strong></div>
        <div><span>队列</span><strong>{{ snapshot?.queue?.count ?? 0 }} 条</strong></div>
      </div>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.view {
  display: grid;
  gap: 22px;
}

.view-heading {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line-strong);
}

.view-heading::after {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 96px;
  height: 2px;
  background: linear-gradient(90deg, var(--signal), rgba(214, 90, 52, 0));
  content: "";
}

.view-heading h1 {
  margin-bottom: 5px;
}

.view-subtitle {
  max-width: 690px;
  margin: 0;
  color: var(--ink-muted);
  font-size: 13px;
  line-height: 1.55;
}

.view-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.view-actions .button svg {
  transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1);
}

.view-actions .button:hover svg {
  transform: rotate(70deg);
}

.anomaly-strip {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 15px;
  padding: 12px 15px;
  border: 1px solid rgba(178, 128, 45, 0.3);
  border-left: 4px solid var(--brass);
  border-radius: var(--radius);
  background: linear-gradient(90deg, rgba(178, 128, 45, 0.14), rgba(248, 246, 239, 0.82));
}

.anomaly-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.anomaly-mark {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--brass);
  color: white;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 800;
}

.anomaly-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 16px;
  color: var(--ink-soft);
  font-size: var(--text-small);
}

.anomaly-list .tone-danger {
  color: var(--danger);
}

.anomaly-list .tone-warn {
  color: #7d5817;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.85fr);
  gap: 18px;
}

.case-sheet {
  overflow: hidden;
  padding: 24px;
  background:
    linear-gradient(132deg, rgba(214, 90, 52, 0.05), transparent 38%),
    rgba(248, 246, 239, 0.94);
}

.case-stripe {
  position: absolute;
  top: 0;
  right: 0;
  width: 120px;
  height: 5px;
  background: repeating-linear-gradient(90deg, var(--signal) 0 14px, transparent 14px 21px);
}

.case-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.case-head h2 {
  margin: 0 0 4px;
  font-size: clamp(30px, 3.4vw, 48px);
  line-height: 1;
}

.case-subject {
  max-width: 680px;
  margin: 0;
  color: var(--ink-muted);
  font-size: 14.5px;
  line-height: 1.55;
}

.case-body {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  padding: 18px 0;
  background: var(--line);
}

.case-metric {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 11px 14px;
  background: var(--paper-light);
}

.case-metric.wide {
  grid-column: span 2;
}

.case-metric span {
  color: var(--ink-muted);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.case-metric strong {
  overflow: hidden;
  font-size: 15.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-metric .mono {
  font-size: 12.5px;
}

.case-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 120px;
  color: var(--ink-muted);
}

.empty-orbit {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 1px dashed var(--line-strong);
  border-radius: 50%;
  color: var(--signal);
  font-size: 25px;
}

.case-foot,
.queue-foot,
.events-foot {
  display: flex;
  align-items: center;
  gap: 9px;
  padding-top: 15px;
  margin-top: 4px;
  border-top: 1px solid var(--line);
}

.queue-panel {
  display: grid;
  align-content: start;
  padding: 20px;
}

.queue-count {
  display: inline-grid;
  place-items: center;
  min-width: 28px;
  height: 26px;
  margin-left: 6px;
  border-radius: var(--radius-small);
  background: var(--ink);
  color: var(--paper-light);
  font-family: var(--font-mono);
  font-size: 12px;
  vertical-align: 2px;
}

.queue-list {
  display: grid;
  gap: 1px;
  background: var(--line);
}

.queue-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px 9px;
  border: 0;
  background: var(--paper-light);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition);
}

.queue-item:hover {
  background: var(--paper-deep);
}

.queue-rank {
  color: var(--signal-dark);
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.queue-copy {
  display: grid;
  min-width: 0;
}

.queue-copy strong {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.queue-copy span {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-empty {
  min-height: 160px;
}

.queue-foot {
  justify-content: space-between;
  margin-top: 14px;
}

.health-band {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(248, 246, 239, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.58);
}

.health-card {
  position: relative;
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 15px 16px;
  animation: health-enter 440ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--card-index) * 45ms);
}

.health-card + .health-card {
  border-left: 1px solid var(--line);
}

.health-card:hover {
  background: rgba(255, 255, 255, 0.34);
}

.health-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--ink-muted);
  font-size: 10.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.health-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.health-label svg {
  color: var(--signal);
  opacity: 0.8;
}

.health-card > strong {
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 19px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.health-card > small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lower-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
  gap: 18px;
}

.events,
.quick {
  padding: 20px;
}

.event-list {
  display: grid;
  max-height: 430px;
  overflow: auto;
}

.event-row {
  display: grid;
  grid-template-columns: 108px 10px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px dashed var(--line);
}

.event-row time {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.event-row p {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-small);
}

.event-signal {
  width: 5px;
  height: 5px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--ink-muted);
}

.event-row.tone-success .event-signal {
  background: var(--copper);
}

.event-row.tone-warn .event-signal {
  background: var(--brass);
}

.event-row.tone-danger .event-signal {
  background: var(--danger);
}

.events-foot {
  justify-content: space-between;
}

.quick-list {
  display: grid;
  gap: 1px;
  background: var(--line);
}

.quick-action {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 10px;
  border: 0;
  background: var(--paper-light);
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition),
    transform var(--transition);
}

.quick-action:hover:not(:disabled) {
  background: var(--paper-deep);
  transform: translateX(2px);
}

.quick-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.quick-action-icon {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border: 1px solid rgba(214, 90, 52, 0.24);
  border-radius: var(--radius-small);
  background: rgba(214, 90, 52, 0.06);
  color: var(--signal);
  transition:
    color var(--transition),
    background var(--transition),
    transform var(--transition);
}

.quick-action:hover:not(:disabled) .quick-action-icon {
  background: var(--signal);
  color: white;
  transform: rotate(-7deg) scale(1.04);
}

.quick-action-arrow {
  color: var(--ink-muted);
  transition:
    color var(--transition),
    transform var(--transition);
}

.quick-action:hover:not(:disabled) .quick-action-arrow {
  color: var(--signal);
  transform: translate(1px, -1px);
}

.quick-action-copy {
  display: grid;
  gap: 1px;
}

.quick-action-copy strong {
  font-size: var(--text-small);
}

.quick-action-copy span {
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.45;
}

.sync-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding-top: 13px;
  margin-top: 13px;
  border-top: 1px solid var(--line);
}

.sync-note p {
  margin: 0;
  color: var(--ink-muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.confirm-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.confirm-facts div {
  display: grid;
  gap: 2px;
  padding: 9px 10px;
  background: var(--paper);
}

.confirm-facts span {
  color: var(--ink-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.confirm-facts strong {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

@keyframes health-enter {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1120px) {
  .overview-grid,
  .lower-grid {
    grid-template-columns: 1fr;
  }

  .health-band {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .health-card:nth-child(4) {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  .health-card:nth-child(5) {
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 760px) {
  .view-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .view-actions {
    width: 100%;
    justify-content: space-between;
  }

  .case-body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .health-band {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .health-card:nth-child(3) {
    border-left: 0;
    border-top: 1px solid var(--line);
  }

  .health-card:nth-child(4) {
    border-left: 1px solid var(--line);
  }

  .event-row {
    grid-template-columns: 85px 8px minmax(0, 1fr);
  }

  .queue-item,
  .quick-action {
    min-height: 44px;
  }

  .confirm-facts {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .health-band {
    grid-template-columns: 1fr;
  }

  .health-card + .health-card,
  .health-card:nth-child(3),
  .health-card:nth-child(4) {
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .health-card {
    animation: none;
  }

  .view-actions .button:hover svg,
  .quick-action:hover:not(:disabled) .quick-action-icon,
  .quick-action:hover:not(:disabled) .quick-action-arrow {
    transform: none;
  }
}
</style>
