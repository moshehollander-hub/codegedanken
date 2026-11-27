import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { CLAIM_TTL_MS, CREDITS_PER_SUBTASK, PR_FOOTER } from '@codegedanken/shared';

test('end-to-end: register → submit → heartbeat → pull → claim → complete → aggregate', async () => {
  let clock = Date.parse('2026-11-27T20:00:00Z');
  const app = await buildApp({ dbPath: ':memory:', now: () => clock });
  const call = async (method: 'GET' | 'POST', url: string, token?: string, body?: unknown) => {
    const res = await app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };

  try {
    // Pages render
    const home = await app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Co\(de\)Gedanken/);
    assert.equal((await app.inject({ method: 'GET', url: '/dashboard' })).statusCode, 200);

    // Free tier is blocked and waitlisted
    const free = await call('POST', '/api/users/register', undefined, {
      email: 'free@example.com', handle: 'freebie', tier: 'free', timezone: 'UTC',
    });
    assert.equal(free.status, 403);
    assert.equal(free.json.waitlisted, true);

    // Invalid input
    assert.equal((await call('POST', '/api/users/register', undefined, { email: 'x' })).status, 400);

    // Two paid users in different time zones
    const a = await call('POST', '/api/users/register', undefined, {
      email: 'owner@example.com', handle: 'owner', tier: 'max_100', timezone: 'Asia/Jerusalem',
    });
    assert.equal(a.status, 201);
    assert.equal(a.json.user.credits, 500);
    const tokenA: string = a.json.token;

    const b = await call('POST', '/api/users/register', undefined, {
      email: 'helper@example.com', handle: 'helper', tier: 'pro_20', timezone: 'America/Los_Angeles',
    });
    const tokenB: string = b.json.token;
    assert.equal(b.json.user.credits, 100);

    // Duplicate
    assert.equal((await call('POST', '/api/users/register', undefined, {
      email: 'owner@example.com', handle: 'owner2', tier: 'pro_20', timezone: 'UTC',
    })).status, 409);

    // Auth required
    assert.equal((await call('GET', '/api/me')).status, 401);
    assert.equal((await call('GET', '/api/me', tokenA)).json.user.handle, 'owner');

    // Submit a task that decomposes into 2 subtasks
    const desc = 'Polish the CLI.\n- Add --json flag in src/cli.ts\n- Document the flag in README.md';
    const preview = await call('POST', '/api/tasks/preview', undefined, { title: 'CLI polish', description: desc, repoUrl: 'https://github.com/owner/tool' });
    assert.equal(preview.json.subtasks.length, 2);
    const created = await call('POST', '/api/tasks', tokenA, { title: 'CLI polish', description: desc, repoUrl: 'https://github.com/owner/tool' });
    assert.equal(created.status, 201);
    assert.equal(created.json.task.subtasks.length, 2);
    const taskId: string = created.json.task.id;
    assert.equal((await call('GET', '/api/me', tokenA)).json.user.credits, 500 - 2 * CREDITS_PER_SUBTASK);

    // Owner never gets offered their own subtasks
    assert.equal((await call('GET', '/api/tasks/pull', tokenA)).status, 204);

    // Helper heartbeats and pulls an offer (not yet claimed)
    const hb = await call('POST', '/api/nodes/heartbeat', tokenB, { nodeId: 'node-helper-1', available: true, idleState: 'active', timezone: 'America/Los_Angeles' });
    assert.equal(hb.json.availableSubtasks, 2);
    const offer = await call('GET', '/api/tasks/pull', tokenB);
    assert.equal(offer.status, 200);
    assert.ok(offer.json.prompt.includes(PR_FOOTER.trimStart()));
    assert.equal(offer.json.subtask.status, 'queued');
    const subId: string = offer.json.subtask.id;

    // Owner cannot claim their own subtask
    assert.equal((await call('POST', `/api/subtasks/${subId}/claim`, tokenA)).status, 409);

    // Helper accepts after reading
    const claim = await call('POST', `/api/subtasks/${subId}/claim`, tokenB);
    assert.equal(claim.status, 200);
    assert.equal(claim.json.subtask.status, 'claimed');

    // Stats and nodes
    const stats = await call('GET', '/api/stats');
    assert.equal(stats.json.onlineNodes, 1);
    assert.equal(stats.json.queuedSubtasks, 1);
    assert.ok(stats.json.timezones.some((t: { offset: number }) => t.offset === -8));
    assert.equal((await call('GET', '/api/nodes', tokenA)).json.nodes[0].handle, 'helper');

    // Completion validates the PR url and repo
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://example.com/x' })).status, 400);
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/other/repo/pull/1' })).status, 400);
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenA, { prUrl: 'https://github.com/owner/tool/pull/7' })).status, 409);
    const done = await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/7' });
    assert.equal(done.status, 200);
    assert.equal(done.json.credits, 100 + CREDITS_PER_SUBTASK);

    // Second subtask: claim, let the claim expire, it returns to the queue
    const offer2 = await call('GET', '/api/tasks/pull', tokenB);
    const sub2: string = offer2.json.subtask.id;
    assert.equal((await call('POST', `/api/subtasks/${sub2}/claim`, tokenB)).status, 200);
    clock += CLAIM_TTL_MS + 1000;
    const again = await call('GET', '/api/tasks/pull', tokenB);
    assert.equal(again.json.subtask.id, sub2);
    assert.equal((await call('POST', `/api/subtasks/${sub2}/claim`, tokenB)).status, 200);
    assert.equal((await call('POST', `/api/tasks/${sub2}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/8' })).status, 200);

    // Owner sees the aggregated PRs and the task is completed
    const view = await call('GET', `/api/tasks/${taskId}`, tokenA);
    assert.equal(view.json.task.status, 'completed');
    assert.deepEqual(view.json.prs.map((p: { prUrl: string }) => p.prUrl).sort(), [
      'https://github.com/owner/tool/pull/7',
      'https://github.com/owner/tool/pull/8',
    ]);
    // Other users cannot see someone else's task
    assert.equal((await call('GET', `/api/tasks/${taskId}`, tokenB)).status, 404);
    assert.equal((await call('GET', '/api/prs')).json.prs.length, 2);

    // Not enough credits
    const big = Array.from({ length: 8 }, (_, i) => `- item ${i}`).join('\n');
    for (let i = 0; i < 2; i++) await call('POST', '/api/tasks', tokenB, { title: 'Big task', description: big, repoUrl: 'https://github.com/helper/x' });
    assert.equal((await call('POST', '/api/tasks', tokenB, { title: 'Big task', description: big, repoUrl: 'https://github.com/helper/x' })).status, 402);
  } finally {
    await app.close();
  }
});
