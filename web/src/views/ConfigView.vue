<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { ArrowUpRight, BellRing } from '@lucide/vue';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import DoctorPanel from '../components/DoctorPanel.vue';
import { fetchConfig, fetchDoctor, saveConfig } from '../lib/api.js';
import { sourceLabel } from '../lib/format.js';
import { notify, runAction, useConsoleStore } from '../stores/console.js';

const consoleStore = useConsoleStore();
const config = ref(null);
const loading = ref(true);
const loadError = ref('');
const activeTab = ref('config');
const groupFilter = ref('全部');
const query = ref('');
const drafts = ref({});
const saveOpen = ref(false);
const saving = ref(false);
const saveError = ref('');
const saveResult = ref(null);
const lastSaveNeedsRestart = ref(false);
const saveMode = ref('save');
const doctorReport = ref(null);
const doctorLoading = ref(false);
const doctorError = ref('');

const entries = computed(() => config.value?.groups?.flatMap((group) => group.entries) || []);
const groupNames = computed(() => ['全部', ...(config.value?.groups?.map((group) => group.name) || [])]);
const changedKeys = computed(() => Object.keys(drafts.value));
const changedEntries = computed(() => entries.value.filter((entry) => changedKeys.value.includes(entry.key)));
const restartNeeded = computed(() => changedEntries.value.some((entry) => entry.restart));
const envEntries = computed(() => entries.value.filter((entry) => entry.source === 'env' || entry.source === 'environment'));
const sensitiveEntryCount = computed(() => envEntries.value.filter((entry) => entry.sensitive).length);
const feishuEntry = computed(() => entries.value.find((entry) => entry.key === 'FEISHU_WEBHOOK_URL') || null);
const feishuConfigured = computed(() => Boolean(feishuEntry.value?.configured));
const feishuDraft = computed(() => Boolean(
  feishuEntry.value && Object.prototype.hasOwnProperty.call(drafts.value, feishuEntry.value.key)
));
const notifyTaskKnown = computed(() => Boolean(consoleStore.snapshot));
const notifyTaskLoaded = computed(() => Boolean(consoleStore.snapshot?.notify?.loaded));
const isRestartOperation = computed(() => saveMode.value !== 'save');
const saveDialogTitle = computed(() => {
  if (saveMode.value === 'restart') return '重启主流水线';
  if (saveMode.value === 'save-restart') return '保存并重启流水线';
  return '保存配置';
});
const saveDialogDescription = computed(() => {
  if (saveMode.value === 'restart') {
    return '重启会重新读取安装副本的 .env；当前任务会按中断恢复规则处理。';
  }
  if (saveMode.value === 'save-restart') {
    return '先写入安装副本的 .env，再重启主流水线使新配置生效；当前任务可能被中断。';
  }
  return '这些改动只会写入安装副本的 .env；需要重启流水线后才会全部生效。';
});
const saveDialogConfirmLabel = computed(() => {
  if (saveMode.value === 'restart') return '确认重启';
  if (saveMode.value === 'save-restart') return '保存并重启';
  return '写入 .env';
});
const filteredEntries = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return entries.value.filter((entry) => {
    if (groupFilter.value !== '全部' && entry.group !== groupFilter.value) return false;
    if (!needle) return true;
    return `${entry.key} ${entry.label} ${entry.group}`.toLowerCase().includes(needle);
  });
});
const visibleGroups = computed(() => {
  const result = [];
  for (const entry of filteredEntries.value) {
    let group = result.find((item) => item.name === entry.group);
    if (!group) {
      group = { name: entry.group, entries: [] };
      result.push(group);
    }
    group.entries.push(entry);
  }
  return result;
});

