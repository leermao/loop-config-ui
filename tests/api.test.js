import assert from 'node:assert/strict';
import test from 'node:test';

import { logStreamUrl } from '../web/src/lib/api.js';

test('log stream omits offset when the client requests the current tail', () => {
  assert.equal(logStreamUrl({ name: 'log' }), '/api/logs/stream?name=log');
});

test('log stream includes a resumable offset and task id when provided', () => {
  assert.equal(
    logStreamUrl({ name: 'test.log', taskId: 'P-1', offset: 42 }),
    '/api/logs/stream?name=test.log&offset=42&taskId=P-1'
  );
});
