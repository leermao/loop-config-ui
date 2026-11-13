import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runDoctor } from '../server/doctor.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'autofix', 'app');
  const runsDir = path.join(root, 'autofix', 'runs');
  const repoDir = path.join(root, 'autofix', 'worktree');
  const mainRepo = path.join(root, '01', 'hbp-editor');
  const skillDir = path.join(mainRepo, '.claude', 'skills', 'loop-autofix');
  const launchAgentsDir = path.join(root, 'Library', 'LaunchAgents');
  await Promise.all([
    fs.mkdir(appDir, { recursive: true }),
    fs.mkdir(runsDir, { recursive: true }),
    fs.mkdir(repoDir, { recursive: true }),
    fs.mkdir(skillDir, { recursive: true }),
    fs.mkdir(launchAgentsDir, { recursive: true })
  ]);
  await fs.writeFile(path.join(runsDir, 'queue.json'), '[]\n');
  return {
    root,
    appDir,
    runsDir,
    repoDir,
    mainRepo,
    skillDir,
    launchAgentsDir,
    envFile: path.join(appDir, '.env'),
    dataDir: path.join(root, '.data'),
    entries: [
      { key: 'YUNXIAO_TOKEN', configured: false },
      { key: 'GITLAB_TOKEN', configured: false }
    ]
  };
}

function fakeSnapshot() {
  return {
    async build() {
      return {
        main: { loaded: false, label: null, plist: null },
        notify: { loaded: false },
        versions: { source: '1.1.0', installed: null, match: false },
        queue: { count: 0 },
        worktree: { exists: true, dirty: false, branch: 'fix/test', changedFiles: [] }
      };
    }
  };
}

test('doctor reports missing commands and paths with fixes', async (t) => {
  const config = await fixture(t);
  const run = async (command, args) => {
    if (command === 'pnpm') return { code: 0, stdout: '11.15.1\n', stderr: '' };
    if (command === 'glab') return { code: 1, stdout: '', stderr: 'not logged in' };
    return { code: 1, stdout: '', stderr: '' };
  };
  const findCommand = async (name) => {
    if (name === 'glab') return '/usr/local/bin/glab';
    return null;
  };
  const report = await runDoctor(config, {
    run,
    snapshotService: fakeSnapshot(),
    findCommand
  });

  assert.ok(report.summary.error > 0);
  const jq = report.items.find((item) => item.id === 'command:jq');
  assert.equal(jq.status, 'error');
  assert.match(jq.fix, /brew install jq/);
  const glab = report.items.find((item) => item.id === 'glab:auth');
  assert.equal(glab.status, 'warn');
  const version = report.items.find((item) => item.id === 'version');
  assert.equal(version.status, 'warn');
  assert.deepEqual(version.target, {
    view: 'operations',
    actionId: 'version.sync',
    label: '同步版本并重启'
  });
  const envFile = report.items.find((item) => item.id === 'path:env');
  assert.deepEqual(envFile.target, {
    view: 'config',
    label: '去配置',
    key: null
  });
  const order = (id) => report.items.findIndex((item) => item.id === id);
  assert.ok(order('worktree') < order('command:claude'));
  assert.ok(order('command:claude') < order('launchd:main'));
  assert.ok(order('launchd:main') < order('credential:yunxiao'));
  assert.ok(order('credential:yunxiao') < order('command:jq'));
  assert.ok(order('command:jq') < order('pnpm:version'));
});

test('doctor reports invalid queue and dirty worktree', async (t) => {
  const config = await fixture(t);
  await fs.writeFile(path.join(config.runsDir, 'queue.json'), '{bad');
  const snapshot = fakeSnapshot();
  snapshot.build = async () => ({
    main: { loaded: true, label: 'com.autofix', plist: '/tmp/com.autofix.plist' },
    notify: { loaded: true },
    versions: { source: '1.1.0', installed: '1.1.0', match: true },
    queue: { count: 0 },
    worktree: { exists: true, dirty: true, branch: 'fix/test', changedFiles: ['a.js'] }
  });
  const report = await runDoctor(config, {
    run: async () => ({ code: 0, stdout: '', stderr: '' }),
    snapshotService: snapshot,
    findCommand: async (name) => `/bin/${name}`
  });
  assert.equal(report.items.find((item) => item.id === 'queue').status, 'error');
  assert.equal(report.items.find((item) => item.id === 'worktree').status, 'warn');
});
