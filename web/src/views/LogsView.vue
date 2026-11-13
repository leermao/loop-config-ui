<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import StatusLamp from '../components/StatusLamp.vue';
import { fetchLogChunk, fetchLogSources, logDownloadUrl, logStreamUrl } from '../lib/api.js';
import { formatBytes, formatDateTime, linkSegments } from '../lib/format.js';
import { notify, useConsoleStore } from '../stores/console.js';

const store = useConsoleStore();
const staticSources = ref([]);
const selectedKey = ref('static:log');
const text = ref('');
const query = ref('');
const follow = ref(true);
const streamState = ref('idle');
const streamError = ref('');
const loadingSources = ref(true);
const scrollRef = ref(null);
const offset = ref(0);
let source = null;
let retryTimer = null;
let pollTimer = null;
let sseFailures = 0;
let pollBusy = false;

const taskSources = computed(() => {
  const task = store.snapshot?.currentTask;
  if (!task) return [];
  return [
    {
      id: `task:${task.id}:test.log`,
      label: '当前任务 · 测试日志',
      name: 'test.log',
      taskId: task.id,
      exists: true,
      description: '当前任务的测试输出和失败详情。'
    },
    {
      id: `task:${task.id}:yunxiao.out`,
      label: '当前任务 · 云效回写',
      name: 'yunxiao.out',
      taskId: task.id,
      exists: true,
      description: '任务完成后回写云效状态的接口输出。'
    },
    {
      id: `task:${task.id}:codex.md`,
      label: '当前任务 · 修复输出',
      name: 'codex.md',
      taskId: task.id,
      exists: true,
      description: 'codex 修复过程的最终输出与 RESULT。'
    }
  ];
});

const sources = computed(() => [
  ...staticSources.value.map((item) => ({ ...item, key: `static:${item.id}` })),
  ...taskSources.value.map((item) => ({ ...item, key: item.id }))
]);

const selectedSource = computed(() => sources.value.find((item) => item.key === selectedKey.value) || sources.value[0] || null);
const allLines = computed(() => text.value ? text.value.split('\n') : []);
const filteredLines = computed(() => {
  const needle = query.value.trim().toLowerCase();
  const lines = needle
    ? allLines.value.filter((line) => line.toLowerCase().includes(needle))
    : allLines.value;
  return lines.slice(-2000);
});
const visibleText = computed(() => filteredLines.value.join('\n'));
const emptyMessage = computed(() => {
  if (query.value.trim()) return '没有匹配的日志行';
  const current = selectedSource.value;
  if (!current) return '请选择日志来源';
  if (current.id === 'main-sync' && !current.exists) {
    return '尚无 main 合并记录；任务开始前需要合并 origin/main 时才会生成';
  }
  if (current.id === 'launchd') return '主进程没有输出；正常运行且没有脚本错误时为空';
  if (current.id === 'deps' && !current.exists) return '尚无依赖安装记录；安装依赖时才会生成';
  if (!current.exists) return '日志文件尚不存在';
  return '日志文件还是空的';
});
const streamLabel = computed(() => ({
  live: '实时',
  connecting: '连接中',
  reconnecting: '重连中',
  polling: '轮询读取',
  paused: '已暂停',
  idle: '未连接'
}[streamState.value] || streamState.value));
const streamTone = computed(() => streamState.value === 'live'
  ? 'running'
  : streamState.value === 'idle'
    ? 'neutral'
    : 'warn');

async function loadSources() {
  loadingSources.value = true;
  try {
    const payload = await fetchLogSources();
    staticSources.value = payload.sources || [];
    if (!sources.value.some((item) => item.key === selectedKey.value)) {
      selectedKey.value = sources.value[0]?.key || '';
    }
  } catch (error) {
    streamError.value = error.message;
  } finally {
    loadingSources.value = false;
  }
}

function disconnect() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  stopPolling();
  if (source) {
    source.close();
    source = null;
  }
  streamState.value = 'idle';
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce({ resetText = false } = {}) {
  const current = selectedSource.value;
  if (!current || pollBusy) return;
  pollBusy = true;
  try {
    const payload = await fetchLogChunk({
      name: current.name,
      taskId: current.taskId,
      offset: offset.value
    });
    if (selectedSource.value?.key !== current.key) return;
    if (resetText || payload.truncated) text.value = payload.text || '';
    else text.value += payload.text || '';
    if (Number.isFinite(payload.offset)) offset.value = payload.offset;
    scrollToBottom();
  } catch (error) {
    streamError.value = `轮询读取失败：${error.message}`;
  } finally {
    pollBusy = false;
  }
}

