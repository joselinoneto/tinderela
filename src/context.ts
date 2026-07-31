import 'dotenv/config';
import { getApiToken, getDbPath } from './config.js';
import { UexCache } from './cache/cache.js';
import { openDb, SqliteDailyStore } from './cache/db.js';
import type { AppContext } from './domain/data.js';
import { UexClient } from './uex/client.js';
import { UexEndpoints } from './uex/endpoints.js';
import { RateLimiter } from './uex/rate-limiter.js';

export function createContext(): AppContext {
  const db = openDb(getDbPath());
  const rateLimiter = new RateLimiter({ dailyStore: new SqliteDailyStore(db) });
  const client = new UexClient({ token: getApiToken(), rateLimiter });
  return {
    uex: new UexEndpoints(client),
    cache: new UexCache(db),
    db,
    now: () => Math.floor(Date.now() / 1000),
  };
}
