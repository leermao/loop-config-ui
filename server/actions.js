import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runCommand } from './command.js';
import {
  assertIdentifier,
  pathExists,
  readJsonIfExists,
  readTextIfExists
} from './paths.js';

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function nowIso(now = () => new Date()) {
  return now().toISOString();
}

async function writeJsonAtomic(target, value) {
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
}

function appendOutput(job, text) {
  if (!text) return;
  const value = String(text);
  job.output += value;
  job.events.push({ at: Date.now(), text: value });
  for (const listener of job.listeners) listener({ type: 'output', text: value });
}

function complete(job, status, error = null) {
  job.status = status;
  job.endedAt = new Date().toISOString();
  job.error = error;
  for (const listener of job.listeners) listener({ type: 'done', status, error });
}

async function ensureSuccess(result, label) {
  if (result.code === 0) return;
  const detail = (result.stderr || result.stdout || '').trim();
  throw new Error(`${label}失败（退出码 ${result.code}）${detail ? `：${detail}` : ''}`);
}

async function scriptPath(config, ...parts) {
  const installed = path.join(config.appDir, ...parts);
  if (await pathExists(installed)) return installed;
  const source = path.join(config.skillDir, ...parts);
  if (await pathExists(source)) return source;
  throw new Error(`找不到脚本：${path.join(...parts)}`);
}

async function sourceScriptPath(config, ...parts) {
  const source = path.join(config.skillDir, ...parts);
  if (await pathExists(source)) return source;
  throw new Error(`找不到源码脚本：${path.join(...parts)}`);
}

async function launchctlState(run) {
  const result = await run('launchctl', ['list'], { timeoutMs: 3_000 });
  const labels = new Map();
  if (result.code !== 0) return labels;
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    labels.set(parts[2], {
      pid: parts[0] === '-' ? null : Number(parts[0]),
      status: parts[1] === '-' ? null : Number(parts[1])
    });
  }
  return labels;
}

async function stopScript(config, run, emit) {
  const script = await scriptPath(config, 'scripts', 'stop.sh');
  emit(`$ bash ${script}\n`);
  const result = await run('bash', [script], {
    timeoutMs: 60_000,
    onOutput: ({ text }) => emit(text)
  });
  await ensureSuccess(result, '停止流水线');
}

