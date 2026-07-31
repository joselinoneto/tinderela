import { describe, expect, it } from 'vitest';
import { MemoryDailyStore, QuotaExceededError, RateLimiter } from '../src/uex/rate-limiter.js';

interface Harness {
  limiter: RateLimiter;
  clock: { value: number };
  sleeps: number[];
  store: MemoryDailyStore;
}

function makeHarness(opts: { perMinute?: number; perDay?: number } = {}): Harness {
  const clock = { value: 0 };
  const sleeps: number[] = [];
  const store = new MemoryDailyStore();
  const limiter = new RateLimiter({
    perMinute: opts.perMinute ?? 3,
    perDay: opts.perDay ?? 100,
    now: () => clock.value,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.value += ms;
    },
    dailyStore: store,
  });
  return { limiter, clock, sleeps, store };
}

describe('RateLimiter', () => {
  it('allows perMinute acquisitions without waiting', async () => {
    const { limiter, sleeps } = makeHarness();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(sleeps).toEqual([]);
  });

  it('waits until the sliding window frees a slot', async () => {
    const { limiter, clock, sleeps } = makeHarness();
    await limiter.acquire(); // t=0
    clock.value = 10_000;
    await limiter.acquire(); // t=10s
    await limiter.acquire(); // t=10s
    await limiter.acquire(); // window full; oldest at t=0 expires at t=60s
    expect(sleeps).toEqual([50_000]);
  });

  it('does not wait when the window has naturally expired', async () => {
    const { limiter, clock, sleeps } = makeHarness();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    clock.value = 61_000;
    await limiter.acquire();
    expect(sleeps).toEqual([]);
  });

  it('throws QuotaExceededError when the daily quota is exhausted', async () => {
    const { limiter } = makeHarness({ perDay: 2, perMinute: 10 });
    await limiter.acquire();
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('resets the daily counter on a new UTC day', async () => {
    const { limiter, clock } = makeHarness({ perDay: 2, perMinute: 10 });
    await limiter.acquire();
    await limiter.acquire();
    clock.value = 24 * 3600 * 1000 + 1;
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });

  it('persists daily counts through the store', async () => {
    const { limiter, store } = makeHarness();
    await limiter.acquire();
    await limiter.acquire();
    expect(store.getCount('1970-01-01')).toBe(2);
  });
});