function startPolling(reason = '') {
  if (pollTimer) return;
  if (source) {
    source.close();
    source = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  streamState.value = 'polling';
  if (reason) streamError.value = reason;
  pollOnce({ resetText: !text.value });
  pollTimer = setInterval(() => pollOnce(), 1500);
}

function scrollToBottom() {
  nextTick(() => {
    if (!scrollRef.value || !follow.value) return;
    scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
  });
}

function connect({ reset = true, fresh = false } = {}) {
  disconnect();
  if (fresh) sseFailures = 0;
  const current = selectedSource.value;
  if (!current) return;
  if (reset) {
    text.value = '';
    offset.value = 0;
  }
  streamError.value = '';
  streamState.value = 'connecting';
  const url = logStreamUrl({
    name: current.name,
    taskId: current.taskId,
    offset: reset ? undefined : offset.value
  });
  const currentSource = new EventSource(url);
  source = currentSource;
  currentSource.onopen = () => {
    if (source !== currentSource) return;
    sseFailures = 0;
    stopPolling();
    streamState.value = 'live';
    streamError.value = '';
  };
  currentSource.addEventListener('init', (event) => {
    if (source !== currentSource) return;
    try {
      const payload = JSON.parse(event.data);
      if (reset) text.value = payload.text || '';
      offset.value = Number.isFinite(payload.offset) ? payload.offset : offset.value;
      sseFailures = 0;
      stopPolling();
      streamState.value = 'live';
      streamError.value = '';
      scrollToBottom();
    } catch (error) {
      streamError.value = `日志初始化失败：${error.message}`;
    }
  });
  currentSource.addEventListener('chunk', (event) => {
    if (source !== currentSource) return;
    try {
      const payload = JSON.parse(event.data);
      if (payload.truncated) text.value = payload.text || '';
      else text.value += payload.text || '';
      offset.value = Number.isFinite(payload.offset) ? payload.offset : offset.value;
      scrollToBottom();
    } catch (error) {
      streamError.value = `日志增量解析失败：${error.message}`;
    }
  });
  currentSource.onerror = (event) => {
    if (source !== currentSource) return;
    if (event.data) {
      try {
        streamError.value = JSON.parse(event.data).error || '日志流异常';
      } catch {
        streamError.value = '日志流异常';
      }
      return;
    }
    currentSource.close();
    source = null;
    sseFailures += 1;
    if (sseFailures >= 2) {
      startPolling('实时日志流不可用，已自动切换为轮询读取；数据仍会持续刷新。');
      return;
    }
    streamState.value = 'reconnecting';
    streamError.value = '实时日志流连接中断，正在重试…';
    retryTimer = setTimeout(() => connect({ reset: false }), 1800);
  };
}

function lineTone(line) {
  if (/❌|⛔|失败|错误|fatal|error|traceback/i.test(line)) return 'danger';
  if (/⚠|warn|blocked|halt|暂停|不一致/i.test(line)) return 'warn';
  if (/✅|成功|完成|passed|PASS/i.test(line)) return 'success';
  return 'neutral';
}

function selectSource(key) {
  selectedKey.value = key;
  connect({ reset: true, fresh: true });
}

function retryLive() {
  streamError.value = '';
  connect({ reset: false, fresh: true });
}

async function copyView() {
  try {
    await navigator.clipboard.writeText(visibleText.value);
    notify('当前日志视图已复制', 'success');
  } catch (error) {
    notify(`复制失败：${error.message}`, 'danger');
  }
}

function downloadUrl() {
  const current = selectedSource.value;
  return current ? logDownloadUrl({ name: current.name, taskId: current.taskId }) : '#';
}

watch(filteredLines, scrollToBottom);

onMounted(async () => {
  await loadSources();
  connect({ reset: true, fresh: true });
});

onBeforeUnmount(disconnect);
</script>

<template>
  <section class="view">
    <header class="view-heading">
      <div>
        <p class="eyebrow">Signal recorder / 03</p>
        <h1>日志</h1>
        <p class="view-subtitle">实时读取进度、launchd、通知、依赖和当前任务输出。</p>
      </div>
      <div class="view-actions">
        <StatusLamp :tone="streamTone" :label="streamLabel" />
        <button class="button button-small" type="button" :disabled="loadingSources" @click="loadSources">
          {{ loadingSources ? '读取中…' : '刷新来源' }}
        </button>
      </div>
    </header>

    <div class="log-console">
      <aside class="source-panel panel">
        <div class="panel-title">
          <div>
            <p class="eyebrow">Sources</p>
            <h2>日志来源</h2>
          </div>
          <span class="muted mono-small">{{ sources.length }}</span>
        </div>
        <div v-if="loadingSources && !sources.length" class="source-loading">正在读取日志索引…</div>
        <button
          v-for="item in sources"
          :key="item.key"
          class="source-item"
          :class="{ active: selectedKey === item.key }"
          type="button"
          @click="selectSource(item.key)"
        >
          <span class="source-state" :class="{ exists: item.exists }" aria-hidden="true"></span>
          <span class="source-copy">
            <strong>{{ item.label || item.id }}</strong>
            <small>{{ item.file || item.name }}<template v-if="item.size"> · {{ formatBytes(item.size) }}</template></small>
          </span>
          <span v-if="item.mtime" class="source-mtime">{{ formatDateTime(item.mtime) }}</span>
        </button>
        <div class="source-note">
          <span class="badge">只读</span>
          <p>控制台只读取和展示日志，不会清空或改写文件。</p>
        </div>
      </aside>

      <section class="viewer panel">
        <header class="viewer-head">
          <div>
            <p class="eyebrow">{{ selectedSource?.file || selectedSource?.name || 'No source' }}</p>
            <h2>{{ selectedSource?.label || '选择日志来源' }}</h2>
            <p v-if="selectedSource?.description" class="source-description">
              {{ selectedSource.description }}
            </p>
          </div>
          <div class="viewer-meta">
            <span class="badge">{{ filteredLines.length }} 行</span>
            <span class="badge">{{ query ? '已筛选' : '全量尾部' }}</span>
          </div>
        </header>

        <div class="log-toolbar">
          <label class="search-box">
            <span class="sr-only">搜索日志</span>
            <span aria-hidden="true">⌕</span>
            <input v-model="query" type="search" placeholder="搜索关键字、编号或错误级别" />
          </label>
          <button
            class="button button-small"
            :class="follow ? 'button-primary' : ''"
            type="button"
            @click="follow = !follow"
          >
            {{ follow ? '自动跟随' : '跟随已暂停' }}
          </button>
          <button class="button button-small" type="button" @click="copyView">复制视图</button>
          <a class="button button-small" :href="downloadUrl()" download>下载文件</a>
        </div>

        <div v-if="streamError" class="inline-error">
          <span>{{ streamError }}</span>
          <button class="button button-small" type="button" @click="retryLive">重试实时流</button>
        </div>

        <div ref="scrollRef" class="log-view" role="log" aria-live="polite" tabindex="0">
          <div v-if="!filteredLines.length" class="log-empty">
            <span>{{ emptyMessage }}</span>
          </div>
          <div
            v-for="(line, index) in filteredLines"
            :key="`${index}-${line.slice(0, 24)}`"
            class="log-line"
            :class="`tone-${lineTone(line)}`"
          >
            <span class="line-number">{{ String(index + 1).padStart(4, '0') }}</span>
            <span class="line-copy">
              <template v-for="(part, partIndex) in linkSegments(line || ' ')" :key="`${index}-${partIndex}`">
                <a
                  v-if="part.type === 'link'"
                  :href="part.value"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ part.value }}</a>
                <template v-else>{{ part.value }}</template>
              </template>
            </span>
          </div>
        </div>
        <footer class="viewer-foot">
          <span class="muted mono-small">{{ streamState === 'polling' ? '轮询模式' : '实时模式' }} · 偏移 {{ offset }} · 最多渲染最后 2000 行</span>
          <button class="button button-small button-quiet" type="button" @click="connect({ reset: true })">重新加载</button>
        </footer>
      </section>
    </div>
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

