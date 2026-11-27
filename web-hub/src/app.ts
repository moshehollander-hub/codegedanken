import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLAIM_TTL_MS,
  CREDITS_PER_SUBTASK,
  NODE_ONLINE_MS,
  TIER_CONFIG,
  buildPrompt,
  decomposeTask,
  isSubscriptionTier,
  isValidPrUrl,
  isValidTimezone,
  utcOffsetHours,
  validateRegister,
  validateTask,
  type SubTask,
  type SubscriptionTier,
  type Task,
  type User,
} from '@codegedanken/shared';
import { openDb, type DB } from './db.js';

export interface AppOptions {
  dbPath?: string;
  logger?: boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}

type Row = Record<string, unknown>;

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_ACTIVE_CLAIMS = 2;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function toUser(r: Row): User {
  return {
    id: String(r.id),
    handle: String(r.handle),
    email: String(r.email),
    tier: r.tier as SubscriptionTier,
    credits: Number(r.credits),
    completedCount: Number(r.completed_count),
    timezone: String(r.timezone),
    createdAt: String(r.created_at),
  };
}

function toSubTask(r: Row): SubTask {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    index: Number(r.idx),
    title: String(r.title),
    body: String(r.body),
    files: JSON.parse(String(r.files)) as string[],
    status: r.status as SubTask['status'],
    claimedBy: (r.claimed_by as string | null) ?? null,
    claimedAt: (r.claimed_at as string | null) ?? null,
    prUrl: (r.pr_url as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance & { db: DB }> {
  const db = openDb(opts.dbPath ?? 'codegedanken.db');
  const now = opts.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 256 * 1024 }) as unknown as FastifyInstance & { db: DB };
  app.decorate('db', db);
  app.addHook('onClose', async () => db.close());

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const fail = (reply: FastifyReply, code: number, error: string, extra: Row = {}) =>
    reply.code(code).send({ error, ...extra });

  function authUser(req: FastifyRequest): User | null {
    const h = req.headers.authorization ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m?.[1]) return null;
    const row = db.prepare('SELECT * FROM users WHERE token_hash = ?').get(sha256(m[1])) as Row | undefined;
    return row ? toUser(row) : null;
  }

  function requireUser(req: FastifyRequest, reply: FastifyReply): User | null {
    const u = authUser(req);
    if (!u) {
      void fail(reply, 401, 'Missing or invalid API token.');
      return null;
    }
    return u;
  }

  function loadTask(id: string): Task | null {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    if (!t) return null;
    const subs = (db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY idx').all(id) as Row[]).map(toSubTask);
    return {
      id: String(t.id),
      ownerId: String(t.owner_id),
      title: String(t.title),
      description: String(t.description),
      repoUrl: String(t.repo_url),
      status: t.status as Task['status'],
      createdAt: String(t.created_at),
      subtasks: subs,
    };
  }

  function releaseExpiredClaims() {
    const cutoff = new Date(now() - CLAIM_TTL_MS).toISOString();
    db.prepare(
      "UPDATE subtasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL WHERE status = 'claimed' AND claimed_at < ?",
    ).run(cutoff);
  }

  function offerFor(subRow: Row) {
    const sub = toSubTask(subRow);
    const task = loadTask(sub.taskId)!;
    const owner = db.prepare('SELECT handle, tier FROM users WHERE id = ?').get(task.ownerId) as Row;
    return {
      subtask: sub,
      task: { id: task.id, title: task.title, repoUrl: task.repoUrl, ownerHandle: String(owner.handle), ownerTier: owner.tier },
      prompt: buildPrompt({ repoUrl: task.repoUrl, taskTitle: task.title, subtask: sub, totalSubtasks: task.subtasks.length }),
      creditsOnCompletion: CREDITS_PER_SUBTASK,
    };
  }

  // -------------------------------------------------------------------------
  // Pages
  // -------------------------------------------------------------------------
  const page = (file: string) => {
    let cached: string | null = null;
    return async (_req: FastifyRequest, reply: FastifyReply) => {
      cached ??= readFileSync(PUBLIC_DIR + file, 'utf8');
      return reply.type('text/html; charset=utf-8').send(cached);
    };
  };
  app.get('/', page('index.html'));
  app.get('/dashboard', page('dashboard.html'));
  app.get('/privacy', page('privacy.html'));
  app.get('/healthz', async () => ({ ok: true }));

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  app.post('/api/users/register', async (req, reply) => {
    const v = validateRegister(req.body);
    if (!v.ok) return fail(reply, 400, 'Invalid registration.', { details: v.errors });
    const { email, handle, tier, timezone } = v.value;
    const cfg = TIER_CONFIG[tier];
    if (!cfg.allowed) {
      db.prepare('INSERT INTO waitlist (id, email, handle, tier, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(), email, handle, tier, 'free tier cannot join the exchange', iso(),
      );
      return fail(reply, 403, 'The exchange is open to paid Claude plans only. You have been added to the waitlist.', {
        waitlisted: true,
      });
    }
    const exists = db.prepare('SELECT 1 FROM users WHERE email = ? OR handle = ?').get(email, handle);
    if (exists) return fail(reply, 409, 'That email or handle is already registered.');
    const token = 'cg_' + randomBytes(24).toString('base64url');
    const id = randomUUID();
    db.prepare(
      'INSERT INTO users (id, email, handle, tier, token_hash, credits, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, email, handle, tier, sha256(token), cfg.baseCredits, timezone, iso());
    const user = toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row);
    return reply.code(201).send({ user, token, note: 'Store this token now — it is shown only once.' });
  });

  app.get('/api/me', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return { user: u, tierConfig: TIER_CONFIG[u.tier] };
  });

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  app.post('/api/tasks/preview', async (req, reply) => {
    const v = validateTask(req.body);
    if (!v.ok) return fail(reply, 400, 'Invalid task.', { details: v.errors });
    const drafts = decomposeTask(v.value.title, v.value.description);
    return { subtasks: drafts, cost: drafts.length * CREDITS_PER_SUBTASK };
  });

  app.post('/api/tasks', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const v = validateTask(req.body);
    if (!v.ok) return fail(reply, 400, 'Invalid task.', { details: v.errors });
    const drafts = decomposeTask(v.value.title, v.value.description);
    const cost = drafts.length * CREDITS_PER_SUBTASK;
    if (u.credits < cost) return fail(reply, 402, `Not enough credits: this task needs ${cost}, you have ${u.credits}.`);
    const taskId = randomUUID();
    tx(() => {
      db.prepare('INSERT INTO tasks (id, owner_id, title, description, repo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        taskId, u.id, v.value.title, v.value.description, v.value.repoUrl, iso(),
      );
      const ins = db.prepare('INSERT INTO subtasks (id, task_id, idx, title, body, files) VALUES (?, ?, ?, ?, ?, ?)');
      drafts.forEach((d, i) => ins.run(randomUUID(), taskId, i, d.title, d.body, JSON.stringify(d.files)));
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(cost, u.id);
    });
    return reply.code(201).send({ task: loadTask(taskId), cost });
  });

  app.get('/api/tasks', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const ids = db.prepare('SELECT id FROM tasks WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100').all(u.id) as Row[];
    return { tasks: ids.map((r) => loadTask(String(r.id))) };
  });

  // Bridge: offer the next subtask for this person to review. Does NOT claim it.
  app.get('/api/tasks/pull', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    releaseExpiredClaims();
    const tierCase = `CASE u.tier ${Object.entries(TIER_CONFIG)
      .map(([k, c]) => `WHEN '${k}' THEN ${c.priorityMultiplier}`)
      .join(' ')} ELSE 0 END`;
    const row = db
      .prepare(
        `SELECT s.* FROM subtasks s
         JOIN tasks t ON t.id = s.task_id
         JOIN users u ON u.id = t.owner_id
         WHERE s.status = 'queued' AND t.owner_id != ?
         ORDER BY ${tierCase} DESC, t.created_at ASC, s.idx ASC
         LIMIT 1`,
      )
      .get(u.id) as Row | undefined;
    if (!row) return reply.code(204).send();
    return offerFor(row);
  });

  app.get('/api/tasks/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const task = loadTask((req.params as { id: string }).id);
    if (!task || task.ownerId !== u.id) return fail(reply, 404, 'Task not found.');
    return { task, prs: task.subtasks.filter((s) => s.prUrl).map((s) => ({ subtask: s.title, prUrl: s.prUrl })) };
  });

  // Human pressed "Accept" in the extension after reading the subtask.
  app.post('/api/subtasks/:id/claim', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    releaseExpiredClaims();
    const id = (req.params as { id: string }).id;
    const active = db.prepare("SELECT COUNT(*) AS n FROM subtasks WHERE claimed_by = ? AND status = 'claimed'").get(u.id) as Row;
    if (Number(active.n) >= MAX_ACTIVE_CLAIMS) return fail(reply, 409, `You already have ${MAX_ACTIVE_CLAIMS} subtasks in progress.`);
    const res = db
      .prepare(
        `UPDATE subtasks SET status = 'claimed', claimed_by = ?, claimed_at = ?
         WHERE id = ? AND status = 'queued'
           AND task_id NOT IN (SELECT id FROM tasks WHERE owner_id = ?)`,
      )
      .run(u.id, iso(), id, u.id);
    if (res.changes !== 1) return fail(reply, 409, 'This subtask is no longer available.');
    return offerFor(db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Row);
  });

  app.post('/api/subtasks/:id/release', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const id = (req.params as { id: string }).id;
    const res = db
      .prepare("UPDATE subtasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ? AND status = 'claimed'")
      .run(id, u.id);
    if (res.changes !== 1) return fail(reply, 409, 'You do not hold this subtask.');
    return { ok: true };
  });

  app.post('/api/tasks/:subtaskId/complete', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const id = (req.params as { subtaskId: string }).subtaskId;
    const prUrl = String((req.body as Row | undefined)?.prUrl ?? '').trim().replace(/\/$/, '');
    if (!isValidPrUrl(prUrl)) return fail(reply, 400, 'prUrl must be a GitHub pull request URL.');
    const sub = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as Row | undefined;
    if (!sub || sub.claimed_by !== u.id || sub.status !== 'claimed') return fail(reply, 409, 'You do not hold this subtask.');
    const task = loadTask(String(sub.task_id))!;
    if (!prUrl.toLowerCase().startsWith(task.repoUrl.toLowerCase() + '/pull/'))
      return fail(reply, 400, `The pull request must be opened against ${task.repoUrl}.`);
    tx(() => {
      db.prepare("UPDATE subtasks SET status = 'completed', pr_url = ?, completed_at = ? WHERE id = ?").run(prUrl, iso(), id);
      db.prepare('UPDATE users SET credits = credits + ?, completed_count = completed_count + 1 WHERE id = ?').run(
        CREDITS_PER_SUBTASK, u.id,
      );
      const left = db.prepare("SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ? AND status != 'completed'").get(task.id) as Row;
      if (Number(left.n) === 0) db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(task.id);
    });
    const me = toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as Row);
    return { ok: true, credits: me.credits, task: loadTask(task.id) };
  });

  // -------------------------------------------------------------------------
  // Nodes
  // -------------------------------------------------------------------------
  app.post('/api/nodes/heartbeat', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const b = (req.body ?? {}) as Row;
    const nodeId = String(b.nodeId ?? '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(nodeId)) return fail(reply, 400, 'nodeId must be 8-64 url-safe characters.');
    const idle = ['active', 'idle', 'locked'].includes(String(b.idleState)) ? String(b.idleState) : 'active';
    const tz = isValidTimezone(String(b.timezone ?? '')) ? String(b.timezone) : u.timezone;
    const owner = db.prepare('SELECT user_id FROM nodes WHERE node_id = ?').get(nodeId) as Row | undefined;
    if (owner && owner.user_id !== u.id) return fail(reply, 409, 'nodeId belongs to another user.');
    db.prepare(
      `INSERT INTO nodes (node_id, user_id, available, idle_state, timezone, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(node_id) DO UPDATE SET available = excluded.available, idle_state = excluded.idle_state,
         timezone = excluded.timezone, last_seen = excluded.last_seen`,
    ).run(nodeId, u.id, b.available ? 1 : 0, idle, tz, iso());
    const queued = db
      .prepare("SELECT COUNT(*) AS n FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.status = 'queued' AND t.owner_id != ?")
      .get(u.id) as Row;
    return { ok: true, availableSubtasks: Number(queued.n), user: u };
  });

  app.get('/api/nodes', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const since = new Date(now() - NODE_ONLINE_MS).toISOString();
    const rows = db
      .prepare(
        `SELECT n.*, u.handle, u.tier FROM nodes n JOIN users u ON u.id = n.user_id
         WHERE n.last_seen >= ? ORDER BY n.last_seen DESC LIMIT 200`,
      )
      .all(since) as Row[];
    return {
      nodes: rows.map((r) => ({
        nodeId: String(r.node_id).slice(0, 6) + '…',
        handle: r.handle,
        tier: isSubscriptionTier(r.tier) ? r.tier : 'free',
        timezone: r.timezone,
        available: Boolean(r.available),
        idleState: r.idle_state,
        lastSeen: r.last_seen,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Public stats
  // -------------------------------------------------------------------------
  app.get('/api/stats', async () => {
    const since = new Date(now() - NODE_ONLINE_MS).toISOString();
    const nodes = db.prepare('SELECT timezone, available FROM nodes WHERE last_seen >= ?').all(since) as Row[];
    const queuedByTz = db
      .prepare("SELECT u.timezone AS tz, COUNT(*) AS n FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN users u ON u.id = t.owner_id WHERE s.status = 'queued' GROUP BY u.timezone")
      .all() as Row[];
    const at = new Date(now());
    const buckets = new Map<number, { offset: number; online: number; available: number; queued: number }>();
    const bucket = (tz: string) => {
      const off = utcOffsetHours(tz, at);
      if (!buckets.has(off)) buckets.set(off, { offset: off, online: 0, available: 0, queued: 0 });
      return buckets.get(off)!;
    };
    for (const n of nodes) {
      const b = bucket(String(n.timezone));
      b.online++;
      if (n.available) b.available++;
    }
    for (const q of queuedByTz) bucket(String(q.tz)).queued += Number(q.n);
    const count = (sql: string) => Number((db.prepare(sql).get() as Row).n);
    return {
      users: count('SELECT COUNT(*) AS n FROM users'),
      onlineNodes: nodes.length,
      availableNodes: nodes.filter((n) => n.available).length,
      queuedSubtasks: count("SELECT COUNT(*) AS n FROM subtasks WHERE status = 'queued'"),
      completedSubtasks: count("SELECT COUNT(*) AS n FROM subtasks WHERE status = 'completed'"),
      timezones: [...buckets.values()].sort((a, b) => a.offset - b.offset),
    };
  });

  // Completed PRs aggregator (public: all repos involved are public).
  app.get('/api/prs', async () => {
    const rows = db
      .prepare(
        `SELECT s.title AS subtask, s.pr_url, s.completed_at, t.title AS task, t.repo_url, u.handle AS executor
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN users u ON u.id = s.claimed_by
         WHERE s.status = 'completed' ORDER BY s.completed_at DESC LIMIT 50`,
      )
      .all() as Row[];
    return { prs: rows };
  });

  return app;
}
