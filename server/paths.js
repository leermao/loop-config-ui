import fs from 'node:fs/promises';
import path from 'node:path';

export function isWithin(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

export function safeJoin(root, ...parts) {
  const resolved = path.resolve(root, ...parts);
  if (!isWithin(root, resolved)) {
    const error = new Error('路径超出允许目录');
    error.code = 'PATH_OUTSIDE_ROOT';
    throw error;
  }
  return resolved;
}

export function safeBasename(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== path.basename(value)) {
    const error = new Error('非法文件名');
    error.code = 'INVALID_FILENAME';
    throw error;
  }
  if (value === '.' || value === '..' || value.includes('\0')) {
    const error = new Error('非法文件名');
    error.code = 'INVALID_FILENAME';
    throw error;
  }
  return value;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function readTextIfExists(target, fallback = '') {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function readJsonIfExists(target, fallback = null) {
  const text = await readTextIfExists(target, '');
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    error.code = 'INVALID_JSON';
    error.path = target;
    throw error;
  }
}

export async function statIfExists(target) {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function assertIdentifier(value, label = '编号') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]+$/.test(value)) {
    const error = new Error(`${label}只能包含字母、数字、点、下划线和短横线`);
    error.code = 'INVALID_IDENTIFIER';
    throw error;
  }
  return value;
}