.log-console {
  display: grid;
  grid-template-columns: minmax(230px, 0.58fr) minmax(0, 2fr);
  gap: 18px;
  align-items: start;
}

.source-panel {
  position: sticky;
  top: 85px;
  max-height: calc(100vh - 105px);
  overflow: auto;
  padding: 18px 12px 12px;
}

.source-panel .panel-title {
  padding: 0 5px;
}

.source-loading {
  padding: 24px 8px;
  color: var(--ink-muted);
  font-size: 11.5px;
}

.source-item {
  display: grid;
  grid-template-columns: 7px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 10px 8px;
  border: 0;
  border-left: 2px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.source-item:hover {
  background: var(--paper-deep);
}

.source-item.active {
  border-left-color: var(--signal);
  background: rgba(214, 90, 52, 0.08);
}

.source-state {
  width: 6px;
  height: 6px;
  border: 1px solid var(--ink-muted);
  border-radius: 50%;
}

.source-state.exists {
  border-color: var(--copper);
  background: var(--copper);
}

.source-copy {
  display: grid;
  min-width: 0;
}

.source-copy strong {
  overflow: hidden;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-copy small {
  overflow: hidden;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-mtime {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9.5px;
}

.source-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 12px 6px 0;
  margin-top: 10px;
  border-top: 1px solid var(--line);
}

.source-note p {
  margin: 0;
  color: var(--ink-muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.viewer {
  min-width: 0;
  overflow: hidden;
}

.viewer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 18px 0;
}

.viewer-head h2 {
  margin: 0;
}

.source-description {
  max-width: 680px;
  margin: 5px 0 0;
  color: var(--ink-muted);
  font-size: 12px;
  line-height: 1.55;
}

.viewer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.log-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}

.search-box {
  display: flex;
  flex: 1 1 220px;
  align-items: center;
  gap: 6px;
  min-width: 180px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper-light);
  color: var(--ink-muted);
}

.search-box input {
  width: 100%;
  min-height: 38px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
}

.inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 17px;
  border-bottom: 1px solid rgba(161, 61, 61, 0.25);
  background: var(--danger-light);
  color: var(--danger);
  font-size: 12px;
}

