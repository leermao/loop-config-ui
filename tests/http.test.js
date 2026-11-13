import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';

import { loadConsoleConfig } from '../server/config.js';
import { createRequestHandler } from '../server/http.js';

class FakeResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.started = false;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  getHeader(name) {
    return this.headers[name.toLowerCase()];
  }

  get headersSent() {
    return this.started;
  }

  get status() {
    return this.statusCode;
  }

  _write(chunk, encoding, callback) {
    this.started = true;
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get text() {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  json() {
    return JSON.parse(this.text);
  }
}

function fakeRequest({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  return req;
}

async function setup(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-http-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const rootDir = path.join(home, 'console');
  const appDir = path.join(home, 'autofix', 'app');
  const runsDir = path.join(home, 'autofix', 'runs');
  const staticDir = path.join(rootDir, 'web', 'dist');
  await Promise.all([
    fs.mkdir(appDir, { recursive: true }),
    fs.mkdir(runsDir, { recursive: true }),
    fs.mkdir(staticDir, { recursive: true })
  ]);
  await fs.writeFile(path.join(appDir, '.env'), 'AUTOFIX_SYNC_START="9"\n');
  await fs.writeFile(path.join(runsDir, 'queue.json'), '[]\n');
  await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Autofix</title>');
  const config = loadConsoleConfig({
    home,
    rootDir,
    env: { AUTOFIX_CONSOLE_PORT: '4177' }
  });
  const snapshotService = {
    async build() {
      return {
        status: 'stopped',
        statusLabel: '已停止',
        queue: { items: [], count: 0, error: null },
        currentTask: null
      };
    }
  };
  const actionRunner = {
    start(action, input) {
      return { id: 'job-1', action, input, status: 'running' };
    },
    get(id) {
      if (id !== 'job-1') return null;
      return { id, status: 'succeeded', output: 'ok\n', error: null };
    },
    subscribe() {
      return () => {};
    }
  };
  const csrfToken = 'test-token';
  const handler = createRequestHandler({
    config,
    snapshotService,
    actionRunner,
    csrfToken,
    staticDir
  });
  const request = async (url, options = {}) => {
    const req = fakeRequest({ ...options, url });
    const res = new FakeResponse();
    const finished = new Promise((resolve) => res.once('finish', resolve));
    await handler(req, res);
    await finished;
    return res;
  };
  return { home, rootDir, appDir, runsDir, staticDir, config, csrfToken, request };
}

const allowedOrigin = 'http://127.0.0.1:4177';

test('health exposes the local CSRF token and state is readable', async (t) => {
  const { request, csrfToken } = await setup(t);
  const health = (await request('/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.csrfToken, csrfToken);

  const state = (await request('/api/state')).json();
  assert.equal(state.status, 'stopped');
});

test('write endpoints reject missing origin or token', async (t) => {
  const { request, csrfToken } = await setup(t);
  const noOrigin = await request('/api/actions/main.pause', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Autofix-Console-Token': csrfToken
    },
    body: '{}'
  });
  assert.equal(noOrigin.status, 403);

  const noToken = await request('/api/actions/main.pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
    body: '{}'
  });
  assert.equal(noToken.status, 403);

  const ok = await request('/api/actions/main.pause', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      'X-Autofix-Console-Token': csrfToken
    },
    body: '{}'
  });
  assert.equal(ok.status, 202);
  const job = ok.json();
  assert.equal(job.id, 'job-1');
});

test('config can be read and updated with CSRF protection', async (t) => {
  const { request, csrfToken } = await setup(t);
  const initial = (await request('/api/config')).json();
  const sync = initial.groups.flatMap((group) => group.entries).find((entry) => entry.key === 'AUTOFIX_SYNC_START');
  assert.equal(sync.value, '9');

  const response = await request('/api/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: allowedOrigin,
      'X-Autofix-Console-Token': csrfToken
    },
    body: JSON.stringify({ updates: { AUTOFIX_SYNC_START: '10' } })
  });
  assert.equal(response.status, 200);
  const result = response.json();
  assert.deepEqual(result.changed, ['AUTOFIX_SYNC_START']);

  const after = (await request('/api/config')).json();
  const changed = after.groups.flatMap((group) => group.entries).find((entry) => entry.key === 'AUTOFIX_SYNC_START');
  assert.equal(changed.value, '10');
});

test('log preview can read an incremental chunk from an offset', async (t) => {
  const { request, runsDir } = await setup(t);
  await fs.writeFile(path.join(runsDir, 'log'), '0123456789');

  const chunk = (await request('/api/logs?name=log&offset=4')).json();
  assert.equal(chunk.text, '456789');
  assert.equal(chunk.offset, 10);
  assert.equal(chunk.exists, true);
});

test('task files and attachments are served without allowing traversal', async (t) => {
  const { request, runsDir } = await setup(t);
  const taskDir = path.join(runsDir, 'tasks', 'P-1');
  const attachments = path.join(taskDir, 'attachments');
  const manualDir = path.join(runsDir, 'manual', 'P-2-20261113120000');
  await fs.mkdir(attachments, { recursive: true });
  await fs.mkdir(manualDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'task.json'), JSON.stringify({ serialNumber: 'P-1', subject: '测试任务' }));
  await fs.writeFile(path.join(taskDir, 'design.md'), '# 设计\n');
  await fs.writeFile(path.join(attachments, 'screen.png'), Buffer.from([137, 80, 78, 71]));
  await fs.writeFile(path.join(manualDir, 'task.json'), JSON.stringify({ serialNumber: 'P-2', subject: '人工任务' }));
  await fs.writeFile(path.join(manualDir, 'err'), '云效更新失败\n');

  const task = (await request('/api/tasks/P-1')).json();
  assert.equal(task.task.subject, '测试任务');
  assert.ok(task.files.some((file) => file.name === 'design.md'));

  const list = (await request('/api/tasks')).json();
  const manual = list.items.find((item) => item.source === 'manual');
  assert.equal(manual.id, 'P-2');
  assert.equal(manual.lookupId, 'P-2-20261113120000');

  const design = await request('/api/tasks/P-1/files/design.md');
  assert.equal(design.status, 200);
  assert.equal(design.text, '# 设计\n');
  assert.match(design.getHeader('content-type'), /text\/plain/);

  const image = await request('/api/tasks/P-1/attachments/screen.png');
  assert.equal(image.status, 200);
  assert.match(image.getHeader('content-type'), /image\/png/);

  const traversal = await request('/api/tasks/..%2Fsecret');
  assert.equal(traversal.status, 400);
});

test('static SPA fallback serves index.html', async (t) => {
  const { request } = await setup(t);
  const response = await request('/some/route');
  assert.equal(response.status, 200);
  assert.match(response.text, /Autofix/);
});