async function startLabel({ config, run, emit, label, plist, kickstart = false }) {
  const labels = await launchctlState(run);
  if (labels.has(label)) {
    if (kickstart) {
      emit(`launchctl kickstart -k gui/${process.getuid?.() ?? 501}/${label}\n`);
      const result = await run('launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? 501}/${label}`], { timeoutMs: 15_000 });
      await ensureSuccess(result, `启动 ${label}`);
    } else {
      emit(`${label} 已加载\n`);
    }
    return;
  }
  if (!(await pathExists(plist))) throw new Error(`找不到 launchd 配置：${plist}`);
  emit(`launchctl load ${plist}\n`);
  const result = await run('launchctl', ['load', plist], { timeoutMs: 15_000 });
  await ensureSuccess(result, `加载 ${label}`);
}

async function stopLabel({ run, emit, label, plist }) {
  const labels = await launchctlState(run);
  if (!labels.has(label)) {
    emit(`${label} 未加载\n`);
    return;
  }
  emit(`launchctl unload ${plist}\n`);
  let result = await run('launchctl', ['unload', plist], { timeoutMs: 15_000 });
  if (result.code !== 0) {
    emit(`launchctl bootout gui/${process.getuid?.() ?? 501}/${label}\n`);
    result = await run('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${label}`], { timeoutMs: 15_000 });
  }
  await ensureSuccess(result, `停止 ${label}`);
}

async function mainPlist(config) {
  const preferred = path.join(config.launchAgentsDir, 'com.autofix.plist');
  if (await pathExists(preferred)) return preferred;
  try {
    const names = (await fs.readdir(config.launchAgentsDir)).sort();
    const legacy = names.find((name) => /^com\.autofix\.v\d+\.plist$/.test(name));
    if (legacy) return path.join(config.launchAgentsDir, legacy);
  } catch {
    // Fall through to the preferred path so the action reports a useful error.
  }
  return preferred;
}

function notifyPlist(config) {
  return path.join(config.launchAgentsDir, 'com.autofix.notify.plist');
}

async function requireStopped(snapshotService, config) {
  const state = await snapshotService.build();
  if (state.main.loaded || state.main.runAlive) {
    throw new Error('流水线仍在运行，请先停止');
  }
  if (!(await pathExists(config.runsDir))) {
    throw new Error(`状态目录不存在：${config.runsDir}`);
  }
  return state;
}

export function createActionDefinitions({
  config,
  snapshotService,
  run = runCommand,
  now = () => new Date()
}) {
  const definitions = new Map();
  const add = (id, definition) => definitions.set(id, { id, ...definition });

  add('main.start', {
    label: '启动主流水线',
    danger: false,
    async run(emit) {
      const state = await snapshotService.build();
      if (state.main.loaded && state.main.runAlive) {
        emit('主流水线已在运行。\n');
        return;
      }
      const plist = await mainPlist(config);
      await startLabel({ config, run, emit, label: 'com.autofix', plist, kickstart: state.main.loaded });
    }
  });

  add('main.stop', {
    label: '停止主流水线',
    danger: true,
    async run(emit) {
      await stopScript(config, run, emit);
    }
  });

  add('main.restart', {
    label: '重启主流水线',
    danger: true,
    async run(emit) {
      await stopScript(config, run, emit);
      const plist = await mainPlist(config);
      await startLabel({ config, run, emit, label: 'com.autofix', plist, kickstart: true });
    }
  });

  add('main.pause', {
    label: '暂停取任务',
    danger: false,
    async run(emit) {
      await fs.mkdir(config.runsDir, { recursive: true });
      await fs.writeFile(path.join(config.runsDir, 'paused'), `控制台手动暂停 ${nowIso(now)}\n`, { mode: 0o600 });
      emit('已暂停取任务；当前任务会继续跑完。\n');
    }
  });

  add('main.resume', {
    label: '恢复取任务',
    danger: false,
    async run(emit) {
      const marker = path.join(config.runsDir, 'paused');
      if (!(await pathExists(marker))) {
        emit('当前没有暂停标记。\n');
        return;
      }
      await fs.unlink(marker);
      emit('已恢复取任务。\n');
    }
  });

  add('notify.start', {
    label: '启动通知任务',
    danger: false,
    async run(emit) {
      await startLabel({ config, run, emit, label: 'com.autofix.notify', plist: notifyPlist(config), kickstart: true });
    }
  });

  add('notify.stop', {
    label: '停止通知任务',
    danger: false,
    async run(emit) {
      await stopLabel({ run, emit, label: 'com.autofix.notify', plist: notifyPlist(config) });
    }
  });

  add('notify.restart', {
    label: '重启通知任务',
    danger: false,
    async run(emit) {
      await stopLabel({ run, emit, label: 'com.autofix.notify', plist: notifyPlist(config) });
      await startLabel({ config, run, emit, label: 'com.autofix.notify', plist: notifyPlist(config), kickstart: true });
    }
  });

  add('notify.send', {
    label: '立即发送一次通知',
    danger: false,
    async run(emit) {
      const script = await scriptPath(config, 'scripts', 'notify.sh');
      emit(`$ bash ${script}\n`);
      const result = await run('bash', [script], {
        timeoutMs: 60_000,
        onOutput: ({ text }) => emit(text)
      });
      await ensureSuccess(result, '发送通知');
    }
  });

  add('version.check', {
    label: '检查版本',
    danger: false,
    async run(emit) {
      const script = await sourceScriptPath(config, 'scripts', 'sync-version.sh');
      emit(`$ bash ${script} --check\n`);
      const result = await run('bash', [script, '--check'], {
        timeoutMs: 60_000,
        onOutput: ({ text }) => emit(text)
      });
      if (result.code === 1) {
        if (/版本不一致/.test(`${result.stdout}\n${result.stderr}`)) {
          emit('版本不一致，这是检查结果，不代表执行失败。\n');
          return;
        }
      }
      await ensureSuccess(result, '检查版本');
    }
  });

  add('version.sync', {
    label: '同步版本并重启',
    danger: true,
    async run(emit) {
      const script = await sourceScriptPath(config, 'scripts', 'sync-version.sh');
      emit(`$ bash ${script}\n`);
      const result = await run('bash', [script], {
        timeoutMs: 180_000,
        onOutput: ({ text }) => emit(text)
      });
      await ensureSuccess(result, '同步版本');
    }
  });

  add('launchd.repair', {
    label: '重新安装主 launchd 配置',
    danger: true,
    async run(emit) {
      await requireStopped(snapshotService, config);
      const source = path.join(config.appDir, 'launchd', 'com.autofix.plist');
      if (!(await pathExists(source))) throw new Error(`找不到安装副本中的 plist：${source}`);
      await fs.mkdir(config.launchAgentsDir, { recursive: true });
      const target = path.join(config.launchAgentsDir, 'com.autofix.plist');
      await fs.copyFile(source, target);
      emit(`已重新安装 ${target}\n`);
      emit('配置未自动加载；确认内容后使用“启动主流水线”。\n');
    }
  });

  add('queue.remove', {
    label: '从队列删除任务',
    danger: true,
    async run(emit, input) {
      const id = assertIdentifier(input?.id, '任务编号');
      await requireStopped(snapshotService, config);
      const queuePath = path.join(config.runsDir, 'queue.json');
      const queue = await readJsonIfExists(queuePath, []);
      if (!Array.isArray(queue)) throw new Error('queue.json 不是数组，不能修改');
      if (!queue.some((item) => item?.serialNumber === id)) throw new Error(`队列里没有 ${id}`);
      const next = queue.filter((item) => item?.serialNumber !== id);
      await writeJsonAtomic(queuePath, next);
      emit(`已从队列删除 ${id}；任务目录保留在 ${path.join(config.runsDir, 'tasks', id)}。\n`);
    }
  });

  add('markers.clear-blocked', {
    label: '清除 blocked',
    danger: true,
    async run(emit) {
      const marker = path.join(config.runsDir, 'blocked');
      const reason = await readTextIfExists(marker, '');
      if (!reason) {
        emit('blocked 不存在。\n');
        return;
      }
      await fs.unlink(marker);
      emit(`已清除 blocked：${reason.trim()}\n`);
    }
  });

  add('markers.clear-halt', {
    label: '清除 halt',
    danger: true,
    async run(emit) {
      const queuePath = path.join(config.runsDir, 'queue.json');
      const queue = await readJsonIfExists(queuePath, null);
      if (!Array.isArray(queue)) throw new Error('queue.json 不是合法数组，不能清除 halt');
      const marker = path.join(config.runsDir, 'halt');
      const reason = await readTextIfExists(marker, '');
      if (!reason) {
        emit('halt 不存在。\n');
        return;
      }
      await fs.unlink(marker);
      emit(`已清除 halt：${reason.trim()}\n`);
    }
  });

  add('worktree.rebuild', {
    label: '重建 worktree',
    danger: true,
    async run(emit) {
      await requireStopped(snapshotService, config);
      if (await pathExists(config.repoDir)) {
        emit(`$ git -C ${config.mainRepo} worktree remove --force ${config.repoDir}\n`);
        const result = await run('git', ['-C', config.mainRepo, 'worktree', 'remove', '--force', config.repoDir], {
          timeoutMs: 30_000,
          onOutput: ({ text }) => emit(text)
        });
        if (result.code !== 0) {
          throw new Error(`移除 worktree 失败：${(result.stderr || result.stdout).trim()}`);
        }
      }
      emit('worktree 已移除；下次启动流水线时会自动重建。\n');
    }
  });

  add('deps.reset', {
    label: '强制重装依赖',
    danger: false,
    async run(emit) {
      const entries = await fs.readdir(config.runsDir).catch(() => []);
      const removed = [];
      for (const name of entries) {
        if (!name.startsWith('deps-')) continue;
        await fs.rm(path.join(config.runsDir, name), { force: true });
        removed.push(name);
      }
      emit(removed.length ? `已删除依赖指纹：${removed.join(', ')}\n` : '没有依赖指纹需要删除。\n');
      emit('下一条任务会重新安装依赖。\n');
    }
  });

  add('tests.run', {
    label: '运行 skill 回归测试',
    danger: false,
    async run(emit) {
      const script = await scriptPath(config, 'tests', 'run-tests.sh');
      emit(`$ bash ${script}\n`);
      const result = await run('bash', [script], {
        timeoutMs: 300_000,
        onOutput: ({ text }) => emit(text)
      });
      await ensureSuccess(result, '回归测试');
    }
  });

  add('yunxiao.list', {
    label: '查询云效待处理缺陷',
    danger: false,
    async run(emit) {
      const script = await scriptPath(config, 'scripts', 'yunxiao', 'test-yunxiao-api.sh');
      emit(`$ bash ${script} list\n`);
      const result = await run('bash', [script, 'list'], {
        timeoutMs: 180_000,
        onOutput: ({ text }) => emit(text)
      });
      await ensureSuccess(result, '查询云效');
    }
  });

  return definitions;
}

export class ActionRunner {
  constructor({ config, snapshotService, run = runCommand, now = () => new Date(), actions }) {
    this.config = config;
    this.snapshotService = snapshotService;
    this.run = run;
    this.now = now;
    this.actions = actions ?? createActionDefinitions({ config, snapshotService, run, now });
    this.activeJob = null;
    this.jobs = new Map();
  }

  start(actionId, input = {}) {
    const definition = this.actions.get(actionId);
    if (!definition) throw httpError(`不支持的操作：${actionId}`, 404);
    if (this.activeJob) throw httpError(`已有操作正在执行：${this.activeJob.label}`, 409);

    const job = {
      id: randomUUID(),
      action: actionId,
      label: definition.label,
      danger: definition.danger,
      input,
      status: 'running',
      startedAt: nowIso(this.now),
      endedAt: null,
      output: '',
      error: null,
      events: [],
      listeners: new Set()
    };
    this.activeJob = job;
    this.jobs.set(job.id, job);
    this.prune();
    queueMicrotask(() => this.execute(job, definition));
    return this.publicJob(job);
  }

  async execute(job, definition) {
    const emit = (text) => appendOutput(job, text);
    try {
      emit(`开始：${definition.label}\n`);
      await definition.run(emit, job.input);
      emit(`完成：${definition.label}\n`);
      complete(job, 'succeeded');
    } catch (error) {
      appendOutput(job, `失败：${error.message}\n`);
      complete(job, 'failed', error.message);
    } finally {
      this.activeJob = null;
      await this.audit(job);
    }
  }

  async audit(job) {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      const record = {
        at: new Date().toISOString(),
        id: job.id,
        action: job.action,
        label: job.label,
        input: job.input,
        status: job.status,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        error: job.error
      };
      await fs.appendFile(path.join(this.config.dataDir, 'audit.jsonl'), `${JSON.stringify(record)}\n`);
    } catch {
      // Audit failure must not hide the action result.
    }
  }

  prune() {
    if (this.jobs.size <= 50) return;
    const old = [...this.jobs.values()]
      .filter((job) => job.status !== 'running')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
      .slice(0, this.jobs.size - 50);
    for (const job of old) this.jobs.delete(job.id);
  }

  publicJob(job) {
    return {
      id: job.id,
      action: job.action,
      label: job.label,
      danger: job.danger,
      status: job.status,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      output: job.output,
      error: job.error
    };
  }

  get(jobId) {
    const job = this.jobs.get(jobId);
    return job ? this.publicJob(job) : null;
  }

  subscribe(jobId, listener) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.listeners.add(listener);
    return () => job.listeners.delete(listener);
  }

  list() {
    return [...this.jobs.values()].map((job) => this.publicJob(job));
  }

  listDefinitions() {
    return [...this.actions.values()].map((definition) => ({
      id: definition.id,
      label: definition.label,
      danger: definition.danger
    }));
  }
}
