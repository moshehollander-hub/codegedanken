import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export function openDb(path: string): DB {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      credits INTEGER NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      handle TEXT NOT NULL,
      tier TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      files TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      claimed_by TEXT REFERENCES users(id),
      claimed_at TEXT,
      pr_url TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS subtasks_status ON subtasks(status);

    CREATE TABLE IF NOT EXISTS nodes (
      node_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      available INTEGER NOT NULL,
      idle_state TEXT NOT NULL,
      timezone TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
  `);
  return db;
}
