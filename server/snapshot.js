import fs from 'node:fs/promises';
import path from 'node:path';

import { runCommand } from './command.js';
import { readLogChunk, readTail } from './logs.js';
import {
  pathExists,
  readJsonIfExists,
  readTextIfExists,
  statIfExists
} from './paths.js';

const DEFAULT_RUN_PATTERN = 'autofix/app/scripts/run\\.sh|autofix-e2e[^/]*/.*run\\.sh';
const INSTALLED_RUN_RE = /autofix\/app\/scripts\/run\.sh/;
const E2E_RUN_RE = /autofix-e2e[^/]*\/.*run\.sh/;

function statusLabel(status) {
  return {
    'not-installed': '未安装',
    stopped: '已停止',
    starting: '启动中',
    running: '运行中',
    paused: '暂停取任务',
    blocked: '暂停取任务（worktree 未就绪）',
    halted: '已停机',
    error: '异常'
  }[status] ?? '未知';
}

function statusTone(status) {
  if (status === 'running') return 'running';
  if (status === 'paused' || status === 'blocked' || status === 'starting') return 'warn';
  if (status === 'halted' || status === 'error') return 'danger';
  return 'neutral';
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function parseLaunchctl(stdout) {
  const labels = new Map();
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [pidRaw, statusRaw, label] = parts;
    const pid = pidRaw === '-' ? null : Number(pidRaw);
    const status = statusRaw === '-' ? null : Number(statusRaw);
    labels.set(label, {
      label,
      pid: Number.isInteger(pid) ? pid : null,
      status: Number.isInteger(status) ? status : null
    });
  }
  return labels;
}

function parsePgrep(stdout) {
  return String(stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), command: match[2] } : null;
  }).filter(Boolean);
}

async function readMainPlist(config) {
  const candidates = [];
  const preferred = path.join(config.launchAgentsDir, 'com.autofix.plist');
  if (await pathExists(preferred)) candidates.push(preferred);
  try {
    const names = await fs.readdir(config.launchAgentsDir);
    for (const name of names.sort()) {
      if (!/^com\.autofix\.v\d+\.plist$/.test(name)) continue;
      const target = path.join(config.launchAgentsDir, name);
      if (!candidates.includes(target)) candidates.push(target);
    }
  } catch {
    // LaunchAgents may not exist.
  }
  return candidates;
}

async function readCurrent(config) {
  const text = await readTextIfExists(path.join(config.runsDir, 'current'), '');
  if (!text.trim()) return null;
  const [id, stage, startedRaw] = text.trim().split('\t');
  if (!id) return null;
  const startedAt = Number(startedRaw);
  let subject = '';
  try {
    const task = JSON.parse(await fs.readFile(path.join(config.runsDir, 'tasks', id, 'task.json'), 'utf8'));
    subject = typeof task.subject === 'string' ? task.subject : '';
  } catch {
    // The task may already have been moved to manual.
  }
  return {
    id,
    subject,
    stage: stage || '未知',
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    elapsedSeconds: Number.isFinite(startedAt) ? Math.max(0, Math.floor(Date.now() / 1000 - startedAt)) : null
  };
}

async function readQueue(config) {
  try {
    const queue = await readJsonIfExists(path.join(config.runsDir, 'queue.json'), []);
    if (!Array.isArray(queue)) {
      const error = new Error('queue.json 不是数组');
      error.code = 'INVALID_QUEUE';
      throw error;
    }
    return {
      items: [...queue].sort((a, b) => {
        const priorityA = Number.isFinite(a?.priorityRank) ? a.priorityRank : 5;
        const priorityB = Number.isFinite(b?.priorityRank) ? b.priorityRank : 5;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return (Number(a?.gmtCreate) || 0) - (Number(b?.gmtCreate) || 0);
      }),
      error: null
    };
  } catch (error) {
    return { items: [], error: error.message };
  }
}

async function readMarker(config, name) {
  const target = path.join(config.runsDir, name);
  if (!(await pathExists(target))) return null;
  return (await readTextIfExists(target, '')).trim();
}

async function readVersions(config) {
  const source = (await readTextIfExists(path.join(config.skillDir, 'VERSION'), '')).trim();
  const installed = (await readTextIfExists(path.join(config.appDir, 'VERSION'), '')).trim();
  return {
    source: source || null,
    installed: installed || null,
    match: Boolean(source) && source === installed
  };
}

function recentLines(text, count = 20) {
  const lines = String(text ?? '').split(/\r?\n/).filter(Boolean);
  return lines.slice(-count);
}

