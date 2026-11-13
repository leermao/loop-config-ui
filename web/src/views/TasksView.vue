<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import ConfirmDialog from '../components/ConfirmDialog.vue';
import MarkdownPane from '../components/MarkdownPane.vue';
import StatusLamp from '../components/StatusLamp.vue';
import {
  fetchTask,
  fetchTaskFile,
  fetchTasks,
  taskFileUrl
} from '../lib/api.js';
import {
  artifactLabel,
  formatBytes,
  isImage,
  isMarkdown,
  isPdf,
  priorityLabel,
  taskSourceLabel
} from '../lib/format.js';
import {
  notify,
  refreshState,
  runAction,
  useConsoleStore
} from '../stores/console.js';

const store = useConsoleStore();
const payload = ref(null);
const loading = ref(true);
const loadError = ref('');
const detail = ref(null);
const detailLoading = ref(false);
const detailError = ref('');
const selectedLookup = ref('');
const selectedArtifact = ref('');
const artifactText = ref('');
const artifactLoading = ref(false);
const artifactError = ref('');
const deleteOpen = ref(false);
const deleteBusy = ref(false);
let reloadTimer;

const items = computed(() => payload.value?.items || []);
const groups = computed(() => [
  { id: 'current', label: '当前任务', items: items.value.filter((item) => item.source === 'current') },
  { id: 'queue', label: '队列', items: items.value.filter((item) => item.source === 'queue') },
  { id: 'manual', label: '人工跟进', items: items.value.filter((item) => item.source === 'manual') }
].filter((group) => group.items.length));
const selected = computed(() => items.value.find((item) => item.lookupId === selectedLookup.value) || null);
const currentTask = computed(() => payload.value?.currentTask || null);

const artifacts = computed(() => {
  const files = detail.value?.files || [];
  const order = ['task.json', '00-缺陷详情.md', 'design.md', 'codex.md', 'test.log', 'diff.patch', 'review.md', 'comment.md', 'err', 'yunxiao.out'];
  return [...files].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai === -1 ? 100 : ai) - (bi === -1 ? 100 : bi) || a.name.localeCompare(b.name);
  });
});

const selectedFile = computed(() => artifacts.value.find((file) => file.name === selectedArtifact.value) || null);
const attachments = computed(() => detail.value?.attachments || []);
const deleteRequireText = computed(() => selected.value?.id || '');

function preferredArtifact(files) {
  const names = files.map((file) => file.name);
  return ['design.md', 'test.log', 'diff.patch', 'review.md', 'comment.md', '00-缺陷详情.md', 'task.json']
    .find((name) => names.includes(name)) || files[0]?.name || '';
}

