import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const presetSourceUrl = new URL('./natal-presets.js', import.meta.url);

test('Ali is the first public preset and uses no image asset', async () => {
  const source = await readFile(presetSourceUrl, 'utf8');
  const ids = [...source.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.equal(ids[0], 'ali');

  const aliBlock = source.match(/\{\s*id:\s*'ali'[\s\S]*?\n    \}/)?.[0] || '';
  assert.match(aliBlock, /image:\s*null/);
  assert.match(aliBlock, /publicCard:\s*true/);
  assert.match(aliBlock, /birthTime:\s*'15:30:30'/);
});
