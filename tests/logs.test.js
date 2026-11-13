import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listLogSources,
  readLogChunk,
  readTail,
  resolveLogPath
} from '../server/logs.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autofix-console-logs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runsDir = path.join(root, 'runs');
  await fs.mkdir(runsDir, { recursive: true });
  return { root, runsDir };
}

test('readTail returns the last bytes and a resumable offset', async (t) => {
  const { runsDir } = await fixture(t);
  const file = path.join(runsDir, 'log');
  await fs.writeFile(file, '0123456789');

  const result = await readTail(file, { maxBytes: 4 });
  assert.equal(result.text, '6789');
  assert.equal(result.offset, 10);
  assert.equal(result.size, 10);
  assert.equal(result.exists, true);
});

test('readLogChunk returns appended text and detects truncation', async (t) => {
  const { runsDir } = await fixture(t);
  const file = path.join(runsDir, 'log');
  await fs.writeFile(file, 'one\n');

  const first = await readLogChunk(file, 0);
  assert.equal(first.text, 'one\n');
  assert.equal(first.offset, 4);

  await fs.appendFile(file, 'two\n');
  const second = await readLogChunk(file, first.offset);
  assert.equal(second.text, 'two\n');
  assert.equal(second.offset, 8);

  await fs.writeFile(file, 'new');
  const third = await readLogChunk(file, second.offset);
  assert.equal(third.text, 'new');
  assert.equal(third.truncated, true);
  assert.equal(third.offset, 3);
});

test('listLogSources reports existing and missing files', async (t) => {
  const { runsDir } = await fixture(t);
  await fs.writeFile(path.join(runsDir, 'log'), 'hello');
  const sources = await listLogSources({ runsDir });
  const log = sources.find((item) => item.id === 'log');
  const notify = sources.find((item) => item.id === 'notify');
  assert.equal(log.name, 'log');
  assert.equal(notify.name, 'notify');
  assert.equal(notify.file, 'notify.log');
  assert.match(log.description, /任务进度/);
  assert.match(sources.find((item) => item.id === 'launchd').description, /正常为空/);
  assert.equal(log.exists, true);
  assert.equal(log.size, 5);
  assert.equal(notify.exists, false);
});

test('resolveLogPath rejects unknown sources and traversal', async (t) => {
  const { runsDir } = await fixture(t);
  const config = { runsDir };
  assert.equal(resolveLogPath(config, { name: 'log' }), path.join(runsDir, 'log'));
  assert.equal(resolveLogPath(config, { name: 'launchd' }), path.join(runsDir, 'launchd.log'));
  assert.equal(resolveLogPath(config, { name: 'notify' }), path.join(runsDir, 'notify.log'));
  assert.throws(() => resolveLogPath(config, { name: 'secret' }), /不支持的日志来源/);
  assert.throws(() => resolveLogPath(config, { name: 'log', taskId: '../escape' }), /任务编号/);
  assert.throws(() => resolveLogPath(config, { name: '../passwd', taskId: 'P-1' }), /非法文件名/);
});