async function loadConfig() {
  loading.value = true;
  try {
    config.value = await fetchConfig();
    loadError.value = '';
    drafts.value = {};
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function loadDoctor() {
  doctorLoading.value = true;
  doctorError.value = '';
  try {
    doctorReport.value = await fetchDoctor();
  } catch (error) {
    doctorError.value = error.message;
  } finally {
    doctorLoading.value = false;
  }
}

function rowValue(entry) {
  if (Object.prototype.hasOwnProperty.call(drafts.value, entry.key)) return drafts.value[entry.key];
  return entry.sensitive ? '' : entry.value;
}

function rowPlaceholder(entry) {
  if (entry.displayOnly) return entry.sensitive ? '敏感值已脱敏，仅预览' : entry.display || '';
  if (!entry.sensitive) return entry.display || '';
  return entry.configured ? '敏感值已配置，留空表示不修改' : '尚未配置，输入新值';
}

function updateEntry(entry, value) {
  const baseline = entry.sensitive ? '' : entry.value;
  const next = { ...drafts.value };
  if (value === baseline) delete next[entry.key];
  else next[entry.key] = value;
  drafts.value = next;
}

function resetDrafts() {
  drafts.value = {};
  saveResult.value = null;
}

function openSave(restart = false) {
  if (!changedKeys.value.length && saveMode.value !== 'restart') return;
  saveError.value = '';
  saveMode.value = restart ? 'save-restart' : 'save';
  saveOpen.value = true;
}

function openRestart() {
  saveError.value = '';
  saveMode.value = 'restart';
  saveOpen.value = true;
}

async function confirmSave() {
  saving.value = true;
  saveError.value = '';
  const mode = saveMode.value;
  let completed = false;
  try {
    if (mode !== 'restart') {
      lastSaveNeedsRestart.value = restartNeeded.value || mode === 'save-restart';
      const result = await saveConfig(drafts.value);
      saveResult.value = result;
      drafts.value = {};
      if (result.groups) {
        config.value = { ...config.value, groups: result.groups, envFile: result.envFile, envExists: true };
      } else {
        await loadConfig();
      }
      notify(`已保存 ${result.changed.length} 项配置`, 'success');
      loadDoctor();
    }
    saveOpen.value = false;
    completed = true;
    if (mode !== 'save') {
      try {
        await runAction('main.restart');
        notify(mode === 'restart' ? '主流水线重启已开始' : '配置已保存；主流水线重启已开始', 'success');
      } catch (error) {
        notify(`${mode === 'restart' ? '重启失败' : '配置已保存，但重启失败'}：${error.message}`, 'danger');
      }
    } else if (lastSaveNeedsRestart.value) {
      notify('配置已保存；需要重启流水线后才能全部生效', 'warn');
    }
  } catch (error) {
    saveError.value = error.message;
  } finally {
    saving.value = false;
    if (completed) saveMode.value = 'save';
  }
}

function displayBefore(entry) {
  if (entry.sensitive) return entry.configured ? '已配置' : '未配置';
  return entry.display || '（空）';
}

function displayAfter(entry) {
  if (entry.sensitive) return drafts.value[entry.key] ? '写入新的敏感值' : '保持不变';
  const value = drafts.value[entry.key];
  return value || '（空）';
}

function switchTab(tab) {
  activeTab.value = tab;
  if (tab === 'doctor' && !doctorReport.value && !doctorLoading.value) loadDoctor();
}

function handleDoctorTarget(target) {
  if (!target) return;
  if (target.view === 'config') {
    switchTab('config');
    groupFilter.value = '全部';
    query.value = target.key || '';
    if (target.key) {
      nextTick(() => {
        document.querySelector(`[data-config-key="${target.key}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });
    }
    return;
  }
  if (target.view === 'operations') {
    const actionQuery = target.actionId ? `?action=${encodeURIComponent(target.actionId)}` : '';
    window.location.hash = `#/operations${actionQuery}`;
  }
}

function goOperations() {
  window.location.hash = '#/operations';
}

function revealFeishuConfig() {
  switchTab('config');
  groupFilter.value = '通知';
  query.value = '';
  nextTick(() => {
    document.querySelector('[data-config-key="FEISHU_WEBHOOK_URL"]')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  });
}

onMounted(() => {
  loadConfig();
  loadDoctor();
});
</script>

<template>
  <section class="view">
    <header class="view-heading">
      <div>
        <p class="eyebrow">Calibration / 04</p>
        <h1>配置与环境</h1>
        <p class="view-subtitle">完整预览 .env；token 等敏感项只显示配置状态，不回显明文。</p>
      </div>
      <div class="view-actions">
        <div class="tab-switch" role="tablist" aria-label="配置页面">
          <button :class="{ active: activeTab === 'config' }" type="button" role="tab" :aria-selected="activeTab === 'config'" @click="switchTab('config')">
            配置
          </button>
          <button :class="{ active: activeTab === 'doctor' }" type="button" role="tab" :aria-selected="activeTab === 'doctor'" @click="switchTab('doctor')">
            环境诊断
          </button>
        </div>
      </div>
    </header>

    <template v-if="activeTab === 'config'">
      <section v-if="config" class="notify-route panel" aria-labelledby="notify-route-title">
        <header class="notify-route-head">
          <span class="notify-route-icon" aria-hidden="true">
            <BellRing :size="17" :stroke-width="1.7" />
          </span>
          <div class="notify-route-copy">
            <p class="eyebrow">Notification route</p>
            <h2 id="notify-route-title">通知链路</h2>
            <p>进度事件每分钟读取一次；本地通知优先，飞书在配置 Webhook 后同步送达。</p>
          </div>
          <span
            class="notify-task-state"
            :class="!notifyTaskKnown ? 'is-unknown' : notifyTaskLoaded ? 'is-live' : 'is-idle'"
          >
            <span aria-hidden="true"></span>
            {{ !notifyTaskKnown ? '正在读取任务状态' : notifyTaskLoaded ? '通知任务在线' : '通知任务未加载' }}
          </span>
        </header>

        <div class="notify-route-grid">
          <article class="notify-route-cell">
            <span class="route-index">01 / 事件</span>
            <strong>{{ notifyTaskLoaded ? '每分钟轮询' : '等待任务加载' }}</strong>
            <small>status.sh → notify.sh</small>
          </article>
          <article class="notify-route-cell">
            <span class="route-index">02 / 本地</span>
            <strong>cmux / macOS</strong>
            <small>优先 cmux，失败自动回退</small>
          </article>
          <article
            class="notify-route-cell"
            :class="{ connected: feishuConfigured, pending: feishuDraft }"
          >
            <span class="route-index">03 / 飞书</span>
            <strong>{{ feishuConfigured ? '已接通' : '未配置' }}</strong>
            <small>{{ feishuConfigured ? 'FEISHU_WEBHOOK_URL 已配置' : '配置后同步推送机器人' }}</small>
            <span v-if="feishuDraft" class="route-draft">有未保存改动</span>
          </article>
          <div class="notify-route-actions">
            <button class="button button-small" type="button" @click="revealFeishuConfig">
              {{ feishuConfigured ? '调整飞书配置' : '配置飞书 Webhook' }}
            </button>
            <a class="notify-ops-link" href="#/operations">
              通知运维
              <ArrowUpRight :size="12" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <div class="config-layout">
      <section class="config-main panel">
        <header class="config-head">
          <div>
            <p class="eyebrow">Effective configuration</p>
            <h2>运行参数</h2>
            <p class="config-path mono-small">{{ config?.envFile || '~/autofix/app/.env' }}</p>
          </div>
          <div class="config-badges">
            <span class="badge" :class="config?.envExists ? 'badge-success' : 'badge-warn'">
              {{ config?.envExists ? `.env 已存在 · ${envEntries.length} 项` : '.env 缺失' }}
            </span>
            <span v-if="sensitiveEntryCount" class="badge">{{ sensitiveEntryCount }} 项已脱敏</span>
            <button
              class="button button-small"
              type="button"
              :disabled="!changedKeys.length"
              @click="openSave()"
            >
              保存配置<template v-if="changedKeys.length"> · {{ changedKeys.length }}</template>
            </button>
            <button
              class="button button-small button-signal"
              type="button"
              :disabled="!changedKeys.length"
              @click="openSave(true)"
            >
              保存并重启
            </button>
          </div>
        </header>

        <div v-if="loadError" class="inline-error">
          <span>{{ loadError }}</span>
          <button class="button button-small" type="button" @click="loadConfig">重试</button>
        </div>
        <div v-else-if="loading && !config" class="config-loading">正在读取配置…</div>
        <template v-else>
          <div class="config-toolbar">
            <div class="group-filter">
              <button
                v-for="name in groupNames"
                :key="name"
                class="filter-chip"
                :class="{ active: groupFilter === name }"
                type="button"
                @click="groupFilter = name"
              >
                {{ name }}
              </button>
            </div>
            <label class="config-search">
              <span class="sr-only">搜索配置项</span>
              <span aria-hidden="true">⌕</span>
              <input v-model="query" type="search" placeholder="搜索键名或说明" />
            </label>
          </div>

          <div v-if="saveResult" class="save-result">
            <div>
              <strong>配置已保存</strong>
              <span>{{ saveResult.changed.length }} 项 · {{ saveResult.backupPath || '没有旧文件需要备份' }}</span>
            </div>
            <div class="save-result-actions">
              <span v-if="lastSaveNeedsRestart" class="badge badge-warn">需要重启生效</span>
              <button v-if="lastSaveNeedsRestart" class="button button-small" type="button" @click="openRestart">
                重启并加载
              </button>
            </div>
          </div>

          <div v-for="group in visibleGroups" :key="group.name" class="config-group">
            <div class="group-title">
              <h3>{{ group.name }}</h3>
              <span>{{ group.entries.length }} 项</span>
            </div>
            <div class="config-table">
              <article
                v-for="entry in group.entries"
                :key="entry.key"
                :data-config-key="entry.key"
                class="config-row"
                :class="{ changed: changedKeys.includes(entry.key), readonly: entry.displayOnly }"
              >
                <div class="config-key">
                  <strong>{{ entry.label }}</strong>
                  <code v-if="entry.label !== entry.key">{{ entry.key }}</code>
                  <small v-if="entry.help">{{ entry.help }}</small>
                </div>
                <div class="config-value">
                  <div class="value-input">
                    <input
                      class="input"
                      :type="entry.sensitive ? 'password' : 'text'"
                      :value="rowValue(entry)"
                      :placeholder="rowPlaceholder(entry)"
                      :disabled="entry.editable === false"
                      :autocomplete="entry.sensitive ? 'new-password' : 'off'"
                      @input="updateEntry(entry, $event.target.value)"
                    />
                    <span v-if="entry.sensitive" class="secret-state" :class="entry.configured ? 'configured' : ''">
                      {{ entry.displayOnly && entry.configured ? '已脱敏' : entry.configured ? '已配置' : '未配置' }}
                    </span>
                  </div>
                  <div class="value-meta">
                    <span class="badge" :class="entry.source === 'environment' ? 'badge-warn' : ''">{{ sourceLabel(entry.source) }}</span>
                    <span v-if="entry.sensitive" class="badge">敏感</span>
                    <span v-if="entry.restart" class="badge">重启生效</span>
                    <span v-if="entry.source === 'environment'" class="badge badge-warn">环境变量覆盖</span>
                    <span v-else-if="entry.displayOnly" class="badge">只读预览</span>
                  </div>
                </div>
              </article>
            </div>
          </div>
          <div v-if="!visibleGroups.length" class="empty-state">
            <div><strong>没有匹配项</strong><span>换一个分组或搜索词。</span></div>
          </div>
        </template>

        <footer v-if="changedKeys.length" class="save-bar">
          <div>
            <strong>{{ changedKeys.length }} 项待保存</strong>
            <span v-if="restartNeeded">其中包含需要重启的参数</span>
            <span v-else>保存后立即写入 .env；也可以保存并重启</span>
          </div>
          <div class="inline">
            <button class="button button-small button-quiet" type="button" @click="resetDrafts">撤销改动</button>
            <button class="button button-small" type="button" @click="openSave()">保存配置</button>
            <button class="button button-small button-signal" type="button" @click="openSave(true)">保存并重启</button>
          </div>
        </footer>
      </section>

      <aside class="config-aside">
        <section class="config-note panel">
          <p class="eyebrow">Safety notes</p>
          <h2>写入规则</h2>
          <ul>
            <li>只允许修改白名单里的配置项。</li>
            <li>环境变量优先级最高；被环境变量覆盖的项不能从控制台修改。</li>
            <li>未列入白名单的 .env 项只读展示，敏感值仅显示为已脱敏。</li>
            <li>保存使用临时文件 + rename，旧文件保留时间戳备份。</li>
            <li>token 不回显，也不会进入审计日志。</li>
            <li>默认只保存；「保存并重启」会在确认后重启主流水线。</li>
          </ul>
        </section>
        <section class="config-note panel">
          <p class="eyebrow">Runtime reminder</p>
          <h2>加载时机</h2>
          <p>路径、模型、同步时段、token 等配置都在进程启动时读取；保存后可立即确认重启，也可稍后到运维页处理。</p>
          <button class="button button-small" type="button" @click="goOperations">查看运维操作</button>
        </section>
        </aside>
      </div>
    </template>

    <DoctorPanel
      v-else
      :report="doctorReport"
      :loading="doctorLoading"
      :error="doctorError"
      @refresh="loadDoctor"
      @navigate="handleDoctorTarget"
    />

    <ConfirmDialog
      :open="saveOpen"
      :title="saveDialogTitle"
      :description="saveDialogDescription"
      :confirm-label="saveDialogConfirmLabel"
      :tone="isRestartOperation ? 'danger' : 'default'"
      :require-text="isRestartOperation ? '确认' : ''"
      :busy="saving"
      @close="saveOpen = false"
      @confirm="confirmSave"
    >
      <div v-if="isRestartOperation" class="restart-note">
        <strong>重启会中断当前任务</strong>
        <span>主流水线会先停止再重新加载；正在执行的动作会阻止重启。当前任务会按中断恢复规则续做。</span>
      </div>
      <div v-if="!isRestartOperation" class="change-list">
        <div v-for="entry in changedEntries" :key="entry.key" class="change-row">
          <code>{{ entry.key }}</code>
          <span>{{ displayBefore(entry) }}</span>
          <span aria-hidden="true">→</span>
          <strong>{{ displayAfter(entry) }}</strong>
        </div>
      </div>
      <div v-if="!isRestartOperation" class="backup-note">
        <span>备份路径</span>
        <code>{{ config?.envFile }}.&lt;时间戳&gt;.bak</code>
      </div>
      <p v-if="saveError" class="save-error">{{ saveError }}</p>
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

.notify-route {
  position: relative;
  overflow: hidden;
  padding: 18px 20px 16px;
  background:
    linear-gradient(118deg, rgba(47, 117, 101, 0.08), transparent 46%),
    rgba(248, 246, 239, 0.94);
}

.notify-route::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: repeating-linear-gradient(90deg, var(--copper) 0 34px, transparent 34px 41px);
  content: "";
}

.notify-route-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.notify-route-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(47, 117, 101, 0.28);
  border-radius: var(--radius-small);
  background: var(--copper-light);
  color: var(--copper-dark);
}

.notify-route-copy {
  flex: 1;
  min-width: 0;
}

.notify-route-copy h2 {
  margin: 0 0 2px;
  font-size: 22px;
}

.notify-route-copy p:not(.eyebrow) {
  margin: 0;
  color: var(--ink-muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.notify-task-state {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink-muted);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.notify-task-state > span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-muted);
}

.notify-task-state.is-live {
  border-color: rgba(47, 117, 101, 0.3);
  background: var(--copper-light);
  color: var(--copper-dark);
}

.notify-task-state.is-live > span {
  background: var(--copper);
  box-shadow: 0 0 0 3px rgba(47, 117, 101, 0.12);
}

.notify-task-state.is-idle {
  border-color: rgba(178, 128, 45, 0.32);
  background: var(--brass-light);
  color: #7e591b;
}

.notify-task-state.is-idle > span {
  background: var(--brass);
}

.notify-route-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(140px, auto);
  gap: 1px;
  margin-top: 14px;
  border: 1px solid var(--line);
  background: var(--line);
}

.notify-route-cell {
  position: relative;
  display: grid;
  align-content: start;
  gap: 2px;
  min-height: 72px;
  padding: 11px 12px;
  background: rgba(248, 246, 239, 0.92);
}

.notify-route-cell::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 2px;
  background: transparent;
  content: "";
}

.notify-route-cell.connected {
  background: var(--copper-light);
}

.notify-route-cell.connected::before {
  background: var(--copper);
}

.notify-route-cell.pending::before {
  background: var(--brass);
}

.route-index {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.notify-route-cell strong {
  font-size: 12.5px;
}

.notify-route-cell small {
  color: var(--ink-muted);
  font-size: 10px;
  line-height: 1.4;
}

.route-draft {
  justify-self: start;
  padding: 1px 5px;
  border-radius: var(--radius-small);
  background: var(--brass-light);
  color: #7e591b;
  font-size: 9px;
  font-weight: 700;
}

.notify-route-actions {
  display: grid;
  align-content: center;
  justify-items: stretch;
  gap: 5px;
  padding: 9px 11px;
  background: var(--paper-light);
}

.notify-ops-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 30px;
  color: var(--signal-dark);
  font-size: 10.5px;
  font-weight: 700;
  text-decoration: none;
}

.notify-ops-link:hover {
  color: var(--copper-dark);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.notify-ops-link:focus-visible {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}

.tab-switch {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-deep);
}

.tab-switch button {
  min-height: 33px;
  padding: 5px 13px;
  border: 0;
  border-radius: var(--radius-small);
  background: transparent;
  color: var(--ink-muted);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}

.tab-switch button.active {
  background: var(--ink);
  color: var(--paper-light);
  box-shadow: inset 0 -2px 0 var(--signal);
}

.config-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  gap: 18px;
  align-items: start;
}

.config-main {
  padding: 21px;
}

.config-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.config-head h2 {
  margin: 0 0 3px;
}

.config-path {
  margin: 0;
  color: var(--ink-muted);
}

.config-badges,
.save-result-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
}

