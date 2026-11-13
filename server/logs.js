import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertIdentifier,
  safeBasename,
  safeJoin,
  statIfExists
} from './paths.js';

export const STATIC_LOG_SOURCES = [
  {
    id: 'log',
    label: '进度日志',
    file: 'log',
    description: '云效同步、任务进度和异常事件；日常排查先看这里。'
  },
  {
    id: 'launchd',
    label: 'launchd 进程日志',
    file: 'launchd.log',
    description: '主进程 stdout/stderr；仅在启动失败或脚本报错时出现，正常为空。'
  },
  {
    id: 'notify',
    label: '通知日志',
    file: 'notify.log',
    description: '通知任务的输出；记录状态推送和发送失败。'
  },
  {
    id: 'deps',
    label: '依赖安装日志',
    file: 'deps.log',
    description: '最近一次 pnpm install 的输出；依赖安装失败时查看。'
  },
  {
    id: 'main-sync',
    label: 'main 合并日志',
    file: 'main-sync.log',
    description: '任务开始前合并 origin/main 的 git 输出；没有合并需求时不会生成。'
  }
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
