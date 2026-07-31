import Database from 'better-sqlite3';
import type { DailyStore } from '../uex/rate-limiter.js';

export type Db = Database.Database;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS cache (
     key        TEXT PRIMARY KEY,
     payload    TEXT NOT NULL,
     fetched_at INTEGER NOT NULL,
     ttl_class  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS daily_requests (
     date_key TEXT PRIMARY KEY,
     count    INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS alerts (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     id_commodity INTEGER NOT NULL,
     id_terminal  INTEGER NOT NULL,
     threshold    REAL NOT NULL,
     direction    TEXT NOT NULL CHECK (direction IN ('above', 'below')),
     created_at   INTEGER NOT NULL,
     active       INTEGER NOT NULL DEFAULT 1
   )`,
];

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

/** SQLite-backed daily request counter shared by the rate limiter. */
export class SqliteDailyStore implements DailyStore {
  constructor(private readonly db: Db) {}

  getCount(dateKey: string): number {
    const row = this.db
      .prepare('SELECT count FROM daily_requests WHERE date_key = ?')
      .get(dateKey) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  increment(dateKey: string): void {
    this.db
      .prepare(
        `INSERT INTO daily_requests (date_key, count) VALUES (?, 1)
         ON CONFLICT(date_key) DO UPDATE SET count = count + 1`,
      )
      .run(dateKey);
  }
}