export function createSnapshotService(config, {
  run = runCommand,
  worktreeTtlMs = 5_000,
  launchctlTtlMs = 1_000,
  now = () => Date.now()
} = {}) {
  let launchCache = { at: 0, value: null };
  let worktreeCache = { at: 0, value: null };
  let lastLogOffset = 0;

  async function launchctlState() {
    const at = now();
    if (launchCache.value && at - launchCache.at < launchctlTtlMs) return launchCache.value;
    const result = await run('launchctl', ['list'], { timeoutMs: 3_000 });
    const labels = result.code === 0 ? parseLaunchctl(result.stdout) : new Map();
    launchCache = { at, value: labels };
    return labels;
  }

  async function processState() {
    const pattern = String(config.values?.get?.('AUTOFIX_STOP_MATCH') || DEFAULT_RUN_PATTERN);
    const lockPath = path.join(config.runsDir, 'run.lock');
    let lockPid = null;
    let lockAlive = false;
    try {
      const link = await fs.readlink(lockPath);
      lockPid = Number(link);
      lockAlive = isPidAlive(lockPid);
    } catch {
      // No lock or not a symlink.
    }
    const pgrep = await run('pgrep', ['-fl', pattern], { timeoutMs: 3_000 });
    const processes = pgrep.code === 0 ? parsePgrep(pgrep.stdout) : [];
    const installedProcesses = processes.filter((item) => INSTALLED_RUN_RE.test(item.command));
    const residualProcesses = processes.filter((item) => E2E_RUN_RE.test(item.command));
    const mainProcesses = installedProcesses.length > 0
      ? installedProcesses
      : processes.filter((item) => !E2E_RUN_RE.test(item.command));
    const runProcess = mainProcesses.find((item) => /\/bash\b/.test(item.command))
      ?? mainProcesses[0]
      ?? null;
    const mainRunAlive = lockAlive || Boolean(runProcess);
    const residualAlive = residualProcesses.length > 0;
    return {
      lockPid,
      lockAlive,
      processes,
      runPid: runProcess?.pid ?? (lockAlive ? lockPid : null),
      mainRunAlive,
      residualAlive,
      residualPids: residualProcesses.map((item) => item.pid),
      alive: mainRunAlive || residualAlive,
      caffeinateAlive: processes.some((item) => /\/caffeinate\b/.test(item.command))
    };
  }

  async function worktreeState() {
    const at = now();
    if (worktreeCache.value && at - worktreeCache.at < worktreeTtlMs) return worktreeCache.value;
    if (!(await pathExists(config.repoDir))) {
      worktreeCache = { at, value: { exists: false, branch: null, dirty: false, changedFiles: [], head: null, stashes: [] } };
      return worktreeCache.value;
    }
    const [branch, status, head, stash] = await Promise.all([
      run('git', ['-C', config.repoDir, 'branch', '--show-current'], { timeoutMs: 2_000 }),
      run('git', ['-C', config.repoDir, 'status', '--porcelain'], { timeoutMs: 2_000 }),
      run('git', ['-C', config.repoDir, 'log', '-1', '--format=%h%x09%s'], { timeoutMs: 2_000 }),
      run('git', ['-C', config.repoDir, 'stash', 'list', '--format=%gd%x09%s'], { timeoutMs: 2_000 })
    ]);
    const changedFiles = status.code === 0
      ? status.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3))
      : [];
    const value = {
      exists: true,
      branch: branch.code === 0 ? branch.stdout.trim() : null,
      dirty: changedFiles.length > 0,
      changedFiles,
      head: head.code === 0 ? head.stdout.trim() : null,
      stashes: stash.code === 0 ? stash.stdout.split(/\r?\n/).filter(Boolean) : []
    };
    worktreeCache = { at, value };
    return value;
  }

  async function build() {
    const generatedAt = new Date(now()).toISOString();
    const [mainPlists, appExists, skillExists] = await Promise.all([
      readMainPlist(config),
      pathExists(config.appDir),
      pathExists(config.skillDir)
    ]);
    const installed = appExists && mainPlists.length > 0;
    const [labels, processes, currentTask, queue, versions, worktree, paused, blocked, halt] = await Promise.all([
      launchctlState(),
      processState(),
      readCurrent(config),
      readQueue(config),
      readVersions(config),
      worktreeState(),
      readMarker(config, 'paused'),
      readMarker(config, 'blocked'),
      readMarker(config, 'halt')
    ]);
    const lastSyncRaw = Number((await readTextIfExists(path.join(config.runsDir, 'last-sync'), '')).trim());
    const lastSyncAt = Number.isFinite(lastSyncRaw) && lastSyncRaw > 0
      ? new Date(lastSyncRaw * 1000).toISOString()
      : null;

    const mainLabel = ['com.autofix', ...labels.keys()].find((label) => /^com\.autofix(?:\.v\d+)?$/.test(label) && labels.has(label))
      ?? null;
    const main = mainLabel ? labels.get(mainLabel) : null;
    const notify = labels.get('com.autofix.notify') ?? null;
    const runAlive = processes.alive;
    const mainRunAlive = processes.mainRunAlive;
    const mainLoaded = Boolean(main);

    let status = 'running';
    const reasons = [];
    if (!installed) {
      status = 'not-installed';
      reasons.push('缺少安装副本或 launchd 主任务配置');
    } else if (halt) {
      status = 'halted';
      reasons.push(`halt：${halt}`);
    } else if (paused && (mainLoaded || runAlive)) {
      status = 'paused';
      reasons.push(`暂停取任务：${paused}`);
    } else if (blocked && (mainLoaded || runAlive)) {
      status = 'blocked';
      reasons.push(`blocked：${blocked}`);
    } else if (!mainLoaded && !mainRunAlive && processes.residualAlive) {
      status = 'error';
      reasons.push(`检测到残留 e2e run.sh：PID ${processes.residualPids.join(', ')}`);
    } else if (!mainLoaded && !mainRunAlive) {
      status = 'stopped';
      reasons.push('launchd 主任务未加载，run.sh 未运行');
    } else if (!mainLoaded && mainRunAlive) {
      status = 'error';
      reasons.push('run.sh 在运行，但 launchd 主任务未加载');
    } else if (mainLoaded && !mainRunAlive && processes.residualAlive) {
      status = 'error';
      reasons.push(`主流水线未运行，但检测到残留 e2e run.sh：PID ${processes.residualPids.join(', ')}`);
    } else if (mainLoaded && !mainRunAlive) {
      if (main.status !== null && main.status !== 0) {
        status = 'error';
        reasons.push(`launchd 已加载，但 run.sh 未运行，最后退出状态 ${main.status}`);
      } else {
        status = 'starting';
        reasons.push('launchd 已加载，正在等待 run.sh 启动');
      }
    } else {
      status = 'running';
      reasons.push('launchd 已加载，run.sh 存活');
    }
    if (mainRunAlive && processes.residualAlive) {
      reasons.push(`另有残留 e2e run.sh：PID ${processes.residualPids.join(', ')}`);
    }
    if (queue.error) reasons.push(`队列异常：${queue.error}`);
    if (versions.source && versions.installed && !versions.match) {
      reasons.push(`版本不一致：源码 ${versions.source}，安装 ${versions.installed}`);
    }
    if (!notify && status === 'running') reasons.push('通知任务未加载');

    const logPath = path.join(config.runsDir, 'log');
    const tail = await readTail(logPath, { maxBytes: 128 * 1024 });
    lastLogOffset = tail.offset;

    return {
      generatedAt,
      installed,
      appExists,
      skillExists,
      status,
      statusLabel: statusLabel(status),
      statusTone: statusTone(status),
      statusReasons: reasons,
      main: {
        loaded: mainLoaded,
        label: mainLabel,
        pid: main?.pid ?? processes.runPid,
        exitStatus: main?.status ?? null,
        plist: mainPlists[0] ?? null,
        plists: mainPlists,
        runAlive: mainRunAlive,
        residualAlive: processes.residualAlive,
        residualPids: processes.residualPids,
        runPid: processes.runPid,
        lockPid: processes.lockPid,
        lockAlive: processes.lockAlive,
        caffeinateAlive: processes.caffeinateAlive,
        processes: processes.processes
      },
      notify: {
        loaded: Boolean(notify),
        pid: notify?.pid ?? null,
        exitStatus: notify?.status ?? null
      },
      versions,
      queue: {
        items: queue.items,
        count: queue.items.length,
        error: queue.error
      },
      currentTask,
      markers: { paused, blocked, halt },
      sync: {
        lastSyncAt,
        startHour: Number(config.values?.get?.('AUTOFIX_SYNC_START') ?? 9),
        endHour: Number(config.values?.get?.('AUTOFIX_SYNC_END') ?? 21),
        timezone: config.values?.get?.('AUTOFIX_TZ') ?? 'Asia/Shanghai'
      },
      worktree,
      recentLog: recentLines(tail.text),
      logOffset: lastLogOffset,
      checks: [
        { id: 'app', status: appExists ? 'ok' : 'error', label: '安装副本', detail: config.appDir },
        { id: 'skill', status: skillExists ? 'ok' : 'error', label: '源码 skill', detail: config.skillDir },
        { id: 'main', status: mainLoaded ? 'ok' : 'warn', label: '主 launchd 任务', detail: mainLabel ?? '未加载' },
        { id: 'run', status: mainRunAlive ? 'ok' : 'error', label: 'run.sh', detail: processes.runPid ? `PID ${processes.runPid}` : '未运行' },
        {
          id: 'residual',
          status: processes.residualAlive ? 'warn' : 'ok',
          label: '残留 e2e 进程',
          detail: processes.residualAlive ? `PID ${processes.residualPids.join(', ')}` : '无'
        },
        { id: 'notify', status: notify ? 'ok' : 'warn', label: '通知任务', detail: notify ? `PID ${notify.pid}` : '未加载' },
        { id: 'queue', status: queue.error ? 'error' : 'ok', label: '队列', detail: queue.error ?? `${queue.items.length} 条` },
        { id: 'version', status: versions.match ? 'ok' : 'warn', label: '版本', detail: `${versions.source ?? '无'} / ${versions.installed ?? '无'}` }
      ]
    };
  }

  return {
    build,
    async readLogDelta(offset = 0) {
      return readLogChunk(path.join(config.runsDir, 'log'), offset);
    }
  };
}
