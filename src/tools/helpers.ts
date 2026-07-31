import type { AppContext } from '../domain/data.js';
import { resolveOne, type EntityCandidate, type EntityType } from '../domain/resolve.js';
import { fail, type ToolResult } from './types.js';
import type { CommodityPrice } from '../uex/types.js';

export function isoFromEpoch(epochSeconds: number | null | undefined): string | null {
  if (!epochSeconds) return null;
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Resolves a single entity or returns the appropriate tool error carrying
 * the candidate list so the caller (an LLM) can re-ask with a better name.
 */
export async function requireEntity(
  ctx: AppContext,
  query: string,
  type: EntityType,
): Promise<{ entity: EntityCandidate } | { error: ToolResult<never> }> {
  const result = await resolveOne(ctx, query, type);
  if (result.outcome === 'ok') return { entity: result.candidate };
  if (result.outcome === 'ambiguous') {
    return {
      error: fail(
        'AMBIGUOUS_ENTITY',
        `"${query}" matches several ${type} entries — specify which one`,
        { candidates: result.candidates },
      ),
    };
  }
  return {
    error: fail('ENTITY_NOT_FOUND', `no ${type} matched "${query}"`, {
      candidates: result.candidates,
    }),
  };
}

export function illegalityNotes(commodity: EntityCandidate): string[] {
  if (commodity.extra['is_illegal'] === true) {
    return [
      `${commodity.name} is ILLEGAL in UEE jurisdictions: carrying it risks fines, CrimeStat and cargo confiscation at security scans. It only trades at no-questions-asked terminals.`,
    ];
  }
  return [];
}

/** Location breadcrumb for a full commodities_prices row. */
export function locationOf(row: CommodityPrice): Record<string, string | null> {
  return {
    star_system: row.star_system_name,
    planet: row.planet_name,
    orbit: row.orbit_name,
    moon: row.moon_name,
    space_station: row.space_station_name,
    city: row.city_name,
    outpost: row.outpost_name,
  };
}

/** Most common game_version among rows, for the meta block. */
export function dominantGameVersion(rows: Array<{ game_version: string }>): string | null {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.game_version, (counts.get(row.game_version) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [version, count] of counts) {
    if (count > bestCount) {
      best = version;
      bestCount = count;
    }
  }
  return best;
}
