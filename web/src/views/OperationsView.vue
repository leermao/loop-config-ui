<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { ArrowUpRight } from '@lucide/vue';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import StatusLamp from '../components/StatusLamp.vue';
import { formatRelative } from '../lib/format.js';
import {
  notify,
  refreshState,
  runAction,
  useConsoleStore
} from '../stores/console.js';

const store = useConsoleStore();
const pendingAction = ref(null);
const busy = ref(false);
const queueId = ref('');
const focusedActionId = ref('');
const actionRefs = new Map();

const groups = [
  {
    id: 'lifecycle',
    index: '01',
    title: '生命周期',
    note: '控制 launchd 主任务与取任务节奏。停止会中断当前任务；暂停不会。',
    actions: [
      {
        id: 'main.start',
        label: '启动主流水线',
        impact: '加载 com.autofix；存在 current 时先按中断恢复规则续做。',
        confirm: 'run'
      },
      {
        id: 'main.pause',
        label: '暂停取任务',
        impact: '写入 runs/paused；停止同步和取新任务，当前任务继续跑完。',
        confirm: 'run'
      },
      {
        id: 'main.resume',
        label: '恢复取任务',
        impact: '删除 runs/paused；下一轮主循环恢复同步和取任务。',
        confirm: 'run'
      },
      {
        id: 'main.stop',
        label: '停止主流水线',
        impact: '卸载 com.autofix，并清理残留 run.sh / caffeinate；保留队列、current 和 worktree。',
        confirm: 'danger',
        requireText: '确认'
      },
      {
        id: 'main.restart',
        label: '重启主流水线',
        impact: '先停止再启动；当前任务会按中断恢复规则处理。',
        confirm: 'danger',
        requireText: '确认'
      }
    ]
  },
  {
    id: 'notify',
    index: '02',
    title: '通知',
    note: '通知任务每分钟读取一次 status.sh，不调用模型；本地优先，配置飞书 Webhook 后同步推送。',
    configLink: { href: '#/config', label: '配置飞书' },
    actions: [
      { id: 'notify.start', label: '启动通知任务', impact: '加载 com.autofix.notify，恢复每分钟事件推送；已配置飞书时同步送达。', confirm: 'run' },
      { id: 'notify.stop', label: '停止通知任务', impact: '卸载 com.autofix.notify；主流水线不受影响。', confirm: 'run' },
      { id: 'notify.restart', label: '重启通知任务', impact: '重新加载通知任务；不会中断主流水线。', confirm: 'run' },
      { id: 'notify.send', label: '立即发送一次通知', impact: '执行 notify.sh；本地优先，配置 FEISHU_WEBHOOK_URL 后同步发送飞书，并消费当前未发送事件。', confirm: 'run' }
    ]
  },
  {
    id: 'version',
    index: '03',
    title: '版本与安装',
    note: '版本号定义在 skill 根目录 VERSION；同步只会复制 skill 内容，保留安装副本 .env。',
    actions: [
      { id: 'version.check', label: '检查版本', impact: '只比较源码与安装副本版本，不停止、不复制、不重启。', confirm: 'none' },
      {
        id: 'version.sync',
        label: '同步版本并重启',
        impact: '版本不一致时停止流水线、复制新 skill、重新安装 launchd 并启动；可能中断当前任务。',
        confirm: 'danger',
        requireText: '确认'
      },
      {
        id: 'launchd.repair',
        label: '重新安装主 launchd 配置',
        impact: '要求主流水线已停止；复制安装副本中的 com.autofix.plist，不自动加载。',
        confirm: 'danger',
        requireText: '确认'
      }
    ]
  },
  {
    id: 'maintenance',
    index: '04',
    title: '维护',
    note: '用于修复异常状态、清理队列和重新准备运行环境。',
    actions: [
      { id: 'markers.clear-blocked', label: '清除 blocked', impact: '删除 blocked 标记；请先确认 worktree 已处理干净。', confirm: 'danger', requireText: '确认' },
      { id: 'markers.clear-halt', label: '清除 halt', impact: '先校验 queue.json 是合法数组，再删除 halt；下一轮继续收尾。', confirm: 'danger', requireText: '确认' },
      {
        id: 'queue.remove',
        label: '删除队列条目',
        impact: '要求主流水线已停止；从 queue.json 删除指定编号，任务目录保留。',
        confirm: 'danger',
        requireText: 'queue-id'
      },
      { id: 'worktree.rebuild', label: '重建 worktree', impact: '要求主流水线已停止；移除现有 worktree，下次启动自动重建并装依赖。', confirm: 'danger', requireText: '确认' },
      { id: 'deps.reset', label: '强制重装依赖', impact: '删除 runs/deps-* 指纹；下一条任务会重新执行 pnpm install。', confirm: 'run' },
      { id: 'tests.run', label: '运行 skill 回归测试', impact: '使用桩命令跑全部自动修复回归，不碰真实云效和仓库。', confirm: 'none' },
      { id: 'yunxiao.list', label: '查询云效待处理缺陷', impact: '调用云效 OpenAPI，只查询指派人的待确认和再次打开缺陷。', confirm: 'none' }
    ]
  }
];

