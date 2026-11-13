import assert from 'node:assert/strict';
import test from 'node:test';

import { linkSegments } from '../web/src/lib/format.js';

test('linkSegments turns http links into link parts without HTML', () => {
  const parts = linkSegments('✅ P-1 已开 MR https://code.example.com/mr/12；云效已更新');

  assert.deepEqual(parts, [
    { type: 'text', value: '✅ P-1 已开 MR ' },
    { type: 'link', value: 'https://code.example.com/mr/12' },
    { type: 'text', value: '；云效已更新' }
  ]);
});

test('linkSegments trims punctuation but keeps balanced URL parentheses', () => {
  assert.deepEqual(linkSegments('见 https://example.com/a_(b) 和 https://example.com/c)。'), [
    { type: 'text', value: '见 ' },
    { type: 'link', value: 'https://example.com/a_(b)' },
    { type: 'text', value: ' 和 ' },
    { type: 'link', value: 'https://example.com/c' },
    { type: 'text', value: ')。' }
  ]);
});

test('linkSegments only accepts http and https', () => {
  assert.deepEqual(linkSegments('javascript:alert(1) file:///tmp/a'), [
    { type: 'text', value: 'javascript:alert(1) file:///tmp/a' }
  ]);
});
