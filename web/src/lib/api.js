let csrfToken = null;
let healthPromise = null;

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`服务返回了无法解析的内容（HTTP ${response.status}）`);
  }
}

async function rawFetch(path, options = {}) {
  const response = await fetch(path, options);
  const body = await readJson(response);
  if (!response.ok) {
    const error = new Error(body?.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function ensureHealth(force = false) {
  if (csrfToken && !force) return { csrfToken };
  if (!healthPromise || force) {
    healthPromise = rawFetch('/api/health')
      .then((health) => {
        csrfToken = health.csrfToken;
        return health;
      })
      .finally(() => {
        healthPromise = null;
      });
  }
  return healthPromise;
}

async function request(path, { method = 'GET', body, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') {
    await ensureHealth();
    headers['X-Autofix-Console-Token'] = csrfToken;
  }
  try {
    return await rawFetch(path, { method, headers, body: payload });
  } catch (error) {
    if (method !== 'GET' && retry && error.status === 403) {
      await ensureHealth(true);
      return request(path, { method, body, retry: false });
    }
    throw error;
  }
}

export const fetchState = () => request('/api/state');
export const fetchConfig = () => request('/api/config');
export const fetchDoctor = () => request('/api/doctor');
export const fetchTasks = () => request('/api/tasks');
export const fetchTask = (id) => request(`/api/tasks/${encodeURIComponent(id)}`);
export const fetchActions = () => request('/api/actions');
export const fetchLogSources = () => request('/api/logs?list=1');

export function fetchLogChunk({ name, taskId, offset = 0 }) {
  const params = new URLSearchParams({ name, offset: String(offset) });
  if (taskId) params.set('taskId', taskId);
  return request(`/api/logs?${params}`);
}

export function fetchTaskFile(taskId, name, attachment = false) {
  const kind = attachment ? 'attachments' : 'files';
  return fetch(`/api/tasks/${encodeURIComponent(taskId)}/${kind}/${encodeURIComponent(name)}`, {
    headers: { Accept: 'text/plain' }
  }).then(async (response) => {
    if (!response.ok) {
      const body = await readJson(response);
      throw new Error(body?.error || `读取文件失败（HTTP ${response.status}）`);
    }
    return response.text();
  });
}

export function saveConfig(updates) {
  return request('/api/config', { method: 'PUT', body: { updates } });
}

export function startAction(action, input = {}) {
  return request(`/api/actions/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { input }
  });
}

export function fetchJob(id) {
  return request(`/api/jobs/${encodeURIComponent(id)}`);
}

export function stateStreamUrl() {
  return '/api/stream';
}

export function jobStreamUrl(id) {
  return `/api/jobs/${encodeURIComponent(id)}/stream`;
}

export function logStreamUrl({ name, taskId, offset }) {
  const params = new URLSearchParams({ name });
  if (Number.isFinite(offset)) params.set('offset', String(offset));
  if (taskId) params.set('taskId', taskId);
  return `/api/logs/stream?${params}`;
}

export function logDownloadUrl({ name, taskId }) {
  const params = new URLSearchParams({ name, download: '1' });
  if (taskId) params.set('taskId', taskId);
  return `/api/logs?${params}`;
}

export function taskFileUrl(taskId, name, attachment = false) {
  const kind = attachment ? 'attachments' : 'files';
  return `/api/tasks/${encodeURIComponent(taskId)}/${kind}/${encodeURIComponent(name)}`;
}
