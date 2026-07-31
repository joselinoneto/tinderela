import type { CachedResult } from '../cache/cache.js';
import { getCommodities, getStarSystems, getTerminals, getVehicles, type AppContext } from './data.js';

export type EntityType = 'commodity' | 'terminal' | 'vehicle' | 'star_system';

export interface EntityCandidate {
  entityType: EntityType;
  id: number;
  name: string;
  code: string | null;
  /** 0..1 match confidence. */
  score: number;
  /** Type-specific extras (e.g. is_illegal, scu, location names). */
  extra: Record<string, unknown>;
}

export interface ResolveResult {
  candidates: EntityCandidate[];
  dataAgeSeconds: number;
  stale: boolean;
}

/**
 * Portuguese / community aliases that fuzzy matching alone would miss or
 * rank poorly. Keys are normalized (lowercase, no diacritics).
 */
const ALIASES: Record<string, string> = {
  laranita: 'laranite',
  quantanio: 'quantainium',
  quantanium: 'quantainium',
  ouro: 'gold',
  diamante: 'diamond',
  cobre: 'copper',
  ferro: 'iron',
  aluminio: 'aluminum',
  titanio: 'titanium',
  hidrogenio: 'hydrogen',
  'suprimentos medicos': 'medical supplies',
  remedios: 'medical supplies',
};

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(text: string): string {
  return normalize(text).replace(/[^a-z0-9]/g, '');
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const s = compact(text);
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice bigram similarity, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  let sizeA = 0;
  let sizeB = 0;
  let overlap = 0;
  for (const n of ga.values()) sizeA += n;
  for (const n of gb.values()) sizeB += n;
  if (sizeA + sizeB === 0) return 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (sizeA + sizeB);
}

/**
 * Scores `query` against a set of names for one entity. Returns the best
 * score across all its names.
 */
function scoreNames(query: string, names: Array<{ value: string | null; weight: number }>): number {
  const q = normalize(query);
  const qCompact = compact(query);
  let best = 0;
  for (const { value, weight } of names) {
    if (!value) continue;
    const n = normalize(value);
    const nCompact = compact(value);
    let score = 0;
    if (n === q || nCompact === qCompact) score = 1;
    else if (n.startsWith(q) || nCompact.startsWith(qCompact)) score = 0.85;
    else if (n.includes(q) || nCompact.includes(qCompact)) score = 0.75;
    else {
      const sim = diceSimilarity(q, n);
      if (sim >= 0.45) score = Math.min(0.7, sim);
    }
    best = Math.max(best, score * weight);
  }
  return best;
}

interface Searchable {
  id: number;
  displayName: string;
  code: string | null;
  names: Array<{ value: string | null; weight: number }>;
  extra: Record<string, unknown>;
}