.log-view {
  min-height: 540px;
  max-height: calc(100vh - 320px);
  overflow: auto;
  padding: 9px 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.02), transparent 30%),
    #19221f;
  color: #c8d2cc;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.58;
}

.log-line {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  min-height: 18px;
  padding: 0 12px 0 0;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.035);
}

.line-number {
  padding-right: 9px;
  color: #71817a;
  text-align: right;
  user-select: none;
}

.line-copy {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.line-copy a {
  color: #9bd4c4;
  text-decoration-color: rgba(155, 212, 196, 0.45);
  text-underline-offset: 2px;
}

.line-copy a:hover {
  color: #c8ebe2;
  text-decoration-color: currentColor;
}

.line-copy a:focus-visible {
  outline: 2px solid #9bd4c4;
  outline-offset: 2px;
}

.tone-danger .line-copy {
  color: #f0a3a3;
}

.tone-warn .line-copy {
  color: #e4c57c;
}

.tone-success .line-copy {
  color: #83c9b7;
}

.log-empty {
  display: grid;
  min-height: 500px;
  place-items: center;
  color: #819089;
}

.viewer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 12px;
  border-top: 1px solid rgba(28, 39, 36, 0.3);
  background: var(--paper);
}

@media (max-width: 900px) {
  .log-console {
    grid-template-columns: 1fr;
  }

  .source-panel {
    position: static;
    max-height: none;
  }

  .source-panel > .source-item {
    display: inline-grid;
    width: calc(50% - 4px);
    vertical-align: top;
  }

  .log-view {
    max-height: 60vh;
  }

  .search-box,
  .search-box input {
    min-height: 44px;
  }
}

@media (max-width: 700px) {
  .view-heading,
  .viewer-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .view-actions {
    width: 100%;
    justify-content: space-between;
  }

  .source-panel > .source-item {
    display: grid;
    width: 100%;
  }

  .log-line {
    grid-template-columns: 36px minmax(0, 1fr);
  }
}
</style>
