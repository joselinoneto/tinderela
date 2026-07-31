import { TTL_SECONDS, type TtlClass } from '../config.js';
import type { Db } from './db.js';

export interface CachedResult<T> {
  data: T;
  /** Unix epoch seconds when the payload was fetched from UEX. */
  fetchedAt: number;
  ageSeconds: number;
  /** True when the fetcher failed and an expired entry was served instead. */
  stale: boolean;
}

interface CacheRow {
  payload: string;
  fetched_at: number;
}

export interface UexCacheOptions {
  /** Clock in epoch seconds (injectable for tests). */
  now?: () => number;
}

/**
 * Get-or-fetch cache over SQLite. TTL is decided by data class (see
 * TTL_SECONDS in config). On fetch failure an expired entry is served with
 * stale=true rather than failing the caller — but never silently: callers
 * must surface the flag.
 */
export class UexCache {
  private readonly now: () => number;

  constructor(private readonly db: Db, options: UexCacheOptions = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async getOrFetch<T>(key: string, ttlClass: TtlClass, fetcher: () => Promise<T>): Promise<CachedResult<T>> {
    const row = this.db.prepare('SELECT payload, fetched_at FROM cache WHERE key = ?').get(key) as
      | CacheRow
      | undefined;
    const t = this.now();

    if (row && t - row.fetched_at <= TTL_SECONDS[ttlClass]) {
      return {
        data: JSON.parse(row.payload) as T,
        fetchedAt: row.fetched_at,
        ageSeconds: t - row.fetched_at,
        stale: false,
      };
    }

    try {
      const data = await fetcher();
      this.db
        .prepare(
          `INSERT INTO cache (key, payload, fetched_at, ttl_class) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
             fetched_at = excluded.fetched_at, ttl_class = excluded.ttl_class`,
        )
        .run(key, JSON.stringify(data), t, ttlClass);
      return { data, fetchedAt: t, ageSeconds: 0, stale: false };
    } catch (err) {
      if (row) {
        return {
          data: JSON.parse(row.payload) as T,
          fetchedAt: row.fetched_at,
          ageSeconds: t - row.fetched_at,
          stale: true,
        };
      }
      throw err;
    }
  }
}