const snapshot = computed(() => store.snapshot);
const currentTask = computed(() => snapshot.value?.currentTask || null);
const selectableQueue = computed(() => (snapshot.value?.queue?.items || [])
  .filter((item) => item.serialNumber !== currentTask.value?.id));
const runningJob = computed(() => store.activeJob?.status === 'running');
const statusTone = computed(() => snapshot.value?.statusTone || 'neutral');
const pendingRequireText = computed(() => {
  if (!pendingAction.value) return '';
  if (pendingAction.value.requireText === 'queue-id') return queueId.value || '选择一个编号';
  return pendingAction.value.requireText || '';
});
const pendingTone = computed(() => pendingAction.value?.confirm === 'danger' ? 'danger' : 'default');
const markers = computed(() => snapshot.value?.markers || {});

function actionDisabled(action) {
  if (runningJob.value) return true;
  if (action.id === 'queue.remove' && !selectableQueue.value.length) return true;
  return false;
}

function askAction(action) {
  if (actionDisabled(action)) return;
  queueId.value = selectableQueue.value[0]?.serialNumber || '';
  pendingAction.value = action;
}

async function confirmAction() {
  if (!pendingAction.value) return;
  busy.value = true;
  try {
    const input = pendingAction.value.id === 'queue.remove' ? { id: queueId.value } : {};
    await runAction(pendingAction.value.id, input);
    pendingAction.value = null;
    await refreshState().catch(() => {});
  } catch (error) {
    notify(error.message, 'danger');
  } finally {
    busy.value = false;
  }
}

function statusForAction(action) {
  if (action.id === 'queue.remove' && !selectableQueue.value.length) return '当前没有可删除条目';
  if (runningJob.value) return '等待当前动作结束';
  return '';
}

function setActionRef(id, element) {
  if (element) actionRefs.set(id, element);
  else actionRefs.delete(id);
}

