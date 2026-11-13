import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSnapshotService } from '../server/snapshot.js';

const PGREP_KEY = 'pgrep -fl autofix/app/scripts/run\\.sh|autofix-e2e[^/]*/.*run\\.sh';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-state-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const appDir = path.join(home, 'autofix', 'app');
  const runsDir = path.join(home, 'autofix', 'runs');
  const repoDir = path.join(home, 'autofix', 'worktree');
  const mainRepo = path.join(home, '01', 'hbp-editor');
  const skillDir = path.join(mainRepo, '.claude', 'skills', 'loop-autofix');
  const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
  await Promise.all([
    fs.mkdir(appDir, { recursive: true }),
    fs.mkdir(runsDir, { recursive: true }),
    fs.mkdir(repoDir, { recursive: true }),
    fs.mkdir(skillDir, { recursive: true }),
    fs.mkdir(launchAgentsDir, { recursive: true })
  ]);
  await fs.writeFile(path.join(appDir, 'VERSION'), '1.1.0\n');
  await fs.writeFile(path.join(skillDir, 'VERSION'), '1.1.0\n');
  await fs.writeFile(path.join(launchAgentsDir, 'com.autofix.plist'), '<plist/>');
  await fs.writeFile(path.join(runsDir, 'queue.json'), '[]\n');
  return { home, appDir, runsDir, repoDir, mainRepo, skillDir, launchAgentsDir };
}

function configFrom(paths) {
  return {
    appDir: paths.appDir,
    runsDir: paths.runsDir,
    repoDir: paths.repoDir,
    mainRepo: paths.mainRepo,
    skillDir: paths.skillDir,
    launchAgentsDir: paths.launchAgentsDir
  };
}

function fakeRun(overrides = {}) {
  return async (command, args) => {
    const key = `${command} ${args.join(' ')}`;
    if (overrides[key]) return overrides[key];
    if (command === 'launchctl') return { code: 0, stdout: '', stderr: '' };
    if (command === 'pgrep') return { code: 1, stdout: '', stderr: '' };
    if (command === 'git') return { code: 0, stdout: '', stderr: '' };
    return { code: 1, stdout: '', stderr: `${key} not stubbed` };
  };
}

test('stopped state still reports installed app and versions', async (t) => {
  const paths = await fixture(t);
  const service = createSnapshotService(configFrom(paths), { run: fakeRun() });
  const state = await service.build();
  assert.equal(state.installed, true);
  assert.equal(state.status, 'stopped');
  assert.equal(state.versions.match, true);
});

test('running state combines launchd, lock, queue and current task', async (t) => {
  const paths = await fixture(t);
  await fs.symlink(String(process.pid), path.join(paths.runsDir, 'run.lock'));
  await fs.writeFile(path.join(paths.runsDir, 'queue.json'), JSON.stringify([
    { serialNumber: 'P-2', subject: 'second', priorityRank: 2, gmtCreate: 2 },
    { serialNumber: 'P-1', subject: 'first', priorityRank: 1, gmtCreate: 3 }
  ]));
  await fs.mkdir(path.join(paths.runsDir, 'tasks', 'P-1'), { recursive: true });
  await fs.writeFile(path.join(paths.runsDir, 'tasks', 'P-1', 'task.json'), JSON.stringify({ subject: '第一个任务' }));
  await fs.writeFile(path.join(paths.runsDir, 'current'), `P-1\tcodex 修复\t${Math.floor(Date.now() / 1000) - 60}\n`);
  await fs.writeFile(path.join(paths.runsDir, 'log'), '2026-11-13 10:00  ▶ P-1 开始\n');

  const run = fakeRun({
    'launchctl list': { code: 0, stdout: `${process.pid}\t0\tcom.autofix\n${process.pid}\t0\tcom.autofix.notify\n`, stderr: '' },
    [PGREP_KEY]: { code: 0, stdout: `${process.pid} /bin/bash /Users/admin/autofix/app/scripts/run.sh\n`, stderr: '' }
  });
  const service = createSnapshotService(configFrom(paths), { run });
  const state = await service.build();

  assert.equal(state.status, 'running');
  assert.equal(state.main.loaded, true);
  assert.equal(state.notify.loaded, true);
  assert.equal(state.queue.count, 2);
  assert.equal(state.queue.items[0].serialNumber, 'P-1');
  assert.equal(state.currentTask.subject, '第一个任务');
  assert.ok(state.currentTask.elapsedSeconds >= 60);
  assert.deepEqual(state.recentLog, ['2026-11-13 10:00  ▶ P-1 开始']);
});

