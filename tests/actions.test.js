import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ActionRunner,
  createActionDefinitions
} from '../server/actions.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-actions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = {
    home: root,
    appDir: path.join(root, 'autofix', 'app'),
    runsDir: path.join(root, 'autofix', 'runs'),
    repoDir: path.join(root, 'autofix', 'worktree'),
    mainRepo: path.join(root, '01', 'hbp-editor'),
    skillDir: path.join(root, '01', 'hbp-editor', '.claude', 'skills', 'loop-autofix'),
    launchAgentsDir: path.join(root, 'Library', 'LaunchAgents'),
    dataDir: path.join(root, '.data')
  };
  await Promise.all([
    fs.mkdir(config.appDir, { recursive: true }),
    fs.mkdir(config.runsDir, { recursive: true }),
    fs.mkdir(config.skillDir, { recursive: true }),
    fs.mkdir(config.launchAgentsDir, { recursive: true })
  ]);
  await fs.writeFile(path.join(config.runsDir, 'queue.json'), '[]\n');
  return config;
}

function stoppedSnapshot() {
  return {
    async build() {
      return {
        main: { loaded: false, runAlive: false },
        notify: { loaded: false }
      };
    }
  };
}

function runnerFor(config, run = async () => ({ code: 0, stdout: '', stderr: '' })) {
  const snapshotService = stoppedSnapshot();
  const actions = createActionDefinitions({ config, snapshotService, run });
  return new ActionRunner({ config, snapshotService, run, actions });
}

async function waitDone(runner, id) {
  for (let i = 0; i < 100; i += 1) {
    const job = runner.get(id);
    if (job && job.status !== 'running') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('action did not finish');
}

test('pause and resume manage the runs marker', async (t) => {
  const config = await fixture(t);
  const runner = runnerFor(config);
  const pause = runner.start('main.pause');
  await waitDone(runner, pause.id);
  const marker = path.join(config.runsDir, 'paused');
  assert.match(await fs.readFile(marker, 'utf8'), /控制台手动暂停/);

  const resume = runner.start('main.resume');
  const done = await waitDone(runner, resume.id);
  assert.equal(done.status, 'succeeded');
  await assert.rejects(fs.access(marker));
});

test('queue.remove writes queue atomically only when stopped', async (t) => {
  const config = await fixture(t);
  await fs.writeFile(path.join(config.runsDir, 'queue.json'), JSON.stringify([
    { serialNumber: 'P-1', subject: 'one' },
    { serialNumber: 'P-2', subject: 'two' }
  ]));
  const runner = runnerFor(config);
  const job = runner.start('queue.remove', { id: 'P-1' });
  const done = await waitDone(runner, job.id);
  assert.equal(done.status, 'succeeded');
  const queue = JSON.parse(await fs.readFile(path.join(config.runsDir, 'queue.json'), 'utf8'));
  assert.deepEqual(queue.map((item) => item.serialNumber), ['P-2']);
});

test('queue.remove rejects an unsafe id', async (t) => {
  const config = await fixture(t);
  const runner = runnerFor(config);
  const job = runner.start('queue.remove', { id: '../escape' });
  const done = await waitDone(runner, job.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /任务编号/);
});

test('clear halt validates queue.json first', async (t) => {
  const config = await fixture(t);
  await fs.writeFile(path.join(config.runsDir, 'halt'), '队列损坏\n');
  await fs.writeFile(path.join(config.runsDir, 'queue.json'), '{bad');
  const runner = runnerFor(config);
  const failed = runner.start('markers.clear-halt');
  const failedDone = await waitDone(runner, failed.id);
  assert.equal(failedDone.status, 'failed');
  assert.ok(await fs.stat(path.join(config.runsDir, 'halt')));

  await fs.writeFile(path.join(config.runsDir, 'queue.json'), '[]\n');
  const ok = runner.start('markers.clear-halt');
  const okDone = await waitDone(runner, ok.id);
  assert.equal(okDone.status, 'succeeded');
  await assert.rejects(fs.access(path.join(config.runsDir, 'halt')));
});

test('runner rejects concurrent writes and records audit', async (t) => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.appDir, 'tests'), { recursive: true });
  await fs.writeFile(path.join(config.appDir, 'tests', 'run-tests.sh'), '#!/bin/bash\nexit 0\n');
  const run = async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { code: 0, stdout: 'ok\n', stderr: '' };
  };
  const runner = runnerFor(config, run);
  const job = runner.start('tests.run');
  assert.throws(() => runner.start('main.pause'), /已有操作正在执行/);
  const done = await waitDone(runner, job.id);
  assert.equal(done.status, 'succeeded');
  const audit = await fs.readFile(path.join(config.dataDir, 'audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"tests.run"/);
});

test('version.check treats mismatch as an informative result', async (t) => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.skillDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(config.skillDir, 'scripts', 'sync-version.sh'), '#!/bin/bash\n');
  const run = async () => ({ code: 1, stdout: 'loop-autofix 版本不一致：当前 1.1.0，安装 1.0.0\n', stderr: '' });
  const runner = runnerFor(config, run);
  const job = runner.start('version.check');
  const done = await waitDone(runner, job.id);
  assert.equal(done.status, 'succeeded');
  assert.match(done.output, /版本不一致/);
});

test('version actions always run the source skill script', async (t) => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.appDir, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(config.skillDir, 'scripts'), { recursive: true });
  const installed = path.join(config.appDir, 'scripts', 'sync-version.sh');
  const source = path.join(config.skillDir, 'scripts', 'sync-version.sh');
  await fs.writeFile(installed, '#!/bin/bash\nexit 0\n');
  await fs.writeFile(source, '#!/bin/bash\nexit 0\n');
  const calls = [];
  const runner = runnerFor(config, async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: '', stderr: '' };
  });

  const check = runner.start('version.check');
  assert.equal((await waitDone(runner, check.id)).status, 'succeeded');
  const sync = runner.start('version.sync');
  assert.equal((await waitDone(runner, sync.id)).status, 'succeeded');

  assert.deepEqual(calls, [
    ['bash', source, '--check'],
    ['bash', source]
  ]);
});

test('main.restart stops first and then loads the launchd task', async (t) => {
  const config = await fixture(t);
  await fs.mkdir(path.join(config.appDir, 'scripts'), { recursive: true });
  const stop = path.join(config.appDir, 'scripts', 'stop.sh');
  const plist = path.join(config.launchAgentsDir, 'com.autofix.plist');
  await fs.writeFile(stop, '#!/bin/bash\nexit 0\n');
  await fs.writeFile(plist, '<plist/>');
  const calls = [];
  const runner = runnerFor(config, async (command, args) => {
    calls.push([command, ...args]);
    return { code: 0, stdout: '', stderr: '' };
  });

  const job = runner.start('main.restart');
  const done = await waitDone(runner, job.id);
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(calls, [
    ['bash', stop],
    ['launchctl', 'list'],
    ['launchctl', 'load', plist]
  ]);
});