onMounted(() => {
  const query = window.location.hash.split('?')[1] || '';
  const actionId = new URLSearchParams(query).get('action');
  if (!actionId) return;
  focusedActionId.value = actionId;
  nextTick(() => {
    actionRefs.get(actionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});
</script>

<template>
  <section class="view">
    <header class="view-heading">
      <div>
        <p class="eyebrow">Control room / 05</p>
        <h1>运维</h1>
        <p class="view-subtitle">所有动作都走后端白名单，串行执行并写入审计日志。</p>
      </div>
      <div class="view-actions">
        <StatusLamp :tone="statusTone" :label="snapshot?.statusLabel || '状态未知'" />
        <button class="button button-small" type="button" :disabled="runningJob" @click="refreshState().catch((error) => notify(error.message, 'danger'))">
          刷新状态
        </button>
      </div>
    </header>

    <div class="ops-layout">
      <div class="ops-groups">
        <section v-for="group in groups" :key="group.id" class="ops-group panel">
          <header class="ops-group-head">
            <div class="ops-index">{{ group.index }}</div>
            <div>
              <p class="eyebrow">{{ group.id }}</p>
              <h2>{{ group.title }}</h2>
              <p>{{ group.note }}</p>
            </div>
            <div class="ops-group-meta">
              <a v-if="group.configLink" class="ops-config-link" :href="group.configLink.href">
                {{ group.configLink.label }}
                <ArrowUpRight :size="12" aria-hidden="true" />
              </a>
              <span class="badge">{{ group.actions.length }} 个动作</span>
            </div>
          </header>
          <div class="action-list">
            <article
              v-for="action in group.actions"
              :key="action.id"
              :ref="(element) => setActionRef(action.id, element)"
              class="action-card"
              :class="{ danger: action.confirm === 'danger', focused: focusedActionId === action.id }"
            >
              <div class="action-copy">
                <strong>{{ action.label }}</strong>
                <small v-if="focusedActionId === action.id">来自环境诊断，请确认后执行</small>
                <p>{{ action.impact }}</p>
                <small v-if="statusForAction(action)">{{ statusForAction(action) }}</small>
              </div>
              <button
                class="button button-small"
                :class="action.confirm === 'danger' ? 'button-quiet' : action.confirm === 'run' ? 'button-primary' : ''"
                type="button"
                :disabled="actionDisabled(action)"
                @click="askAction(action)"
              >
                {{ action.confirm === 'danger' ? '谨慎执行' : '执行' }}
              </button>
            </article>
          </div>
        </section>
      </div>

      <aside class="ops-aside">
        <section class="ops-summary panel">
          <div class="panel-title">
            <div>
              <p class="eyebrow">Current state</p>
              <h2>当前对象</h2>
            </div>
            <StatusLamp :tone="statusTone" :show-label="false" />
          </div>
          <dl>
            <div><dt>主任务</dt><dd>{{ snapshot?.main?.loaded ? snapshot?.main?.label : '未加载' }}</dd></div>
            <div><dt>run.sh</dt><dd>{{ snapshot?.main?.runAlive ? `PID ${snapshot.main.runPid}` : '未运行' }}</dd></div>
            <div v-if="snapshot?.main?.residualAlive"><dt>残留 e2e</dt><dd>PID {{ (snapshot.main.residualPids || []).join(', ') }}</dd></div>
            <div><dt>当前任务</dt><dd>{{ currentTask?.id || '无' }}</dd></div>
            <div><dt>当前阶段</dt><dd>{{ currentTask?.stage || '空闲' }}</dd></div>
            <div><dt>队列</dt><dd>{{ snapshot?.queue?.count ?? 0 }} 条</dd></div>
            <div><dt>版本</dt><dd>{{ snapshot?.versions?.source || '—' }} / {{ snapshot?.versions?.installed || '未安装' }}</dd></div>
            <div><dt>上次同步</dt><dd>{{ snapshot?.sync?.lastSyncAt ? formatRelative(snapshot.sync.lastSyncAt) : '尚未同步' }}</dd></div>
          </dl>
        </section>

        <section class="ops-summary panel">
          <div class="panel-title">
            <div>
              <p class="eyebrow">Markers</p>
              <h2>状态标记</h2>
            </div>
          </div>
          <div class="marker-list">
            <div :class="{ present: markers.paused }">
              <span>paused</span>
              <strong>{{ markers.paused ? '存在' : '无' }}</strong>
              <small>{{ markers.paused || '主动暂停取任务' }}</small>
            </div>
            <div :class="{ present: markers.blocked }">
              <span>blocked</span>
              <strong>{{ markers.blocked ? '存在' : '无' }}</strong>
              <small>{{ markers.blocked || 'worktree 未就绪' }}</small>
            </div>
            <div :class="{ present: markers.halt, danger: markers.halt }">
              <span>halt</span>
              <strong>{{ markers.halt ? '存在' : '无' }}</strong>
              <small>{{ markers.halt || '队列或清理失败停机' }}</small>
            </div>
          </div>
        </section>

        <section class="ops-summary panel">
          <div class="panel-title">
            <div>
              <p class="eyebrow">Execution policy</p>
              <h2>执行约束</h2>
            </div>
          </div>
          <ul class="policy-list">
            <li>同一时间只允许一个动作执行。</li>
            <li>破坏性动作要求输入确认文本。</li>
            <li>队列删除和 worktree 重建要求流水线已停止。</li>
            <li>控制台不提供任意 shell 执行。</li>
          </ul>
        </section>
      </aside>
    </div>

    <ConfirmDialog
      :open="Boolean(pendingAction)"
      :title="pendingAction?.label || '确认操作'"
      :description="pendingAction?.impact"
      :confirm-label="pendingAction?.label || '执行'"
      :tone="pendingTone"
      :require-text="pendingRequireText"
      :busy="busy"
      @close="pendingAction = null"
      @confirm="confirmAction"
    >
      <div class="confirm-grid">
        <div><span>流水线状态</span><strong>{{ snapshot?.statusLabel || '未知' }}</strong></div>
        <div><span>当前任务</span><strong>{{ currentTask?.id || '无' }}</strong></div>
        <div><span>队列</span><strong>{{ snapshot?.queue?.count ?? 0 }} 条</strong></div>
      </div>
      <label v-if="pendingAction?.id === 'queue.remove'" class="field queue-field">
        <span class="field-label">选择要删除的编号</span>
        <select v-model="queueId" class="select">
          <option v-for="item in selectableQueue" :key="item.serialNumber" :value="item.serialNumber">
            {{ item.serialNumber }} · {{ item.subject }}
          </option>
        </select>
      </label>
      <p v-if="pendingAction?.confirm === 'danger'" class="danger-note">
        该动作会改变运行状态或本地数据；执行输出会在右下角实时显示，并保留审计记录。
      </p>
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

.ops-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 18px;
  align-items: start;
}

.ops-groups {
  display: grid;
  gap: 16px;
}

.ops-group {
  overflow: hidden;
}

.ops-group-head {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 13px;
  align-items: start;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  background:
    repeating-linear-gradient(-45deg, transparent 0 7px, rgba(28, 39, 36, 0.025) 7px 8px),
    rgba(241, 239, 232, 0.55);
}

.ops-index {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--signal);
  color: var(--signal-dark);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 700;
  box-shadow: inset 0 -2px 0 rgba(214, 90, 52, 0.2);
}

.ops-group-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 7px;
}

