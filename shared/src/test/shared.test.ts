import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER_CONFIG,
  canJoinPool,
  decomposeTask,
  extractFiles,
  buildPrompt,
  PR_FOOTER,
  validateRegister,
  validateTask,
  isValidPrUrl,
  utcOffsetHours,
} from '../index.js';

test('tier config matches the spec', () => {
  assert.deepEqual(
    { ...TIER_CONFIG.free, label: undefined },
    { allowed: false, baseCredits: 0, priorityMultiplier: 0, label: undefined },
  );
  assert.equal(TIER_CONFIG.pro_20.baseCredits, 100);
  assert.equal(TIER_CONFIG.max_100.priorityMultiplier, 1.5);
  assert.equal(TIER_CONFIG.max_200.baseCredits, 1200);
  assert.equal(TIER_CONFIG.enterprise.priorityMultiplier, 2.5);
  assert.equal(canJoinPool('free'), false);
  assert.equal(canJoinPool('pro_20'), true);
});

test('validateRegister accepts good input and rejects bad', () => {
  const ok = validateRegister({ email: 'A@Example.com', handle: 'moshe', tier: 'max_100', timezone: 'Asia/Jerusalem' });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.email, 'a@example.com');
  const bad = validateRegister({ email: 'nope', handle: '!', tier: 'gold', timezone: 'Mars/Base' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.length, 4);
});

test('validateTask requires a GitHub repo', () => {
  assert.equal(validateTask({ title: 'Fix', description: 'Fix the thing please', repoUrl: 'https://gitlab.com/a/b' }).ok, false);
  const ok = validateTask({ title: 'Fix', description: 'Fix the thing please', repoUrl: 'https://github.com/a/b.git' });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.repoUrl, 'https://github.com/a/b');
});

test('PR url validation', () => {
  assert.ok(isValidPrUrl('https://github.com/a/b/pull/12'));
  assert.ok(!isValidPrUrl('https://evil.example/a/b/pull/12'));
});

test('extractFiles finds paths, ignores versions and domains', () => {
  assert.deepEqual(extractFiles('Edit `src/app.ts` and README.md, bump to 1.2.3, see codegedanken.dev'), [
    'README.md',
    'src/app.ts',
  ]);
});

test('decomposer: no list -> single subtask', () => {
  const d = decomposeTask('Add dark mode', 'Please add a dark mode toggle to the settings page.');
  assert.equal(d.length, 1);
  assert.equal(d[0]!.title, 'Add dark mode');
});

test('decomposer: list items become subtasks; shared files are merged', () => {
  const desc = [
    'Improve the landing page.',
    '- Add a hero section in src/Hero.tsx',
    '- Fix typo in README.md',
    '- Make the hero image lazy-load in src/Hero.tsx',
    '1. Add unit tests for utils in test/utils.test.ts',
  ].join('\n');
  const d = decomposeTask('Landing', desc);
  assert.equal(d.length, 3);
  const all = d.flatMap((s) => s.files);
  assert.equal(new Set(all).size, all.length, 'no file appears in two subtasks');
  const hero = d.find((s) => s.files.includes('src/Hero.tsx'))!;
  assert.match(hero.title, /\+1 related/);
  assert.ok(d.every((s) => s.body.startsWith('Improve the landing page.')));
});

test('decomposer caps at 8 subtasks', () => {
  const desc = Array.from({ length: 15 }, (_, i) => `- item number ${i}`).join('\n');
  assert.equal(decomposeTask('Many', desc).length, 8);
});

test('buildPrompt includes scope and the PR footer', () => {
  const p = buildPrompt({
    repoUrl: 'https://github.com/a/b',
    taskTitle: 'T',
    subtask: { title: 'S', body: 'do it', files: ['x.ts'], index: 0 },
    totalSubtasks: 2,
  });
  assert.match(p, /Subtask 1 of 2/);
  assert.match(p, /Only modify these files.*x\.ts/);
  assert.ok(p.endsWith(PR_FOOTER.trimStart()));
});

test('utcOffsetHours', () => {
  assert.equal(utcOffsetHours('UTC'), 0);
  assert.equal(utcOffsetHours('Asia/Tokyo'), 9);
});
