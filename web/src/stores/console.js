import { reactive } from 'vue';

import {
  ensureHealth,
  fetchJob,
  fetchState,
  jobStreamUrl,
  startAction,
  stateStreamUrl
} from '../lib/api.js';

const store = reactive({
  snapshot: null,
  health: null,
  loading: true,
  error: null,
  connection: 'connecting',
  lastUpdated: null,
  activeJob: null,
  jobOutput: '',
  jobError: null,
  toast: '',
  toastTone: 'neutral',
  selectedTaskId: null
});

let stateSource = null;
let stateRetry = null;
let statePoll = null;
let stateFailures = 0;
let statePollBusy = false;
let jobSource = null;
let jobPoll = null;
let toastTimer = null;
let started = false;

export function useConsoleStore() {
  return store;
}

export function notify(message, tone = 'neutral') {
  store.toast = message;
  store.toastTone = tone;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    store.toast = '';
  }, 4200);
}

export async function refreshState() {
  try {
    store.snapshot = await fetchState();
    store.lastUpdated = new Date().toISOString();
    store.error = null;
    return store.snapshot;
  } catch (error) {
    store.error = error.message;
    throw error;
  }
}

function stopStatePolling() {
  if (statePoll) {
    clearInterval(statePoll);
    statePoll = null;
  }
}

function startStatePolling() {
  if (statePoll) return;
  store.connection = 'polling';
  const poll = async () => {
    if (statePollBusy) return;
    statePollBusy = true;
    try {
      await refreshState();
    } catch {
      // The next poll retries; the existing snapshot remains visible.
    } finally {
      statePollBusy = false;
    }
  };
  poll();
  statePoll = setInterval(poll, 3000);
}

function connectStateStream() {
  if (stateSource) stateSource.close();
  if (stateRetry) clearTimeout(stateRetry);
  const currentSource = new EventSource(stateStreamUrl());
  stateSource = currentSource;
  store.connection = 'connecting';
  currentSource.onopen = () => {
    if (stateSource !== currentSource) return;
    stateFailures = 0;
    stopStatePolling();
    store.connection = 'live';
    store.error = null;
  };
  currentSource.addEventListener('snapshot', (event) => {
    if (stateSource !== currentSource) return;
    try {
      store.snapshot = JSON.parse(event.data);
      store.lastUpdated = new Date().toISOString();
      stateFailures = 0;
      stopStatePolling();
      store.connection = 'live';
      store.error = null;
    } catch (error) {
      store.error = `状态流解析失败：${error.message}`;
    }
  });
  currentSource.onerror = (event) => {
    if (stateSource !== currentSource) return;
    if (event.data) {
      try {
        store.error = JSON.parse(event.data).error || '状态流异常';
      } catch {
        store.error = '状态流异常';
      }
      return;
    }
    currentSource.close();
    stateSource = null;
    stateFailures += 1;
    if (stateFailures >= 2) {
      startStatePolling();
      return;
    }
    store.connection = 'reconnecting';
    stateRetry = setTimeout(connectStateStream, 2000);
  };
}

export async function startConsole() {
  if (started) return;
  started = true;
  try {
    store.health = await ensureHealth();
    await refreshState();
  } catch (error) {
    store.error = error.message;
  } finally {
    store.loading = false;
    connectStateStream();
  }
}

function closeJobStream() {
  if (jobSource) {
    jobSource.close();
    jobSource = null;
  }
  if (jobPoll) {
    clearInterval(jobPoll);
    jobPoll = null;
  }
}

function finishJob(status, error = null) {
  if (!store.activeJob) return;
  store.activeJob.status = status;
  store.activeJob.error = error;
  store.jobError = error;
  closeJobStream();
  refreshState().catch(() => {});
}

function subscribeJob(id) {
  closeJobStream();
  jobSource = new EventSource(jobStreamUrl(id));
  jobSource.addEventListener('output', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.initial) store.jobOutput = payload.text || '';
      else store.jobOutput += payload.text || '';
    } catch {
      store.jobError = '任务输出解析失败';
    }
  });
  jobSource.addEventListener('done', (event) => {
    try {
      const payload = JSON.parse(event.data);
      finishJob(payload.status, payload.error);
    } catch {
      finishJob('failed', '任务结束事件解析失败');
    }
  });
  jobSource.onerror = () => {
    if (store.activeJob?.status !== 'running') {
      closeJobStream();
      return;
    }
    if (!jobPoll) {
      jobPoll = setInterval(async () => {
        try {
          const job = await fetchJob(id);
          store.jobOutput = job.output || store.jobOutput;
          if (job.status !== 'running') finishJob(job.status, job.error);
        } catch (error) {
          store.jobError = error.message;
        }
      }, 1200);
    }
  };
}

export async function runAction(action, input = {}) {
  if (store.activeJob?.status === 'running') {
    throw new Error('已有操作正在执行');
  }
  closeJobStream();
  store.jobOutput = '';
  store.jobError = null;
  const job = await startAction(action, input);
  store.activeJob = job;
  subscribeJob(job.id);
  notify(`已开始：${job.label || action}`, 'success');
  return job;
}

export function dismissJob() {
  closeJobStream();
  store.activeJob = null;
  store.jobOutput = '';
  store.jobError = null;
}

export function selectTask(id) {
  store.selectedTaskId = id;
  window.location.hash = '#/tasks';
}

export function clearTaskSelection() {
  store.selectedTaskId = null;
}
