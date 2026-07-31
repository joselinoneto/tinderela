import { RATE_LIMIT } from '../config.js';

export class QuotaExceededError extends Error {
  constructor(public readonly dateKey: string, public readonly limit: number) {
    super(`UEX daily request quota exhausted (${limit} on ${dateKey})`);
    this.name = 'QuotaExceededError';
  }
}

/** Persists per-UTC-day request counts so restarts don't reset the quota. */
export interface DailyStore {
  getCount(dateKey: string): number;
  increment(dateKey: string): void;
}

export class MemoryDailyStore implements DailyStore {
  private counts = new Map<string, number>();

  getCount(dateKey: string): number {
    return this.counts.get(dateKey) ?? 0;
  }

  increment(dateKey: string): void {
    this.counts.set(dateKey, this.getCount(dateKey) + 1);
  }
}

export interface RateLimiterOptions {
  perMinute?: number;
  perDay?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  dailyStore?: DailyStore;
}

const WINDOW_MS = 60_000;

/**
 * Sliding-window limiter for the per-minute cap plus a persisted per-UTC-day
 * counter. `acquire()` resolves when a request may be sent, or throws
 * QuotaExceededError once the daily quota is spent.
 */
export class RateLimiter {
  private readonly perMinute: number;
  private readonly perDay: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly dailyStore: DailyStore;
  private timestamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions = {}) {
    this.perMinute = options.perMinute ?? RATE_LIMIT.perMinute;
    this.perDay = options.perDay ?? RATE_LIMIT.perDay;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.dailyStore = options.dailyStore ?? new MemoryDailyStore();
  }

  /** Serialized so concurrent callers each get their own slot. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.acquireSlot());
    // Keep the chain alive even if a caller's acquire throws.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async acquireSlot(): Promise<void> {
    const dateKey = new Date(this.now()).toISOString().slice(0, 10);
    if (this.dailyStore.getCount(dateKey) >= this.perDay) {
      throw new QuotaExceededError(dateKey, this.perDay);
    }

    let t = this.now();
    this.timestamps = this.timestamps.filter((ts) => t - ts < WINDOW_MS);
    if (this.timestamps.length >= this.perMinute) {
      const oldest = this.timestamps[0];
      if (oldest !== undefined) {
        await this.sleep(oldest + WINDOW_MS - t);
        t = this.now();
        this.timestamps = this.timestamps.filter((ts) => t - ts < WINDOW_MS);
      }
    }

    this.timestamps.push(t);
    this.dailyStore.increment(dateKey);
  }
}