async function loadSearchables(
  ctx: AppContext,
  type: EntityType,
): Promise<{ items: Searchable[]; ageSeconds: number; stale: boolean }> {
  switch (type) {
    case 'commodity': {
      const cached = await getCommodities(ctx);
      return {
        items: cached.data.map((c) => ({
          id: c.id,
          displayName: c.name,
          code: c.code,
          names: [
            { value: c.name, weight: 1 },
            { value: c.code, weight: 1 },
          ],
          extra: {
            kind: c.kind,
            is_illegal: c.is_illegal === 1,
            is_raw: c.is_raw === 1,
            is_refinable: c.is_refinable === 1,
            is_buyable: c.is_buyable === 1,
            is_sellable: c.is_sellable === 1,
            is_available_live: c.is_available_live === 1,
          },
        })),
        ageSeconds: cached.ageSeconds,
        stale: cached.stale,
      };
    }
    case 'terminal': {
      const cached = await getTerminals(ctx);
      return {
        items: cached.data.map((t) => ({
          id: t.id,
          displayName: t.name,
          code: t.code,
          names: [
            { value: t.name, weight: 1 },
            { value: t.nickname, weight: 1 },
            { value: t.code, weight: 1 },
            // Location names rank slightly lower: "Area 18" should surface
            // its terminals, but an exact terminal name must win.
            { value: t.city_name, weight: 0.9 },
            { value: t.space_station_name, weight: 0.9 },
            { value: t.outpost_name, weight: 0.9 },
          ],
          extra: {
            type: t.type,
            star_system: t.star_system_name,
            planet: t.planet_name,
            orbit: t.orbit_name,
            moon: t.moon_name,
            city: t.city_name,
            space_station: t.space_station_name,
            outpost: t.outpost_name,
            is_available_live: t.is_available_live === 1,
            is_refinery: t.is_refinery === 1,
            max_container_size: t.max_container_size,
          },
        })),
        ageSeconds: cached.ageSeconds,
        stale: cached.stale,
      };
    }
    case 'vehicle': {
      const cached = await getVehicles(ctx);
      return {
        items: cached.data.map((v) => ({
          id: v.id,
          displayName: v.name_full,
          code: v.slug,
          names: [
            { value: v.name, weight: 1 },
            { value: v.name_full, weight: 1 },
            { value: v.slug, weight: 1 },
          ],
          extra: {
            scu: v.scu,
            crew: v.crew,
            company: v.company_name,
            is_cargo: v.is_cargo === 1,
            is_concept: v.is_concept === 1,
            game_version: v.game_version,
          },
        })),
        ageSeconds: cached.ageSeconds,
        stale: cached.stale,
      };
    }
    case 'star_system': {
      const cached = await getStarSystems(ctx);
      return {
        items: cached.data.map((s) => ({
          id: s.id,
          displayName: s.name,
          code: s.code,
          names: [
            { value: s.name, weight: 1 },
            { value: s.code, weight: 1 },
          ],
          extra: {
            is_available_live: s.is_available_live === 1,
            jurisdiction: s.jurisdiction_name,
          },
        })),
        ageSeconds: cached.ageSeconds,
        stale: cached.stale,
      };
    }
  }
}

export async function resolveEntity(
  ctx: AppContext,
  query: string,
  type: EntityType,
  maxResults = 5,
): Promise<ResolveResult> {
  const { items, ageSeconds, stale } = await loadSearchables(ctx, type);
  const queries = [query];
  const alias = ALIASES[normalize(query)];
  if (alias && type === 'commodity') queries.push(alias);

  const scored = items
    .map((item) => {
      const score = Math.max(...queries.map((q) => scoreNames(q, item.names)));
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.displayName.localeCompare(b.item.displayName))
    .slice(0, maxResults);

  return {
    candidates: scored.map(({ item, score }) => ({
      entityType: type,
      id: item.id,
      name: item.displayName,
      code: item.code,
      score: Math.round(score * 100) / 100,
      extra: item.extra,
    })),
    dataAgeSeconds: ageSeconds,
    stale,
  };
}

/**
 * Resolves to exactly one entity or reports why it can't: no match at all,
 * or several candidates too close to call.
 */
export async function resolveOne(
  ctx: AppContext,
  query: string,
  type: EntityType,
): Promise<
  | { outcome: 'ok'; candidate: EntityCandidate }
  | { outcome: 'not_found'; candidates: EntityCandidate[] }
  | { outcome: 'ambiguous'; candidates: EntityCandidate[] }
> {
  const { candidates } = await resolveEntity(ctx, query, type, 5);
  const best = candidates[0];
  if (!best || best.score < 0.45) return { outcome: 'not_found', candidates };
  const second = candidates[1];
  // A clear winner is a sole exact match or leads the runner-up by a margin.
  if (!second || best.score - second.score >= 0.15 || (best.score === 1 && second.score < 1)) {
    return { outcome: 'ok', candidate: best };
  }
  // "Gold" matches both Gold and Gold (Ore) exactly (they share a code).
  // Players mean the refined commodity unless they say raw/ore.
  if (type === 'commodity') {
    const exact = candidates.filter((c) => c.score === 1);
    const nonRaw = exact.filter((c) => c.extra['is_raw'] !== true);
    if (exact.length > 1 && nonRaw.length === 1 && nonRaw[0]) {
      return { outcome: 'ok', candidate: nonRaw[0] };
    }
  }
  return { outcome: 'ambiguous', candidates };
}

export type { CachedResult };