.config-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
}

.group-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.filter-chip {
  min-height: 31px;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-small);
  background: transparent;
  color: var(--ink-muted);
  font-size: 10.5px;
  cursor: pointer;
}

.filter-chip.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper-light);
}

.config-search {
  display: flex;
  align-items: center;
  gap: 5px;
  width: min(240px, 40%);
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-light);
  color: var(--ink-muted);
}

.config-search input {
  width: 100%;
  min-height: 35px;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 11.5px;
}

.save-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid rgba(47, 117, 101, 0.28);
  border-left: 3px solid var(--copper);
  background: var(--copper-light);
}

.save-result strong,
.save-result span {
  display: block;
}

.save-result span {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.save-result .badge {
  display: inline-flex;
}

.config-group + .config-group {
  margin-top: 18px;
}

.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}

.group-title h3 {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.group-title span {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.config-table {
  display: grid;
}

.config-row {
  display: grid;
  grid-template-columns: minmax(210px, 0.78fr) minmax(0, 1.2fr);
  gap: 15px;
  padding: 12px 5px;
  border-bottom: 1px dashed var(--line);
}

.config-row.changed {
  background: linear-gradient(90deg, rgba(214, 90, 52, 0.06), transparent 50%);
}

.config-row.readonly {
  background: rgba(248, 246, 239, 0.52);
}

.config-key {
  display: grid;
  align-content: start;
  gap: 2px;
}

.config-key strong {
  font-size: 12.5px;
}

.config-key code {
  color: var(--signal-dark);
  font-size: 10px;
}

.config-key small {
  color: var(--ink-muted);
  font-size: 10px;
}

.config-value {
  display: grid;
  gap: 5px;
}

.value-input {
  position: relative;
  display: flex;
  align-items: center;
}

.value-input .input {
  padding-right: 82px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.secret-state {
  position: absolute;
  right: 7px;
  padding: 2px 5px;
  border-radius: var(--radius-small);
  background: var(--brass-light);
  color: #7e591b;
  font-size: 9.5px;
  font-weight: 700;
}

.secret-state.configured {
  background: var(--copper-light);
  color: var(--copper-dark);
}

.value-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.save-bar {
  position: sticky;
  bottom: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 13px;
  margin: 18px -5px -5px;
  border: 1px solid var(--ink);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--paper-light);
  box-shadow: var(--shadow-small);
}

.save-bar strong,
.save-bar span {
  display: block;
}

.save-bar span {
  color: rgba(248, 246, 239, 0.55);
  font-size: 10px;
}

.config-aside {
  display: grid;
  gap: 12px;
  position: sticky;
  top: 85px;
}

.config-note {
  padding: 16px;
}

.config-note h2 {
  margin-bottom: 10px;
  font-size: 19px;
}

.config-note ul {
  padding-left: 16px;
  margin: 0;
  color: var(--ink-muted);
  font-size: 11.5px;
}

.config-note li + li {
  margin-top: 6px;
}

.config-note p {
  color: var(--ink-muted);
  font-size: 11.5px;
}

.config-loading {
  display: grid;
  min-height: 400px;
  place-items: center;
  color: var(--ink-muted);
}

.inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px;
  border-left: 3px solid var(--danger);
  background: var(--danger-light);
  color: var(--danger);
  font-size: 12px;
}

.change-list {
  display: grid;
  gap: 1px;
  background: var(--line);
}

.change-row {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
  padding: 8px 9px;
  background: var(--paper);
  font-size: 11px;
}

.change-row code {
  overflow-wrap: anywhere;
  font-size: 10px;
}

.change-row span {
  color: var(--ink-muted);
}

.change-row strong {
  overflow-wrap: anywhere;
  font-size: 10.5px;
}

.restart-note {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-left: 3px solid var(--danger);
  background: var(--danger-light);
}

.restart-note strong {
  color: var(--danger);
  font-size: 12.5px;
}

.restart-note span {
  color: var(--ink-soft);
  font-size: 11px;
  line-height: 1.6;
}

.backup-note {
  display: grid;
  gap: 2px;
  padding: 10px;
  margin-top: 10px;
  border: 1px dashed var(--line);
}

.backup-note span {
  color: var(--ink-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.backup-note code {
  overflow-wrap: anywhere;
  font-size: 10.5px;
}

.save-error {
  margin: 10px 0 0;
  color: var(--danger);
  font-size: 12px;
}

@media (max-width: 1050px) {
  .config-layout {
    grid-template-columns: 1fr;
  }

  .config-aside {
    position: static;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .notify-route-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .notify-route-actions {
    grid-column: 1 / -1;
    grid-template-columns: auto auto;
    align-items: center;
    justify-content: end;
  }

  .tab-switch button,
  .filter-chip,
  .config-search,
  .config-search input {
    min-height: 44px;
  }
}

@media (max-width: 740px) {
  .view-heading,
  .config-head,
  .config-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .notify-route-head {
    flex-wrap: wrap;
  }

  .notify-task-state {
    margin-left: 48px;
  }

  .notify-route-grid {
    grid-template-columns: 1fr;
  }

  .notify-route-actions {
    display: grid;
    grid-column: auto;
    grid-template-columns: 1fr;
  }

  .config-search {
    width: 100%;
  }

  .config-row {
    grid-template-columns: 1fr;
    gap: 7px;
  }

  .config-aside {
    grid-template-columns: 1fr;
  }

  .save-bar {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
