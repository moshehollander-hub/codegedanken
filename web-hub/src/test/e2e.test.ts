import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp, type PullRequestInfo } from '../app.js';
import { CLAIM_TTL_MS, CREDITS_PER_SUBTASK, PR_FOOTER, REGISTRATIONS_PER_IP_PER_HOUR } from '@codegedanken/shared';

/** Fake GitHub: PRs keyed by "owner/repo#n". A key mapped to 'down' simulates GitHub being unreachable. */
function fakeGithub(prs: Record<string, PullRequestInfo | 'down'>) {
  return async (owner: string, repo: string, n: number) => {
    const pr = prs[`${owner}/${repo}#${n}`];
    if (pr === 'down') throw new Error('unreachable');
    return pr ?? null;
  };
}

const LATER = '2026-11-28T03:00:00Z';
const withFooter = (createdAt = LATER): PullRequestInfo => ({ createdAt, body: 'Adds the flag.' + PR_FOOTER });

test('end-to-end: register → submit → heartbeat → pull → claim → complete → aggregate', async () => {
  let clock = Date.parse('2026-11-27T20:00:00Z');
  const app = await buildApp({
    dbPath: ':memory:',
    registrationOpen: true,
    now: () => clock,
    fetchPr: fakeGithub({
      'owner/tool#7': withFooter(),
      'owner/tool#8': withFooter('2026-11-28T09:00:00Z'),
      'owner/tool#1': withFooter('2026-11-01T00:00:00Z'), // opened before the claim
      'owner/tool#2': { createdAt: LATER, body: 'no footer here' },
      'owner/tool#3': 'down',
    }),
  });
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
    // ...and checks the PR with GitHub: it must exist, be newer than the claim, carry the footer
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/99' })).status, 400);
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/1' })).status, 400);
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/2' })).status, 400);
    assert.equal((await call('POST', `/api/tasks/${subId}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/3' })).status, 503);
    assert.equal((await call('GET', '/api/me', tokenB)).json.user.credits, 100, 'no credits for rejected PRs');
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
    // The same PR can't be reported twice
    assert.equal((await call('POST', `/api/tasks/${sub2}/complete`, tokenB, { prUrl: 'https://github.com/owner/tool/pull/7' })).status, 409);
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

test('cancel refunds unstarted subtasks, and later ones whose claim is given back', async () => {
  const clock = Date.parse('2026-11-27T20:00:00Z');
  const app = await buildApp({ dbPath: ':memory:', registrationOpen: true, now: () => clock, fetchPr: fakeGithub({}) });
  const call = async (method: 'GET' | 'POST', url: string, token?: string, body?: unknown) => {
    const res = await app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: res.statusCode, json: res.body ? res.json() : null };
  };
  try {
    const a = (await call('POST', '/api/users/register', undefined, { email: 'a@example.com', handle: 'aaa', tier: 'pro_20', timezone: 'UTC' })).json.token;
    const b = (await call('POST', '/api/users/register', undefined, { email: 'b@example.com', handle: 'bbb', tier: 'pro_20', timezone: 'UTC' })).json.token;
    const desc = 'Three things.\n- one in a.ts\n- two in b.ts\n- three in c.ts';
    const task = (await call('POST', '/api/tasks', a, { title: 'Three', description: desc, repoUrl: 'https://github.com/aaa/r' })).json.task;
    assert.equal((await call('GET', '/api/me', a)).json.user.credits, 70);

    // Helper starts one subtask, then the owner cancels: the two unstarted ones are refunded
    const offer = (await call('GET', '/api/tasks/pull', b)).json;
    assert.equal((await call('POST', `/api/subtasks/${offer.subtask.id}/claim`, b)).status, 200);
    assert.equal((await call('POST', `/api/tasks/${task.id}/cancel`, b)).status, 404, 'only the owner can cancel');
    const c = await call('POST', `/api/tasks/${task.id}/cancel`, a);
    assert.equal(c.status, 200);
    assert.equal(c.json.refunded, 20);
    assert.equal(c.json.credits, 90);
    assert.equal(c.json.task.status, 'cancelled');
    assert.equal((await call('POST', `/api/tasks/${task.id}/cancel`, a)).status, 409);
    assert.equal((await call('GET', '/api/tasks/pull', b)).status, 204, 'nothing left in the queue');

    // The helper gives the started one back: it is cancelled and refunded too
    assert.equal((await call('POST', `/api/subtasks/${offer.subtask.id}/release`, b)).status, 200);
    assert.equal((await call('GET', '/api/me', a)).json.user.credits, 100);
    assert.equal((await call('GET', '/api/tasks/pull', b)).status, 204);
  } finally {
    await app.close();
  }
});

test('sign-ups are rate limited per IP and accounts can be deleted by their owner', async () => {
  const app = await buildApp({ dbPath: ':memory:', registrationOpen: true, fetchPr: fakeGithub({}) });
  const register = (i: number, ip = '203.0.113.5') =>
    app.inject({
      method: 'POST',
      url: '/api/users/register',
      remoteAddress: ip,
      payload: { email: `u${i}@example.com`, handle: `user${i}`, tier: i % 2 ? 'free' : 'pro_20', timezone: 'UTC' },
    });
  try {
    for (let i = 0; i < REGISTRATIONS_PER_IP_PER_HOUR; i++) assert.notEqual((await register(i)).statusCode, 429);
    assert.equal((await register(999)).statusCode, 429);
    assert.equal((await register(1000, '198.51.100.7')).statusCode, 201, 'other addresses are unaffected');

    // Waitlist entries are not duplicated
    await register(2001, '198.51.100.8');
    await register(2001, '198.51.100.9');
    assert.equal(Number((app.db.prepare("SELECT COUNT(*) AS n FROM waitlist WHERE email = 'u2001@example.com'").get() as { n: number }).n), 1);

    // Delete my account: token stops working, personal data is gone
    const res = await register(3000, '198.51.100.10');
    const token = res.json().token as string;
    const auth = { authorization: `Bearer ${token}` };
    assert.equal((await app.inject({ method: 'POST', url: '/api/me/delete', headers: auth })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).statusCode, 401);
    assert.equal(app.db.prepare("SELECT 1 FROM users WHERE email = 'u3000@example.com' OR handle = 'user3000'").get(), undefined);
  } finally {
    await app.close();
  }
});

test('registration is closed by default and says it is coming soon', async () => {
  delete process.env.REGISTRATION_OPEN;
  const app = await buildApp({ dbPath: ':memory:' });
  try {
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/config' })).json(), { registrationOpen: false });
    const res = await app.inject({
      method: 'POST', url: '/api/users/register',
      payload: { email: 'x@example.com', handle: 'xx', tier: 'pro_20', timezone: 'UTC' },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().comingSoon, true);
    assert.match((await app.inject({ method: 'GET', url: '/' })).body, /Registration opens soon/);
  } finally {
    await app.close();
  }
});