test('recent events pick up appended progress log lines', async (t) => {
  const paths = await fixture(t);
  const service = createSnapshotService(configFrom(paths), { run: fakeRun() });
  await fs.writeFile(path.join(paths.runsDir, 'log'), '2026-11-13 10:00  ▶ P-1 开始\n');

  const first = await service.build();
  assert.deepEqual(first.recentLog, ['2026-11-13 10:00  ▶ P-1 开始']);

  await fs.appendFile(path.join(paths.runsDir, 'log'), '2026-11-13 10:01  ✅ P-1 完成\n');
  const second = await service.build();
  assert.deepEqual(second.recentLog, [
    '2026-11-13 10:00  ▶ P-1 开始',
    '2026-11-13 10:01  ✅ P-1 完成'
  ]);
});

test('paused and halted markers take precedence', async (t) => {
  const paths = await fixture(t);
  const run = fakeRun({
    'launchctl list': { code: 0, stdout: `${process.pid}\t0\tcom.autofix\n`, stderr: '' },
    [PGREP_KEY]: { code: 0, stdout: `${process.pid} /bin/bash run.sh\n`, stderr: '' }
  });
  const service = createSnapshotService(configFrom(paths), { run });
  await fs.writeFile(path.join(paths.runsDir, 'paused'), '控制台手动暂停\n');
  assert.equal((await service.build()).status, 'paused');
  await fs.writeFile(path.join(paths.runsDir, 'halt'), '队列损坏\n');
  assert.equal((await service.build()).status, 'halted');
});

test('invalid queue is exposed without hiding running state', async (t) => {
  const paths = await fixture(t);
  await fs.writeFile(path.join(paths.runsDir, 'queue.json'), '{bad');
  const run = fakeRun({
    'launchctl list': { code: 0, stdout: `${process.pid}\t0\tcom.autofix\n`, stderr: '' },
    [PGREP_KEY]: { code: 0, stdout: `${process.pid} /bin/bash run.sh\n`, stderr: '' }
  });
  const state = await createSnapshotService(configFrom(paths), { run }).build();
  assert.equal(state.status, 'running');
  assert.match(state.queue.error, /JSON|Unexpected|property/i);
  assert.equal(state.checks.find((item) => item.id === 'queue').status, 'error');
});

test('worktree state is reported', async (t) => {
  const paths = await fixture(t);
  const run = fakeRun({
    'launchctl list': { code: 0, stdout: `${process.pid}\t0\tcom.autofix\n`, stderr: '' },
    [PGREP_KEY]: { code: 0, stdout: `${process.pid} /bin/bash run.sh\n`, stderr: '' },
    [`git -C ${paths.repoDir} branch --show-current`]: { code: 0, stdout: 'fix/bugfix-20261113\n', stderr: '' },
    [`git -C ${paths.repoDir} status --porcelain`]: { code: 0, stdout: ' M client/a.js\n', stderr: '' },
    [`git -C ${paths.repoDir} log -1 --format=%h%x09%s`]: { code: 0, stdout: 'abc123\tfix: something (P-1)\n', stderr: '' },
    [`git -C ${paths.repoDir} stash list --format=%gd%x09%s`]: { code: 0, stdout: 'stash@{0}\tautofix P-2\n', stderr: '' }
  });
  const state = await createSnapshotService(configFrom(paths), { run }).build();
  assert.equal(state.worktree.branch, 'fix/bugfix-20261113');
  assert.equal(state.worktree.dirty, true);
  assert.deepEqual(state.worktree.changedFiles, ['client/a.js']);
  assert.equal(state.worktree.stashes.length, 1);
});

test('residual e2e run.sh is reported but not counted as the main run', async (t) => {
  const paths = await fixture(t);
  const run = fakeRun({
    [PGREP_KEY]: {
      code: 0,
      stdout: '4242 /bin/bash /tmp/autofix-e2e.yc6uAn/run.sh\n',
      stderr: ''
    }
  });
  const state = await createSnapshotService(configFrom(paths), { run }).build();

  assert.equal(state.status, 'error');
  assert.equal(state.main.runAlive, false);
  assert.equal(state.main.residualAlive, true);
  assert.deepEqual(state.main.residualPids, [4242]);
  assert.match(state.statusReasons.join('\n'), /残留 e2e run\.sh/);
  assert.equal(state.checks.find((item) => item.id === 'residual').status, 'warn');
});