async function loadList({ preserve = true } = {}) {
  loading.value = true;
  try {
    payload.value = await fetchTasks();
    loadError.value = '';
    const preferred = preserve && selectedLookup.value
      ? items.value.find((item) => item.lookupId === selectedLookup.value)
      : null;
    const target = preferred
      || items.value.find((item) => item.lookupId === store.selectedTaskId)
      || items.value.find((item) => item.source === 'current')
      || items.value[0];
    if (target && target.lookupId !== selectedLookup.value) {
      await selectItem(target);
    } else if (!target) {
      selectedLookup.value = '';
      detail.value = null;
    } else if (target.lookupId === selectedLookup.value) {
      await loadDetail(target.lookupId, { keepArtifact: true });
    }
  } catch (error) {
    loadError.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function selectItem(item) {
  if (!item) return;
  store.selectedTaskId = item.lookupId;
  if (selectedLookup.value === item.lookupId && detail.value) return;
  selectedLookup.value = item.lookupId;
  await loadDetail(item.lookupId);
}

async function loadDetail(id, { keepArtifact = false } = {}) {
  detailLoading.value = true;
  detailError.value = '';
  try {
    detail.value = await fetchTask(id);
    const next = keepArtifact && artifacts.value.some((file) => file.name === selectedArtifact.value)
      ? selectedArtifact.value
      : preferredArtifact(artifacts.value);
    if (next) await selectArtifact(next);
    else {
      selectedArtifact.value = '';
      artifactText.value = '';
    }
  } catch (error) {
    detailError.value = error.message;
    detail.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function selectArtifact(name) {
  selectedArtifact.value = name;
  if (!name || !detail.value) return;
  if (name === 'task.json') {
    artifactText.value = JSON.stringify(detail.value.task ?? {}, null, 2);
    artifactError.value = '';
    return;
  }
  if (isImage(name) || isPdf(name)) {
    artifactText.value = '';
    artifactError.value = '';
    return;
  }
  artifactLoading.value = true;
  artifactError.value = '';
  try {
    artifactText.value = await fetchTaskFile(selectedLookup.value, name);
  } catch (error) {
    artifactError.value = error.message;
    artifactText.value = '';
  } finally {
    artifactLoading.value = false;
  }
}

function openDelete() {
  deleteOpen.value = true;
}

async function confirmDelete() {
  if (!selected.value) return;
  deleteBusy.value = true;
  try {
    await runAction('queue.remove', { id: selected.value.id });
    deleteOpen.value = false;
    notify('删除任务已开始，完成后队列会自动刷新', 'success');
  } catch (error) {
    notify(error.message, 'danger');
  } finally {
    deleteBusy.value = false;
  }
}

function attachmentUrl(name) {
  return taskFileUrl(selectedLookup.value, name, true);
}

function fileUrl(name) {
  return taskFileUrl(selectedLookup.value, name);
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    loadList({ preserve: false }).catch(() => {});
    refreshState().catch(() => {});
  }, 600);
}

watch(
  () => [store.snapshot?.currentTask?.id, store.snapshot?.currentTask?.stage, store.snapshot?.queue?.count],
  scheduleReload
);

watch(
  () => store.activeJob?.status,
  (status) => {
    if (status === 'succeeded') {
      setTimeout(() => loadList({ preserve: false }), 500);
    }
  }
);

watch(
  () => store.selectedTaskId,
  (id) => {
    if (!id) return;
    const target = items.value.find((item) => item.lookupId === id);
    if (target) selectItem(target);
  }
);

onMounted(() => {
  loadList();
});

onBeforeUnmount(() => {
  clearTimeout(reloadTimer);
});
</script>

<template>
  <section class="view">
    <header class="view-heading">
      <div>
        <p class="eyebrow">Case files / 02</p>
        <h1>任务</h1>
        <p class="view-subtitle">当前任务、队列和人工跟进资料都按案卷组织。</p>
      </div>
      <div class="view-actions">
        <span class="muted mono-small">{{ items.length }} 个案卷</span>
        <button class="button button-small" type="button" :disabled="loading" @click="loadList({ preserve: true })">
          {{ loading ? '读取中…' : '刷新案卷' }}
        </button>
      </div>
    </header>

    <div v-if="loadError" class="inline-error" role="alert">
      <span>{{ loadError }}</span>
      <button class="button button-small" type="button" @click="loadList()">重试</button>
    </div>

    <div class="task-workspace">
      <aside class="task-index panel">
        <div class="index-head">
          <span class="eyebrow">Work orders</span>
          <StatusLamp
            :tone="currentTask ? 'running' : 'neutral'"
            :label="currentTask ? '处理中' : '空闲'"
          />
        </div>
        <div v-if="loading && !payload" class="task-loading">正在读取任务索引…</div>
        <template v-else-if="groups.length">
          <section v-for="group in groups" :key="group.id" class="task-group">
            <div class="group-head">
              <h2>{{ group.label }}</h2>
              <span>{{ group.items.length }}</span>
            </div>
            <button
              v-for="item in group.items"
              :key="`${item.source}-${item.lookupId}`"
              class="task-index-item"
              :class="{ active: selectedLookup === item.lookupId }"
              type="button"
              @click="selectItem(item)"
            >
              <span class="task-source-dot" :class="`source-${item.source}`" aria-hidden="true"></span>
              <span class="task-index-copy">
                <strong>{{ item.id }}</strong>
                <span>{{ item.subject || '无标题' }}</span>
                <small>
                  {{ item.source === 'current' ? item.stage : item.source === 'manual' ? '需要人工处理' : priorityLabel(item.priorityRank) }}
                </small>
              </span>
              <span class="task-chevron" aria-hidden="true">›</span>
            </button>
          </section>
        </template>
        <div v-else class="empty-state index-empty">
          <div>
            <strong>没有任务案卷</strong>
            <span>当前没有处理中的任务，队列也为空。</span>
          </div>
        </div>
        <footer class="index-foot">
          <span class="muted mono-small">~/autofix/runs/tasks</span>
          <span class="muted mono-small">manual/ 单独保留</span>
        </footer>
      </aside>

      <section class="case-file panel">
        <div v-if="detailLoading" class="case-loading">正在展开案卷…</div>
        <div v-else-if="detailError" class="inline-error">
          <span>{{ detailError }}</span>
          <button class="button button-small" type="button" @click="loadDetail(selectedLookup)">重试</button>
        </div>
        <div v-else-if="!detail" class="empty-state case-empty">
          <div>
            <strong>选择一个任务</strong>
            <span>左侧索引中的当前任务、队列条目和人工跟进记录都可以展开。</span>
          </div>
        </div>
        <template v-else>
          <header class="case-file-head">
            <div>
              <div class="inline">
                <span class="badge" :class="selected?.source === 'manual' ? 'badge-warn' : selected?.source === 'current' ? 'badge-success' : ''">
                  {{ taskSourceLabel(selected?.source) }}
                </span>
                <span class="mono-small muted">{{ detail.dir }}</span>
              </div>
              <h2>{{ selected?.id }} · {{ detail.task?.subject || selected?.subject || '无标题' }}</h2>
              <p class="case-meta">
                <span v-if="selected?.stage">阶段：{{ selected.stage }}</span>
                <span v-if="selected?.priorityRank">优先级：{{ priorityLabel(selected.priorityRank) }}</span>
                <span>{{ artifacts.length }} 个产物 · {{ attachments.length }} 个附件</span>
              </p>
            </div>
            <button
              v-if="selected?.source === 'queue'"
              class="button button-small button-danger"
              type="button"
              @click="openDelete"
            >
              删除队列条目
            </button>
          </header>

          <div v-if="detail.task?.subject || selected?.error" class="case-summary">
            <div v-if="detail.task?.subject">
              <span>缺陷标题</span>
              <strong>{{ detail.task.subject }}</strong>
            </div>
            <div v-if="selected?.error" class="has-error">
              <span>人工跟进原因</span>
              <strong>{{ selected.error }}</strong>
            </div>
            <div>
              <span>任务目录</span>
              <strong class="mono">{{ detail.dir }}</strong>
            </div>
          </div>

          <div class="artifact-tabs" role="tablist" aria-label="任务产物">
            <button
              v-for="file in artifacts"
              :key="file.name"
              class="artifact-tab"
              :class="{ active: selectedArtifact === file.name }"
              type="button"
              role="tab"
              :aria-selected="selectedArtifact === file.name"
              @click="selectArtifact(file.name)"
            >
              {{ artifactLabel(file.name) }}
              <small>{{ formatBytes(file.size) }}</small>
            </button>
          </div>

          <div class="artifact-view">
            <div class="artifact-toolbar">
              <span class="eyebrow">{{ selectedArtifact || 'No artifact' }}</span>
              <a v-if="selectedArtifact" :href="fileUrl(selectedArtifact)" target="_blank" rel="noreferrer">原始文件 ↗</a>
            </div>
            <div v-if="artifactLoading" class="artifact-loading">正在读取产物…</div>
            <div v-else-if="artifactError" class="inline-error">
              <span>{{ artifactError }}</span>
              <button class="button button-small" type="button" @click="selectArtifact(selectedArtifact)">重试</button>
            </div>
            <pre v-else-if="!isMarkdown(selectedArtifact)" class="artifact-code">{{ artifactText || '（空文件）' }}</pre>
            <MarkdownPane v-else :text="artifactText" />
          </div>

          <section class="attachment-section">
            <div class="panel-title">
              <div>
                <p class="eyebrow">Evidence</p>
                <h3>附件</h3>
              </div>
              <span class="muted mono-small">{{ attachments.length }}</span>
            </div>
            <div v-if="attachments.length" class="attachment-grid">
              <a
                v-for="file in attachments"
                :key="file.name"
                class="attachment-card"
                :href="attachmentUrl(file.name)"
                target="_blank"
                rel="noreferrer"
              >
                <img v-if="isImage(file.name)" :src="attachmentUrl(file.name)" :alt="file.name" loading="lazy" />
                <span v-else class="attachment-file" aria-hidden="true">{{ isPdf(file.name) ? 'PDF' : 'FILE' }}</span>
                <span class="attachment-copy">
                  <strong>{{ file.name }}</strong>
                  <small>{{ formatBytes(file.size) }}</small>
                </span>
              </a>
            </div>
            <div v-else class="muted attachment-empty">这个任务没有附件。</div>
          </section>
        </template>
      </section>
    </div>

    <ConfirmDialog
      :open="deleteOpen"
      title="从队列删除任务"
      description="删除前必须停止主流水线。任务目录会保留在 runs/tasks，不会删除代码或人工资料。"
      confirm-label="删除队列条目"
      tone="danger"
      :require-text="deleteRequireText"
      :busy="deleteBusy"
      @close="deleteOpen = false"
      @confirm="confirmDelete"
    >
      <div class="delete-facts">
        <div><span>编号</span><strong>{{ selected?.id }}</strong></div>
        <div><span>标题</span><strong>{{ selected?.subject }}</strong></div>
        <div><span>任务目录</span><strong class="mono">保留</strong></div>
      </div>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.view {
  display: grid;
  gap: 18px;
}

.view-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.view-subtitle {
  margin: 0;
  color: var(--ink-muted);
}

.view-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.inline-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(161, 61, 61, 0.3);
  border-left: 3px solid var(--danger);
  background: var(--danger-light);
  color: var(--danger);
  font-size: 12px;
}

.task-workspace {
  display: grid;
  grid-template-columns: minmax(270px, 0.72fr) minmax(0, 1.9fr);
  gap: 16px;
  align-items: start;
}

.task-index {
  position: sticky;
  top: 85px;
  max-height: calc(100vh - 105px);
  overflow: auto;
}

.index-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px;
  border-bottom: 1px solid var(--line);
}

