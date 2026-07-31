import { describe, expect, it } from 'vitest';
import { openDb } from '../src/cache/db.js';
import { UexCache } from '../src/cache/cache.js';

function makeCache(startSeconds = 1_000_000) {
  const clock = { value: startSeconds };
  const db = openDb(':memory:');
  const cache = new UexCache(db, { now: () => clock.value });
  return { cache, clock, db };
}

describe('UexCache', () => {
  it('fetches on miss and serves from cache while fresh', async () => {
    const { cache, clock } = makeCache();
    let fetches = 0;
    const fetcher = async () => {
      fetches += 1;
      return { price: 27.5 };
    };

    const first = await cache.getOrFetch('prices:47', 'prices', fetcher);
    expect(first.data).toEqual({ price: 27.5 });
    expect(first.stale).toBe(false);
    expect(first.ageSeconds).toBe(0);

    clock.value += 600; // 10 min < 15 min TTL
    const second = await cache.getOrFetch('prices:47', 'prices', fetcher);
    expect(fetches).toBe(1);
    expect(second.ageSeconds).toBe(600);
    expect(second.fetchedAt).toBe(first.fetchedAt);
  });

  it('refetches after the TTL for the data class expires', async () => {
    const { cache, clock } = makeCache();
    let fetches = 0;
    const fetcher = async () => ++fetches;

    await cache.getOrFetch('k', 'prices', fetcher);
    clock.value += 15 * 60 + 1;
    const result = await cache.getOrFetch('k', 'prices', fetcher);
    expect(fetches).toBe(2);
    expect(result.data).toBe(2);
    expect(result.ageSeconds).toBe(0);
  });

  it('applies the longer TTL for infra data', async () => {
    const { cache, clock } = makeCache();
    let fetches = 0;
    const fetcher = async () => ++fetches;

    await cache.getOrFetch('terminals', 'infra', fetcher);
    clock.value += 6 * 24 * 3600; // 6 days < 7 day TTL
    await cache.getOrFetch('terminals', 'infra', fetcher);
    expect(fetches).toBe(1);
  });

  it('serves stale data flagged stale=true when the fetcher fails', async () => {
    const { cache, clock } = makeCache();
    let shouldFail = false;
    const fetcher = async () => {
      if (shouldFail) throw new Error('UEX down');
      return 'v1';
    };

    await cache.getOrFetch('k', 'prices', fetcher);
    clock.value += 3600;
    shouldFail = true;
    const result = await cache.getOrFetch('k', 'prices', fetcher);
    expect(result.data).toBe('v1');
    expect(result.stale).toBe(true);
    expect(result.ageSeconds).toBe(3600);
  });

  it('rethrows fetcher errors when there is nothing cached', async () => {
    const { cache } = makeCache();
    await expect(
      cache.getOrFetch('missing', 'prices', async () => {
        throw new Error('UEX down');
      }),
    ).rejects.toThrow('UEX down');
  });

  it('persists entries across cache instances sharing a db', async () => {
    const clock = { value: 500 };
    const db = openDb(':memory:');
    const a = new UexCache(db, { now: () => clock.value });
    await a.getOrFetch('k', 'static', async () => 'shared');

    const b = new UexCache(db, { now: () => clock.value });
    const result = await b.getOrFetch('k', 'static', async () => 'MISS');
    expect(result.data).toBe('shared');
  });
});
