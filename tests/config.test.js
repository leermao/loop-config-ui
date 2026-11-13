import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  expandHome,
  isSensitiveKey,
  loadConsoleConfig,
  parseDotenv,
  saveEnvUpdates
} from '../server/config.js';

async function tempHome(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-config-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'autofix', 'app'), { recursive: true });
  return home;
}

test('parseDotenv handles quotes, comments and HOME expansion', () => {
  const home = '/Users/example';
  const parsed = parseDotenv([
    '# comment',
    'A="hello world"  # 行尾注释',
    "B='literal # value'",
    'C=~/autofix/runs',
    'D=$HOME/01/hbp-editor',
    'DUP=first',
    'DUP=second'
  ].join('\n'), home);

  assert.equal(parsed.get('A'), 'hello world');
  assert.equal(parsed.get('B'), 'literal # value');
  assert.equal(parsed.get('C'), '/Users/example/autofix/runs');
  assert.equal(parsed.get('D'), '/Users/example/01/hbp-editor');
  assert.equal(parsed.get('DUP'), 'second');
});

test('loadConsoleConfig applies environment > env file > default', async (t) => {
  const home = await tempHome(t);
  await fs.writeFile(path.join(home, 'autofix', 'app', '.env'), [
    'AUTOFIX_HOME="$HOME/custom-runs"',
    'AUTOFIX_MAIN="/tmp/custom-main"',
    'YUNXIAO_TOKEN="secret-token"',
    'AUTOFIX_SYNC_START="8"'
  ].join('\n'));

  const config = loadConsoleConfig({
    home,
    env: {
      AUTOFIX_SYNC_START: '7',
      AUTOFIX_SKILL_DIR: '/tmp/skill'
    }
  });

  assert.equal(config.runsDir, path.join(home, 'custom-runs'));
  assert.equal(config.mainRepo, '/tmp/custom-main');
  assert.equal(config.skillDir, '/tmp/skill');
  assert.equal(config.values.get('AUTOFIX_SYNC_START'), '7');
  assert.equal(config.sources.get('AUTOFIX_SYNC_START'), 'environment');
  assert.equal(config.sources.get('AUTOFIX_HOME'), 'env');
  assert.equal(config.sources.get('AUTOFIX_SYNC_END'), 'default');

  const token = config.entries.find((entry) => entry.key === 'YUNXIAO_TOKEN');
  assert.equal(token.sensitive, true);
  assert.equal(token.value, null);
  assert.equal(token.display, '已配置');
});

test('loadConsoleConfig previews extra env keys and masks sensitive values', async (t) => {
  const home = await tempHome(t);
  await fs.writeFile(path.join(home, 'autofix', 'app', '.env'), [
    'FEATURE_PREVIEW="on"',
    'OPENAI_API_KEY="sk-very-secret"',
    'DATABASE_URL="postgres://user:pass@db.example/app"',
    'REQUEST_URL="https://example.com/path?token=secret"'
  ].join('\n'));

  const config = loadConsoleConfig({ home, env: {} });
  const entries = new Map(config.entries.map((entry) => [entry.key, entry]));

  assert.equal(entries.get('FEATURE_PREVIEW').group, '其他 .env');
  assert.equal(entries.get('FEATURE_PREVIEW').value, 'on');
  assert.equal(entries.get('FEATURE_PREVIEW').editable, false);
  assert.equal(entries.get('FEATURE_PREVIEW').displayOnly, true);

  for (const key of ['OPENAI_API_KEY', 'DATABASE_URL', 'REQUEST_URL']) {
    assert.equal(entries.get(key).sensitive, true);
    assert.equal(entries.get(key).value, null);
  }
  assert.doesNotMatch(JSON.stringify(config.entries), /sk-very-secret|user:pass|token=secret/);
});

test('saveEnvUpdates keeps comments and creates a backup', async (t) => {
  const home = await tempHome(t);
  const envFile = path.join(home, 'autofix', 'app', '.env');
  await fs.writeFile(envFile, [
    '# 保留这行注释',
    'AUTOFIX_SYNC_START="9"   # 原注释',
    'GITLAB_TOKEN="old"'
  ].join('\n'));

  const config = loadConsoleConfig({ home, env: {} });
  const result = await saveEnvUpdates(config, {
    AUTOFIX_SYNC_START: '10',
    GITLAB_TOKEN: 'new-token',
    AUTOFIX_SYNC_END: '22'
  }, new Date('2026-11-13T06:00:00.000Z'));

  const saved = await fs.readFile(envFile, 'utf8');
  assert.match(saved, /# 保留这行注释/);
  assert.match(saved, /AUTOFIX_SYNC_START=10/);
  assert.match(saved, /GITLAB_TOKEN=new-token/);
  assert.match(saved, /AUTOFIX_SYNC_END=22/);
  assert.ok(result.backupPath);
  assert.equal(await fs.readFile(result.backupPath, 'utf8'), [
    '# 保留这行注释',
    'AUTOFIX_SYNC_START="9"   # 原注释',
    'GITLAB_TOKEN="old"'
  ].join('\n'));
});

test('saveEnvUpdates rejects environment-sourced keys', async (t) => {
  const home = await tempHome(t);
  const config = loadConsoleConfig({
    home,
    env: { AUTOFIX_SYNC_START: '7' }
  });

  await assert.rejects(
    saveEnvUpdates(config, { AUTOFIX_SYNC_START: '8' }),
    /由环境变量覆盖/
  );
});

test('expandHome only expands leading tilde', () => {
  assert.equal(expandHome('~/a', '/tmp/home'), '/tmp/home/a');
  assert.equal(expandHome('/a/~/b', '/tmp/home'), '/a/~/b');
});

test('isSensitiveKey covers common credential names and URLs', () => {
  assert.equal(isSensitiveKey('OPENAI_API_KEY'), true);
  assert.equal(isSensitiveKey('SERVICE_PASSWORD'), true);
  assert.equal(isSensitiveKey('DATABASE_URL'), true);
  assert.equal(isSensitiveKey('REQUEST_URL', 'https://example.com/path?token=secret'), true);
  assert.equal(isSensitiveKey('PUBLIC_HOST'), false);
});