.task-loading {
  padding: 35px;
  color: var(--ink-muted);
  text-align: center;
}

.task-group + .task-group {
  border-top: 1px solid var(--line);
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 5px;
}

.group-head h2 {
  margin: 0;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.group-head span {
  color: var(--signal);
  font-family: var(--font-mono);
  font-size: 10px;
}

.task-index-item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  width: 100%;
  padding: 9px 14px;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--transition),
    border-color var(--transition);
}

.task-index-item:hover {
  background: var(--paper-deep);
}

.task-index-item.active {
  border-left-color: var(--signal);
  background: rgba(214, 90, 52, 0.08);
}

.task-source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-muted);
}

.source-current {
  background: var(--copper);
  box-shadow: 0 0 0 3px rgba(47, 117, 101, 0.12);
}

.source-manual {
  background: var(--brass);
}

.task-index-copy {
  display: grid;
  min-width: 0;
}

.task-index-copy strong {
  font-family: var(--font-mono);
  font-size: 11px;
}

.task-index-copy span {
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-index-copy small {
  color: var(--ink-muted);
  font-size: 9px;
}

.task-chevron {
  color: var(--ink-muted);
  font-size: 18px;
}

.index-empty {
  min-height: 220px;
  margin: 14px;
}

.index-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px;
  padding: 12px 14px;
  border-top: 1px solid var(--line);
}