.ops-config-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--signal-dark);
  font-size: 10.5px;
  font-weight: 700;
  text-decoration: none;
}

.ops-config-link:hover {
  color: var(--copper-dark);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.ops-config-link:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}

.ops-group-head h2 {
  margin: 0 0 3px;
}

.ops-group-head p:not(.eyebrow) {
  margin: 0;
  color: var(--ink-muted);
  font-size: 11.5px;
  line-height: 1.55;
}

.action-list {
  display: grid;
}

.action-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 20px;
  border-left: 3px solid transparent;
  transition:
    background var(--transition),
    border-color var(--transition);
}

.action-card + .action-card {
  border-top: 1px dashed var(--line);
}

.action-card:hover {
  background: rgba(248, 246, 239, 0.58);
}

.action-card.danger {
  border-left-color: rgba(161, 61, 61, 0.28);
}

.action-card.danger:hover {
  border-left-color: var(--danger);
}

.action-card.focused {
  border-left-color: var(--signal);
  background: rgba(214, 90, 52, 0.08);
  box-shadow: inset 0 0 0 1px rgba(214, 90, 52, 0.24);
}

.action-copy {
  min-width: 0;
}

.action-copy strong {
  font-size: 13px;
}

.action-copy p {
  margin: 2px 0 0;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.5;
}

.action-copy small {
  display: block;
  margin-top: 2px;
  color: var(--signal-dark);
  font-size: 10px;
}

.ops-aside {
  position: sticky;
  top: 85px;
  display: grid;
  gap: 14px;
}

.ops-summary {
  padding: 18px;
}

.ops-summary dl {
  display: grid;
  gap: 0;
  margin: 0;
}

.ops-summary dl > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--line);
}

.ops-summary dt {
  color: var(--ink-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.ops-summary dd {
  overflow: hidden;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marker-list {
  display: grid;
  gap: 1px;
  background: var(--line);
}

.marker-list div {
  display: grid;
  grid-template-columns: 62px auto;
  gap: 0 8px;
  padding: 9px;
  background: var(--paper-light);
}

.marker-list span {
  grid-row: span 2;
  align-self: center;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.marker-list strong {
  font-size: 11.5px;
}

.marker-list small {
  overflow: hidden;
  color: var(--ink-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.marker-list div.present {
  background: var(--brass-light);
}

.marker-list div.danger {
  background: var(--danger-light);
  color: var(--danger);
}

.policy-list {
  padding-left: 16px;
  margin: 0;
  color: var(--ink-muted);
  font-size: 11px;
  line-height: 1.55;
}

.policy-list li + li {
  margin-top: 7px;
}

.confirm-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.confirm-grid div {
  display: grid;
  gap: 2px;
  padding: 9px;
  background: var(--paper);
}

.confirm-grid span {
  color: var(--ink-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.confirm-grid strong {
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.queue-field {
  margin-top: 12px;
}

.danger-note {
  padding: 9px 10px;
  margin: 12px 0 0;
  border-left: 3px solid var(--danger);
  background: var(--danger-light);
  color: var(--danger);
  font-size: 10.5px;
  line-height: 1.5;
}

@media (max-width: 1050px) {
  .ops-layout {
    grid-template-columns: 1fr;
  }

  .ops-aside {
    position: static;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .view-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .view-actions {
    width: 100%;
    justify-content: space-between;
  }

  .ops-aside {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .ops-group-head {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .ops-group-meta {
    grid-column: 2;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }

  .action-card {
    align-items: flex-start;
    flex-direction: column;
  }

  .confirm-grid {
    grid-template-columns: 1fr;
  }
}
</style>
