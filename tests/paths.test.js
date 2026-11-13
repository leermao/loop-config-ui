import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIdentifier,
  isWithin,
  safeBasename,
  safeJoin
} from '../server/paths.js';

test('safeJoin stays inside a root', () => {
  assert.equal(safeJoin('/tmp/root', 'a', 'b'), '/tmp/root/a/b');
  assert.throws(() => safeJoin('/tmp/root', '..', 'outside'), /超出允许目录/);
  assert.throws(() => safeJoin('/tmp/root', '/etc/passwd'), /超出允许目录/);
});

test('isWithin handles sibling prefixes safely', () => {
  assert.equal(isWithin('/tmp/root', '/tmp/root/a'), true);
  assert.equal(isWithin('/tmp/root', '/tmp/root-other/a'), false);
});

test('safeBasename rejects traversal and separators', () => {
  assert.equal(safeBasename('design.md'), 'design.md');
  assert.throws(() => safeBasename('../secret'), /非法文件名/);
  assert.throws(() => safeBasename('a/b'), /非法文件名/);
});

test('assertIdentifier only allows task-safe characters', () => {
  assert.equal(assertIdentifier('PZEP-301'), 'PZEP-301');
  assert.throws(() => assertIdentifier('PZEP-301;rm -rf /'), /只能包含/);
});
