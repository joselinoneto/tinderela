/**
 * All tunables live here — TTLs, rate limits, retry policy and the heuristic
 * constants used for travel-time and fuel estimates. Nothing in the codebase
 * may hardcode these values inline.
 */

export const UEX_BASE_URL = 'https://api.uexcorp.uk/2.0';

/** UEX quota is 120/min and 172,800/day; we stay under both with headroom. */
export const RATE_LIMIT = {
  perMinute: 110,
  perDay: 170_000,
} as const;

export const RETRY = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
} as const;

/** Cache TTLs in seconds, per data class. */
export const TTL_SECONDS = {
  /** commodity prices, routes, rankings, raw ore prices, fuel prices */
  prices: 15 * 60,
  /** terminals, distances, vehicles, refinery data */
  infra: 7 * 24 * 3600,
  /** commodities, star systems, planets, game versions */
  static: 30 * 24 * 3600,
} as const;

export type TtlClass = keyof typeof TTL_SECONDS;

/**
 * Heuristic constants for travel-time and fuel estimates. UEX provides
 * distances (Gm) but not travel times, so profit-per-hour figures derived
 * from these are ESTIMATES and every tool output labels them as such.
 */
export const TRAVEL_HEURISTICS = {
  /** Assumed average quantum speed incl. spool/calibration, in Gm per minute
   *  (~200 Mm/s cruise minus overhead). */
  quantumGmPerMinute: 10,
  /** Fixed minutes per stop, independent of cargo: approach, docking, kiosk. */
  stopOverheadMinutes: 15,
  /** Rough fraction of a ship's quantum fuel tank burned per 100 Gm. */
  quantumFuelFractionPer100Gm: 0.08,
} as const;

/**
 * Cargo handling, on top of `stopOverheadMinutes`, at each stop. This is what
 * makes a 600 SCU run cost more than a 60 SCU one — without it, profit/hour
 * scales with hold size and big manual loads look far better than they are.
 *
 * ⚠️ PLACEHOLDER VALUES — nobody has timed these against the live game. Time a
 * couple of runs (load + unload, wall clock ÷ SCU) and replace them; every
 * figure derived from them is labelled an estimate in tool output.
 *
 * A stop counts as `assisted` when UEX reports the terminal as having a
 * freight elevator or being a cargo centre — see `isAssistedStop`. Ship-side
 * flags (`is_loading_dock`, `is_tractor_beam`) are reported to the player but
 * deliberately do not gate the estimate: `is_loading_dock` is set on almost no
 * ship (the Hull series and little else), so gating on it would price every
 * Caterpillar-sized run as fully manual.
 */
export const LOADING_HEURISTICS = {
  /** Minutes per SCU where the terminal moves the cargo for you. */
  assistedMinutesPerScu: 0.05,
  /** Minutes per SCU where every box goes by tractor beam. */
  manualMinutesPerScu: 0.4,
} as const;

/**
 * Discord bot behaviour. The bot answers each new question inside a thread it
 * opens on the question itself, then rebuilds the conversation from that
 * thread's messages, so these bound how much history is replayed to the model.
 */
export const BOT = {
  /** Per-user throttle on new questions and DMs; thread follow-ups are exempt. */
  cooldownMs: 30_000,
  /** Discord's hard limit on a single message. */
  messageCharLimit: 2_000,
  /** Discord's hard limit on a thread name; we truncate below it. */
  threadNameCharLimit: 100,
  /** Discord auto-archive, in minutes (must be 60, 1440, 4320 or 10080). */
  threadAutoArchiveMinutes: 1_440,
  /** How many messages to pull back when rebuilding a conversation. */
  historyFetchLimit: 60,
  /** Hard cap on turns handed to the model; the newest are kept. */
  maxContextTurns: 20,
} as const;

export function getDbPath(): string {
  return process.env['SC_TRADE_DB'] ?? 'cache.db';
}

export function getApiToken(): string | undefined {
  const token = process.env['UEX_API_TOKEN'];
  return token && token.length > 0 ? token : undefined;
}
