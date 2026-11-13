import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import {
  loadConsoleConfig,
  saveEnvUpdates
} from './config.js';
import { runDoctor } from './doctor.js';
import {
  listLogSources,
  readLogChunk,
  readTail,
  resolveLogPath
} from './logs.js';
import {
  assertIdentifier,
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  safeBasename,
  safeJoin,
  statIfExists
} from './paths.js';
import {
  allowedOrigins,
  applySecurityHeaders,
  assertWriteRequest
} from './security.js';

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}));

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.log', '.patch', '.json', '.out', '.prompt']);

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendError(res, error) {
  let statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (['INVALID_IDENTIFIER', 'INVALID_FILENAME', 'PATH_OUTSIDE_ROOT', 'INVALID_LOG_SOURCE'].includes(error.code)) {
    statusCode = 400;
  }
  sendJson(res, statusCode, {
    error: error.message || '服务器内部错误'
  });
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sseStart(req, res) {
  applySecurityHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write(': connected\n\n');
  let closed = false;
  const close = () => {
    closed = true;
  };
  req.on('close', close);
  res.on('close', close);
  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      if (!closed) res.write(`: ${text}\n\n`);
    },
    get closed() {
      return closed;
    }
  };
}

function groupEntries(entries) {
  const groups = [];
  for (const entry of entries) {
    let group = groups.find((item) => item.name === entry.group);
    if (!group) {
      group = { name: entry.group, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

async function findTaskDir(config, id) {
  assertIdentifier(id, '任务编号');
  const direct = safeJoin(config.runsDir, 'tasks', id);
  if (await pathExists(direct)) return direct;
  const manualRoot = path.join(config.runsDir, 'manual');
  try {
    const names = (await fsp.readdir(manualRoot)).sort().reverse();
    const match = names.find((name) => name === id || name.startsWith(`${id}-`));
    if (match) return safeJoin(manualRoot, match);
  } catch {
    // No manual directory.
  }
  return null;
}

async function taskPayload(config, id) {
  const taskDir = await findTaskDir(config, id);
  if (!taskDir) throw Object.assign(new Error(`找不到任务 ${id}`), { statusCode: 404 });
  const task = await readJsonIfExists(path.join(taskDir, 'task.json'), null);
  const fileNames = [];
  try {
    for (const entry of await fsp.readdir(taskDir, { withFileTypes: true })) {
      if (entry.isFile()) fileNames.push(entry.name);
    }
  } catch {
    // Let the 404 path handle missing directories.
  }
  const files = [];
  for (const name of fileNames.sort()) {
    const stat = await statIfExists(path.join(taskDir, name));
    if (stat) files.push({ name, size: stat.size, mtime: stat.mtime.toISOString() });
  }
  const attachments = [];
  try {
    for (const entry of await fsp.readdir(path.join(taskDir, 'attachments'), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const stat = await statIfExists(path.join(taskDir, 'attachments', entry.name));
      if (stat) attachments.push({ name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() });
    }
  } catch {
    // No attachments.
  }
  return {
    id,
    dir: taskDir,
    manual: path.basename(path.dirname(taskDir)) === 'manual',
    task,
    files,
    attachments
  };
}

async function listManualTasks(config) {
  const manualRoot = path.join(config.runsDir, 'manual');
  let entries = [];
  try {
    entries = await fsp.readdir(manualRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskDir = path.join(manualRoot, entry.name);
    const task = await readJsonIfExists(path.join(taskDir, 'task.json'), null);
    const error = (await readTextIfExists(path.join(taskDir, 'err'), '')).trim();
    const stat = await statIfExists(taskDir);
    tasks.push({
      id: task?.serialNumber || entry.name.replace(/-\d{14}$/, ''),
      lookupId: entry.name,
      source: 'manual',
      subject: task?.subject || '人工跟进任务',
      priorityRank: task?.priorityRank ?? null,
      updatedAt: stat?.mtime?.toISOString() ?? null,
      error: error || null
    });
  }
  return tasks.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

async function taskListPayload(config, snapshotService) {
  const state = await snapshotService.build();
  const items = [];
  if (state.currentTask) {
    items.push({
      ...state.currentTask,
      source: 'current',
      lookupId: state.currentTask.id
    });
  }
  for (const item of state.queue.items) {
    if (item.serialNumber === state.currentTask?.id) continue;
    items.push({
      id: item.serialNumber,
      lookupId: item.serialNumber,
      source: 'queue',
      subject: item.subject || '',
      priorityRank: item.priorityRank ?? null,
      gmtCreate: item.gmtCreate ?? null
    });
  }
  items.push(...await listManualTasks(config));
  return {
    generatedAt: state.generatedAt,
    currentTask: state.currentTask,
    queue: state.queue,
    items
  };
}

function contentType(filePath) {
  return MIME.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

async function serveFile(res, filePath) {
  const stat = await statIfExists(filePath);
  if (!stat || !stat.isFile()) {
    throw Object.assign(new Error('文件不存在'), { statusCode: 404 });
  }
  const ext = path.extname(filePath).toLowerCase();
  const text = TEXT_EXTENSIONS.has(ext);
  res.statusCode = 200;
  res.setHeader('Content-Type', text ? 'text/plain; charset=utf-8' : contentType(filePath));
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-store');
  if (!text && !MIME.get(ext)?.startsWith('image/') && ext !== '.pdf') {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  }
  fs.createReadStream(filePath).pipe(res);
}

async function serveStatic(req, res, staticDir, pathname) {
  if (!staticDir) {
    throw Object.assign(new Error('前端尚未构建，请先运行 pnpm build'), { statusCode: 503 });
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    throw Object.assign(new Error('非法路径'), { statusCode: 400 });
  }
  let target = safeJoin(staticDir, relative === '/' ? 'index.html' : relative.replace(/^\/+/, ''));
  if (!(await pathExists(target))) {
    target = safeJoin(staticDir, 'index.html');
  }
  const ext = path.extname(target).toLowerCase();
  const stat = await statIfExists(target);
  if (!stat) throw Object.assign(new Error('前端尚未构建，请先运行 pnpm build'), { statusCode: 503 });
  applySecurityHeaders(res, { html: ext === '.html' });
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME.get(ext) ?? 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
  fs.createReadStream(target).pipe(res);
}

export function createRequestHandler({
  config,
  snapshotService,
  actionRunner,
  csrfToken,
  staticDir = path.join(config.rootDir, 'web', 'dist'),
  run = undefined
}) {
  const origins = allowedOrigins(config);
  return async function handleRequest(req, res) {
    try {
      const base = `http://${config.bindHost}:${config.port}`;
      const url = new URL(req.url || '/', base);
      const pathname = url.pathname;

      if (pathname === '/api/health') {
        applySecurityHeaders(res);
        sendJson(res, 200, {
          ok: true,
          service: 'autofix-console',
          version: '0.1.0',
          csrfToken
        });
        return;
      }

      if (pathname === '/api/state') {
        applySecurityHeaders(res);
        sendJson(res, 200, await snapshotService.build());
        return;
      }

      if (pathname === '/api/stream') {
        const stream = sseStart(req, res);
        let previous = '';
        let lastSent = 0;
        const timer = setInterval(async () => {
          if (stream.closed) return;
          try {
            const state = await snapshotService.build();
            const serialized = JSON.stringify(state);
            if (serialized !== previous) {
              stream.send('snapshot', state);
              previous = serialized;
              lastSent = Date.now();
            } else if (Date.now() - lastSent > 15_000) {
              stream.comment('heartbeat');
              lastSent = Date.now();
            }
          } catch (error) {
            stream.send('error', { error: error.message });
          }
        }, 2_000);
        req.on('close', () => clearInterval(timer));
        res.on('close', () => clearInterval(timer));
        return;
      }

      if (pathname === '/api/logs') {
        applySecurityHeaders(res);
        if (url.searchParams.get('list') === '1') {
          sendJson(res, 200, { sources: await listLogSources(config) });
          return;
        }
        const name = url.searchParams.get('name') || 'log';
        const taskId = url.searchParams.get('taskId') || undefined;
        const filePath = resolveLogPath(config, { name, taskId });
        if (url.searchParams.get('download') === '1') {
          await serveFile(res, filePath);
          return;
        }
        const offsetParam = url.searchParams.get('offset');
        const offset = Number(offsetParam);
        const result = offsetParam !== null && Number.isFinite(offset)
          ? await readLogChunk(filePath, offset)
          : await readTail(filePath, { maxBytes: 1024 * 1024 });
        sendJson(res, 200, {
          name,
          taskId: taskId ?? null,
          ...result
        });
        return;
      }

      if (pathname === '/api/logs/stream') {
        const name = url.searchParams.get('name') || 'log';
        const taskId = url.searchParams.get('taskId') || undefined;
        const filePath = resolveLogPath(config, { name, taskId });
        const initial = await readTail(filePath, { maxBytes: 256 * 1024 });
        let offset = Number(url.searchParams.get('offset'));
        if (!Number.isFinite(offset)) offset = initial.offset;
        const stream = sseStart(req, res);
        stream.send('init', {
          name,
          taskId: taskId ?? null,
          text: initial.text,
          offset,
          size: initial.size,
          exists: initial.exists
        });
        let lastHeartbeat = Date.now();
        const timer = setInterval(async () => {
          if (stream.closed) return;
          try {
            const chunk = await readLogChunk(filePath, offset);
            if (chunk.text || chunk.truncated) {
              offset = chunk.offset;
              stream.send('chunk', chunk);
              lastHeartbeat = Date.now();
            } else if (Date.now() - lastHeartbeat > 15_000) {
              stream.comment('heartbeat');
              lastHeartbeat = Date.now();
            }
          } catch (error) {
            stream.send('error', { error: error.message });
          }
        }, 500);
        req.on('close', () => clearInterval(timer));
        res.on('close', () => clearInterval(timer));
        return;
      }

      if (pathname === '/api/tasks' && req.method === 'GET') {
        applySecurityHeaders(res);
        sendJson(res, 200, await taskListPayload(config, snapshotService));
        return;
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        applySecurityHeaders(res);
        sendJson(res, 200, await taskPayload(config, decodeURIComponent(taskMatch[1])));
        return;
      }
      const taskFileMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/files\/([^/]+)$/);
      if (taskFileMatch) {
        applySecurityHeaders(res);
        const id = decodeURIComponent(taskFileMatch[1]);
        const name = safeBasename(decodeURIComponent(taskFileMatch[2]));
        const taskDir = await findTaskDir(config, id);
        if (!taskDir) throw Object.assign(new Error('找不到任务'), { statusCode: 404 });
        await serveFile(res, safeJoin(taskDir, name));
        return;
      }
      const attachmentMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/attachments\/([^/]+)$/);
      if (attachmentMatch) {
        applySecurityHeaders(res);
        const id = decodeURIComponent(attachmentMatch[1]);
        const name = safeBasename(decodeURIComponent(attachmentMatch[2]));
        const taskDir = await findTaskDir(config, id);
        if (!taskDir) throw Object.assign(new Error('找不到任务'), { statusCode: 404 });
        await serveFile(res, safeJoin(taskDir, 'attachments', name));
        return;
      }

      if (pathname === '/api/config' && req.method === 'GET') {
        applySecurityHeaders(res);
        const current = config.loadOptions ? loadConsoleConfig(config.loadOptions) : config;
        sendJson(res, 200, {
          envFile: current.envFile,
          envExists: current.envExists,
          groups: groupEntries(current.entries)
        });
        return;
      }
      if (pathname === '/api/config' && req.method === 'PUT') {
        assertWriteRequest(req, csrfToken, origins);
        const body = await readBody(req);
        const result = await saveEnvUpdates(config, body?.updates ?? {});
        const current = config.loadOptions ? loadConsoleConfig(config.loadOptions) : config;
        try {
          await fsp.mkdir(config.dataDir, { recursive: true });
          await fsp.appendFile(path.join(config.dataDir, 'audit.jsonl'), `${JSON.stringify({
            at: new Date().toISOString(),
            action: 'config.save',
            status: 'succeeded',
            changed: result.changed,
            backupPath: result.backupPath
          })}\n`);
        } catch {
          // Configuration was already saved.
        }
        sendJson(res, 200, {
          ...result,
          envFile: current.envFile,
          groups: groupEntries(current.entries)
        });
        return;
      }

      if (pathname === '/api/doctor') {
        applySecurityHeaders(res);
        const options = run ? { run } : {};
        sendJson(res, 200, await runDoctor(config, options));
        return;
      }

      if (pathname === '/api/actions' && req.method === 'GET') {
        applySecurityHeaders(res);
        sendJson(res, 200, { actions: actionRunner.listDefinitions() });
        return;
      }

      const actionMatch = pathname.match(/^\/api\/actions\/([^/]+)$/);
      if (actionMatch && req.method === 'POST') {
        assertWriteRequest(req, csrfToken, origins);
        const body = await readBody(req);
        const job = actionRunner.start(decodeURIComponent(actionMatch[1]), body?.input ?? {});
        sendJson(res, 202, job);
        return;
      }

      const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (jobMatch && req.method === 'GET') {
        applySecurityHeaders(res);
        const job = actionRunner.get(decodeURIComponent(jobMatch[1]));
        if (!job) throw Object.assign(new Error('找不到任务'), { statusCode: 404 });
        sendJson(res, 200, job);
        return;
      }

      const jobStreamMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/stream$/);
      if (jobStreamMatch) {
        const jobId = decodeURIComponent(jobStreamMatch[1]);
        const job = actionRunner.get(jobId);
        if (!job) throw Object.assign(new Error('找不到任务'), { statusCode: 404 });
        const stream = sseStart(req, res);
        if (job.output) stream.send('output', { text: job.output, initial: true });
        if (job.status !== 'running') {
          stream.send('done', { status: job.status, error: job.error });
          res.end();
          return;
        }
        const unsubscribe = actionRunner.subscribe(jobId, (event) => {
          if (event.type === 'output') stream.send('output', { text: event.text });
          else if (event.type === 'done') {
            stream.send('done', { status: event.status, error: event.error });
            unsubscribe?.();
            res.end();
          }
        });
        req.on('close', () => unsubscribe?.());
        res.on('close', () => unsubscribe?.());
        return;
      }

      if (pathname.startsWith('/api/')) {
        throw Object.assign(new Error('接口不存在'), { statusCode: 404 });
      }
      await serveStatic(req, res, staticDir, pathname);
    } catch (error) {
      if (!res.headersSent) {
        applySecurityHeaders(res);
        sendError(res, error);
      } else {
        res.end();
      }
    }
  };
}

export function createConsoleServer(options) {
  const server = http.createServer(createRequestHandler(options));

  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return server;
}
