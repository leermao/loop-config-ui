import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertIdentifier,
  safeBasename,
  safeJoin,
  statIfExists
} from './paths.js';

export const STATIC_LOG_SOURCES = [
  { id: 'log', label: '进度日志', file: 'log' },
  { id: 'launchd', label: 'launchd 输出', file: 'launchd.log' },
  { id: 'notify', label: '通知日志', file: 'notify.log' },
  { id: 'deps', label: '依赖安装', file: 'deps.log' },
  { id: 'main-sync', label: 'main 同步', file: 'main-sync.log' }
];

const STATIC_BY_ID = new Map(STATIC_LOG_SOURCES.map((item) => [item.id, item]));

export function resolveLogPath(config, { name = 'log', taskId } = {}) {
  if (taskId) {
    assertIdentifier(taskId, '任务编号');
    const filename = safeBasename(name || 'test.log');
    return safeJoin(config.runsDir, 'tasks', taskId, filename);
  }
  const source = STATIC_BY_ID.get(name);
  if (!source) {
    const error = new Error(`不支持的日志来源：${name}`);
    error.code = 'INVALID_LOG_SOURCE';
    throw error;
  }
  return safeJoin(config.runsDir, source.file);
}

export async function listLogSources(config) {
  return Promise.all(STATIC_LOG_SOURCES.map(async (source) => {
    const target = path.join(config.runsDir, source.file);
    const stat = await statIfExists(target);
    return {
      ...source,
      name: source.id,
      exists: Boolean(stat),
      size: stat?.size ?? 0,
      mtime: stat?.mtime?.toISOString() ?? null
    };
  }));
}

export async function readTail(filePath, { maxBytes = 1024 * 1024 } = {}) {
  const stat = await statIfExists(filePath);
  if (!stat) return { text: '', offset: 0, size: 0, exists: false };
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  if (length <= 0) return { text: '', offset: size, size, exists: true };
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return {
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      offset: start + bytesRead,
      size,
      exists: true
    };
  } finally {
    await handle.close();
  }
}

export async function readLogChunk(filePath, offset = 0) {
  const stat = await statIfExists(filePath);
  if (!stat) {
    return { text: '', offset: 0, size: 0, exists: false, truncated: false };
  }
  let start = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  let truncated = false;
  if (stat.size < start) {
    start = 0;
    truncated = true;
  }
  const length = stat.size - start;
  if (length <= 0) {
    return { text: '', offset: start, size: stat.size, exists: true, truncated };
  }
  if (length > 2 * 1024 * 1024) {
    start = stat.size - 2 * 1024 * 1024;
    truncated = true;
  }
  const readLength = stat.size - start;
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await handle.read(buffer, 0, readLength, start);
    return {
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      offset: start + bytesRead,
      size: stat.size,
      exists: true,
      truncated
    };
  } finally {
    await handle.close();
  }
}
