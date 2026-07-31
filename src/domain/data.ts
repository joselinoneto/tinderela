import type { UexCache, CachedResult } from '../cache/cache.js';
import type { Db } from '../cache/db.js';
import type { UexEndpoints } from '../uex/endpoints.js';
import type {
  Commodity,
  CommodityPrice,
  CommodityPriceAll,
  CommodityPriceHistoryEntry,
  CommodityRoute,
  FuelPrice,
  GameVersions,
  OrbitDistance,
  RawCommodityPrice,
  RefineryCapacity,
  RefineryMethod,
  RefineryYield,
  StarSystem,
  Terminal,
  TerminalDistance,
  Vehicle,
} from '../uex/types.js';

/** Structural interface of UexEndpoints so tests can substitute a fixture-backed fake. */
export type UexApi = Pick<
  UexEndpoints,
  | 'gameVersions'
  | 'commodities'
  | 'starSystems'
  | 'terminals'
  | 'commodityPrices'
  | 'commodityPricesAll'
  | 'commodityRawPricesAll'
  | 'commodityPriceHistory'
  | 'commodityRoutes'
  | 'terminalDistance'
  | 'orbitDistances'
  | 'vehicles'
  | 'fuelPricesAll'
  | 'refineryMethods'
  | 'refineryYields'
  | 'refineryCapacities'
>;

export interface AppContext {
  uex: UexApi;
  cache: UexCache;
  db: Db;
  /** Epoch seconds. */
  now: () => number;
}

/** Cached accessors — one per dataset, keyed and classed per the caching policy. */

export function getGameVersions(ctx: AppContext): Promise<CachedResult<GameVersions>> {
  // Freshness matters for the data_freshness tool, so this uses the short TTL.
  return ctx.cache.getOrFetch('game_versions', 'prices', () => ctx.uex.gameVersions());
}

export function getCommodities(ctx: AppContext): Promise<CachedResult<Commodity[]>> {
  return ctx.cache.getOrFetch('commodities', 'static', () => ctx.uex.commodities());
}

export function getStarSystems(ctx: AppContext): Promise<CachedResult<StarSystem[]>> {
  return ctx.cache.getOrFetch('star_systems', 'static', () => ctx.uex.starSystems());
}

export function getTerminals(ctx: AppContext): Promise<CachedResult<Terminal[]>> {
  return ctx.cache.getOrFetch('terminals', 'infra', () => ctx.uex.terminals());
}

export function getVehicles(ctx: AppContext): Promise<CachedResult<Vehicle[]>> {
  return ctx.cache.getOrFetch('vehicles', 'infra', () => ctx.uex.vehicles());
}

export function getCommodityPrices(
  ctx: AppContext,
  idCommodity: number,
): Promise<CachedResult<CommodityPrice[]>> {
  return ctx.cache.getOrFetch(`prices:commodity:${idCommodity}`, 'prices', () =>
    ctx.uex.commodityPrices({ id_commodity: idCommodity }),
  );
}

export function getPricesAll(ctx: AppContext): Promise<CachedResult<CommodityPriceAll[]>> {
  return ctx.cache.getOrFetch('prices_all', 'prices', () => ctx.uex.commodityPricesAll());
}

export function getRawPricesAll(ctx: AppContext): Promise<CachedResult<RawCommodityPrice[]>> {
  return ctx.cache.getOrFetch('raw_prices_all', 'prices', () => ctx.uex.commodityRawPricesAll());
}

export function getPriceHistory(
  ctx: AppContext,
  idCommodity: number,
  idTerminal: number,
): Promise<CachedResult<CommodityPriceHistoryEntry[]>> {
  return ctx.cache.getOrFetch(`history:${idCommodity}:${idTerminal}`, 'prices', () =>
    ctx.uex.commodityPriceHistory({ id_commodity: idCommodity, id_terminal: idTerminal }),
  );
}

export function getCommodityRoutes(
  ctx: AppContext,
  idCommodity: number,
): Promise<CachedResult<CommodityRoute[]>> {
  return ctx.cache.getOrFetch(`routes:commodity:${idCommodity}`, 'prices', () =>
    ctx.uex.commodityRoutes({ id_commodity: idCommodity }),
  );
}

export function getTerminalDistance(
  ctx: AppContext,
  idOrigin: number,
  idDestination: number,
): Promise<CachedResult<TerminalDistance[]>> {
  const [a, b] = idOrigin <= idDestination ? [idOrigin, idDestination] : [idDestination, idOrigin];
  return ctx.cache.getOrFetch(`distance:terminals:${a}:${b}`, 'infra', () =>
    ctx.uex.terminalDistance(idOrigin, idDestination),
  );
}

export function getOrbitDistances(
  ctx: AppContext,
  idSystemOrigin: number,
  idSystemDestination: number,
): Promise<CachedResult<OrbitDistance[]>> {
  return ctx.cache.getOrFetch(`distance:orbits:${idSystemOrigin}:${idSystemDestination}`, 'infra', () =>
    ctx.uex.orbitDistances(idSystemOrigin, idSystemDestination),
  );
}

export function getFuelPrices(ctx: AppContext): Promise<CachedResult<FuelPrice[]>> {
  return ctx.cache.getOrFetch('fuel_prices_all', 'prices', () => ctx.uex.fuelPricesAll());
}

export function getRefineryMethods(ctx: AppContext): Promise<CachedResult<RefineryMethod[]>> {
  return ctx.cache.getOrFetch('refineries_methods', 'infra', () => ctx.uex.refineryMethods());
}

export function getRefineryYields(ctx: AppContext): Promise<CachedResult<RefineryYield[]>> {
  return ctx.cache.getOrFetch('refineries_yields', 'infra', () => ctx.uex.refineryYields());
}

export function getRefineryCapacities(ctx: AppContext): Promise<CachedResult<RefineryCapacity[]>> {
  return ctx.cache.getOrFetch('refineries_capacities', 'infra', () => ctx.uex.refineryCapacities());
}