.case-file {
  min-height: 620px;
  padding: 20px;
}

.case-loading {
  display: grid;
  min-height: 400px;
  place-items: center;
  color: var(--ink-muted);
}

.case-empty {
  min-height: 540px;
}

.case-file-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--line);
}

.case-file-head h2 {
  margin: 10px 0 6px;
  font-size: clamp(24px, 2.8vw, 36px);
  line-height: 1.12;
}

.case-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 16px;
  margin: 0;
  color: var(--ink-muted);
  font-size: 11px;
}

.case-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 14px 0;
  background: var(--line);
}

.case-summary div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 9px 11px;
  background: var(--paper);
}

.case-summary div:last-child {
  grid-column: 1 / -1;
}

.case-summary span {
  color: var(--ink-muted);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.case-summary strong {
  overflow-wrap: anywhere;
  font-size: 12px;
}

.case-summary .has-error {
  background: var(--danger-light);
}

.case-summary .has-error strong {
  color: var(--danger);
}

.artifact-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.artifact-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--ink-muted);
  font-size: 11px;
  cursor: pointer;
}

.artifact-tab:hover {
  background: var(--paper-deep);
}

.artifact-tab.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper-light);
}

.artifact-tab small {
  opacity: 0.56;
  font-family: var(--font-mono);
  font-size: 8px;
}

