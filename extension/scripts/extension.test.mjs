import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');

test('manifest is MV3 with the expected permissions', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'idle', 'storage']);
  assert.ok(m.content_scripts[0].matches.includes('https://claude.ai/*'));
});

test('content script never submits on the user’s behalf', () => {
  const src = read('content.js');
  assert.doesNotMatch(src, /\.click\(\)/, 'must not click any button');
  assert.doesNotMatch(src, /requestSubmit|\.submit\(\)/, 'must not submit forms');
  assert.doesNotMatch(src, /key:\s*['"]Enter['"]/, 'must not synthesize Enter');
});

test('background only pastes after an explicit accept', () => {
  const src = read('background.js');
  const calls = [...src.matchAll(/openClaudeWithPrompt\(/g)].length;
  // one definition + accept + repaste
  assert.equal(calls, 3);
  assert.match(src, /case 'accept'/);
});
