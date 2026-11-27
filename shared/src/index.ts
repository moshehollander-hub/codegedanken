/**
 * @codegedanken/shared — types, tier config, validation, the Gedanken task
 * decomposer and the prompt builder used by both the web hub and the extension.
 *
 * Ground rules (see CLAUDE.md):
 *  - Every subtask is executed by a human, in their own Claude account, after they
 *    read it and press Send themselves. Nothing here automates claude.ai.
 *  - Credits are an in-app time bank. They are never bought, sold or paid out.
 *  - Tiers are self-declared and only weight credits/priority.
 */

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export const SUBSCRIPTION_TIERS = ['free', 'pro_20', 'max_100', 'max_200', 'enterprise'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export interface TierConfig {
  allowed: boolean;
  baseCredits: number;
  priorityMultiplier: number;
  label: string;
}

export const TIER_CONFIG: Readonly<Record<SubscriptionTier, Readonly<TierConfig>>> = Object.freeze({
  free: { allowed: false, baseCredits: 0, priorityMultiplier: 0, label: 'Free' },
  pro_20: { allowed: true, baseCredits: 100, priorityMultiplier: 1.0, label: 'Pro ($20/mo)' },
  max_100: { allowed: true, baseCredits: 500, priorityMultiplier: 1.5, label: 'Max ($100/mo)' },
  max_200: { allowed: true, baseCredits: 1200, priorityMultiplier: 2.0, label: 'Max ($200/mo)' },
  enterprise: { allowed: true, baseCredits: 2500, priorityMultiplier: 2.5, label: 'Enterprise' },
});

/** Credits charged per subtask submitted, and earned per subtask completed for someone else. */
export const CREDITS_PER_SUBTASK = 10;

/** A claimed subtask returns to the queue if not completed within this window. */
export const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

/** A node counts as "online" if it sent a heartbeat within this window. */
export const NODE_ONLINE_MS = 5 * 60 * 1000;

export function isSubscriptionTier(v: unknown): v is SubscriptionTier {
  return typeof v === 'string' && (SUBSCRIPTION_TIERS as readonly string[]).includes(v);
}

export function canJoinPool(tier: SubscriptionTier): boolean {
  return TIER_CONFIG[tier].allowed;
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TaskStatus = 'open' | 'completed';
export type SubTaskStatus = 'queued' | 'claimed' | 'completed';

export interface User {
  id: string;
  handle: string;
  email: string;
  tier: SubscriptionTier;
  credits: number;
  completedCount: number;
  timezone: string;
  createdAt: string;
}

export interface SubTask {
  id: string;
  taskId: string;
  index: number;
  title: string;
  body: string;
  files: string[];
  status: SubTaskStatus;
  claimedBy: string | null;
  claimedAt: string | null;
  prUrl: string | null;
  completedAt: string | null;
}

export interface Task {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  repoUrl: string;
  status: TaskStatus;
  createdAt: string;
  subtasks: SubTask[];
}

export interface BrowserNode {
  nodeId: string;
  userId: string;
  handle: string;
  tier: SubscriptionTier;
  timezone: string;
  /** Whether the person has toggled "available for tasks" in the extension. */
  available: boolean;
  /** chrome.idle state reported by the extension — display only, never triggers execution. */
  idleState: 'active' | 'idle' | 'locked';
  lastSeen: string;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  handle: string;
  tier: SubscriptionTier;
  reason: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface RegisterInput {
  email: string;
  handle: string;
  tier: SubscriptionTier;
  timezone: string;
}

export interface TaskInput {
  title: string;
  description: string;
  repoUrl: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[a-zA-Z0-9_-]{2,32}$/;
const GITHUB_REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateRegister(input: unknown): ValidationResult<RegisterInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const email = str(o.email).toLowerCase();
  const handle = str(o.handle);
  const tier = o.tier;
  const timezone = str(o.timezone) || 'UTC';
  if (!EMAIL_RE.test(email)) errors.push('A valid email is required.');
  if (!HANDLE_RE.test(handle)) errors.push('Handle must be 2-32 characters: letters, digits, _ or -.');
  if (!isSubscriptionTier(tier)) errors.push(`Tier must be one of: ${SUBSCRIPTION_TIERS.join(', ')}.`);
  if (!isValidTimezone(timezone)) errors.push('Unknown IANA timezone.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { email, handle, tier: tier as SubscriptionTier, timezone } };
}

export function validateTask(input: unknown): ValidationResult<TaskInput> {
  const o = (input ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const title = str(o.title);
  const description = str(o.description);
  const repoUrl = str(o.repoUrl).replace(/\.git$/, '');
  if (title.length < 3 || title.length > 140) errors.push('Title must be 3-140 characters.');
  if (description.length < 10 || description.length > 20000) errors.push('Description must be 10-20000 characters.');
  if (!GITHUB_REPO_RE.test(repoUrl)) errors.push('repoUrl must be a public GitHub repository URL (https://github.com/owner/repo).');
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { title, description, repoUrl: repoUrl.replace(/\/$/, '') } };
}

export function isValidPrUrl(url: unknown): url is string {
  return typeof url === 'string' && PR_URL_RE.test(url.trim());
}

// ---------------------------------------------------------------------------
// Gedanken Task Decomposer
// ---------------------------------------------------------------------------

export interface DraftSubTask {
  title: string;
  body: string;
  files: string[];
}

const MAX_SUBTASKS = 8;
const LIST_ITEM_RE = /^\s*(?:[-*+•]|\d+[.)])\s+(.+)$/;
// Paths like src/app.ts, web-hub/public/index.html, README.md, ./lib/x.js
const FILE_RE = /(?:^|[\s`'"(\[])((?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w-]+(?:\.[\w-]+)*\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),.:;\]])/g;

export function extractFiles(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FILE_RE)) {
    const f = (m[1] ?? '').replace(/^\.\//, '');
    // skip things that look like versions or domains
    if (/^\d+(\.\d+)+$/.test(f)) continue;
    if (/\.(com|dev|org|net|io|ai)$/i.test(f) && !f.includes('/')) continue;
    out.add(f);
  }
  return [...out].sort();
}

/**
 * Splits a task description into subtasks that can be worked on in parallel
 * without touching the same files.
 *
 *  1. Each top-level list item (bullet or numbered) becomes a candidate.
 *  2. Candidates that mention a common file are merged (union-find), so no two
 *     resulting subtasks claim the same file.
 *  3. Candidates that mention no files stay separate; the prompt tells the
 *     executor to keep its change narrow.
 *  4. If there is no list, the whole description is one subtask.
 */
export function decomposeTask(title: string, description: string): DraftSubTask[] {
  const items: string[] = [];
  let current: string[] | null = null;
  const preamble: string[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = LIST_ITEM_RE.exec(line);
    const indented = /^\s{2,}/.test(line);
    if (m && !indented) {
      if (current) items.push(current.join('\n').trim());
      current = [m[1] ?? ''];
    } else if (current) {
      if (line.trim() === '' && current.length && current[current.length - 1] === '') continue;
      current.push(line.trim());
    } else {
      preamble.push(line);
    }
  }
  if (current) items.push(current.join('\n').trim());

  const context = preamble.join('\n').trim();
  if (items.length < 2) {
    return [{ title, body: description.trim(), files: extractFiles(description) }];
  }

  // union-find over items by shared files
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const fileOwner = new Map<string, number>();
  const itemFiles = items.map(extractFiles);
  itemFiles.forEach((files, i) => {
    for (const f of files) {
      const owner = fileOwner.get(f);
      if (owner === undefined) fileOwner.set(f, i);
      else parent[find(i)] = find(owner);
    }
  });

  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });

  let drafts: DraftSubTask[] = [...groups.values()].map((idxs) => {
    const texts = idxs.map((i) => items[i]!);
    const files = [...new Set(idxs.flatMap((i) => itemFiles[i]!))].sort();
    const head = (texts[0] ?? '').split('\n')[0] ?? '';
    const subTitle = head.length > 80 ? head.slice(0, 77) + '...' : head;
    const body = (context ? context + '\n\n' : '') + texts.map((t) => `- ${t}`).join('\n');
    return { title: texts.length > 1 ? `${subTitle} (+${texts.length - 1} related)` : subTitle, body, files };
  });

  // Cap the count by folding the smallest file-free subtasks together.
  while (drafts.length > MAX_SUBTASKS) {
    const freeIdx = drafts
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => d.files.length === 0)
      .map(({ i }) => i);
    const [a, b] = freeIdx.length >= 2 ? [freeIdx[0]!, freeIdx[1]!] : [drafts.length - 2, drafts.length - 1];
    const da = drafts[a]!;
    const db = drafts[b]!;
    const merged: DraftSubTask = {
      title: `${da.title} + ${db.title}`.slice(0, 120),
      body: `${da.body}\n${db.body.replace(context, '').trim()}`,
      files: [...new Set([...da.files, ...db.files])].sort(),
    };
    drafts = drafts.filter((_, i) => i !== a && i !== b);
    drafts.splice(Math.min(a, b), 0, merged);
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

export const PR_FOOTER =
  '\n\n---\n🧠 *Co-thought overnight via [Co(de)Gedanken](https://codegedanken.dev) — Collaborative Time-Zone AI Exchange*';

export interface PromptInput {
  repoUrl: string;
  taskTitle: string;
  subtask: Pick<SubTask, 'title' | 'body' | 'files' | 'index'>;
  totalSubtasks: number;
}

/**
 * The text the extension pastes into the executor's Claude Code composer.
 * The executor reads it and presses Send themselves.
 */
export function buildPrompt(p: PromptInput): string {
  const scope = p.subtask.files.length
    ? `Only modify these files (create them if missing): ${p.subtask.files.join(', ')}. Other subtasks of the same task are editing other files in parallel, so do not touch anything else.`
    : 'Other subtasks of the same task are being worked on in parallel. Keep this change as small and self-contained as possible and avoid broad refactors.';
  return [
    `Repository: ${p.repoUrl}`,
    `Task: ${p.taskTitle}`,
    `Subtask ${p.subtask.index + 1} of ${p.totalSubtasks}: ${p.subtask.title}`,
    '',
    p.subtask.body,
    '',
    `Scope: ${scope}`,
    '',
    'Work on a fork of the repository above in a new branch, then open a pull request against the original repository.',
    'Do not read, modify or reference any other repository.',
    'At the very end of the pull request description, append exactly this footer:',
    PR_FOOTER.trimStart(),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Offset of a timezone from UTC in whole hours at a given instant (e.g. Asia/Jerusalem → 2 or 3). */
export function utcOffsetHours(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 3_600_000) || 0; // normalise -0
}