.artifact-view {
  min-height: 280px;
  padding: 15px 0;
}

.artifact-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.artifact-toolbar a {
  font-size: 11px;
}

.artifact-code {
  max-height: 540px;
  padding: 14px;
  margin: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #19221f;
  color: #dce5df;
  font-size: 11px;
  line-height: 1.58;
  white-space: pre-wrap;
  word-break: break-word;
}

.artifact-loading {
  display: grid;
  min-height: 220px;
  place-items: center;
  color: var(--ink-muted);
}

.attachment-section {
  padding-top: 15px;
  border-top: 1px solid var(--line);
}

.attachment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.attachment-card {
  display: grid;
  grid-template-rows: 96px auto;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
  text-decoration: none;
  transition:
    border-color var(--transition),
    transform var(--transition);
}

.attachment-card:hover {
  border-color: var(--ink);
  transform: translateY(-1px);
}

.attachment-card img {
  width: 100%;
  height: 96px;
  object-fit: cover;
  background: var(--paper-deep);
}

.attachment-file {
  display: grid;
  place-items: center;
  color: var(--signal);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 800;
}

.attachment-copy {
  display: grid;
  gap: 1px;
  padding: 7px 8px;
  border-top: 1px solid var(--line);
}

.attachment-copy strong {
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-copy small {
  color: var(--ink-muted);
  font-size: 9px;
}

.attachment-empty {
  padding: 18px 0;
  font-size: 12px;
}

.delete-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: var(--line);
}

.delete-facts div {
  display: grid;
  gap: 2px;
  padding: 9px;
  background: var(--paper);
}

.delete-facts span {
  color: var(--ink-muted);
  font-size: 9px;
  text-transform: uppercase;
}

.delete-facts strong {
  overflow-wrap: anywhere;
  font-size: 11px;
}

@media (max-width: 980px) {
  .task-workspace {
    grid-template-columns: 1fr;
  }

  .task-index {
    position: static;
    max-height: none;
  }

  .task-group {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .group-head {
    grid-column: 1 / -1;
  }
}

@media (max-width: 700px) {
  .view-heading,
  .case-file-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .view-actions {
    width: 100%;
    justify-content: space-between;
  }

  .task-group {
    display: block;
  }

  .case-summary,
  .delete-facts {
    grid-template-columns: 1fr;
  }

  .case-summary div:last-child {
    grid-column: auto;
  }

  .attachment-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
