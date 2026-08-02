import { z } from 'zod';
import { TRAVEL_HEURISTICS } from '../config.js';
import {
  getCommodities,
  getCommodityRoutes,
  getFuelPrices,
  getGameVersions,
  getPricesAll,
  getTerminalDistance,
  getVehicles,
  type AppContext,
} from '../domain/data.js';
import { resolveEntity } from '../domain/resolve.js';
import { computeRouteEconomics, TIME_MODEL_NOTE } from '../domain/routes.js';
import type { CommodityRoute } from '../uex/types.js';
import { isoFromEpoch, requireEntity } from './helpers.js';
import { defineTool, fail, metaFromCache, ok } from './types.js';

/**
 * Terminal ids a free-text location refers to. The 0.75 floor keeps exact,
 * prefix, substring and location-name matches but drops pure fuzzy hits,
 * which would otherwise pull in sister terminals ("...Area 045" vs "...056").
 */
async function resolveTerminalIds(
  ctx: AppContext,
  query: string,
): Promise<{ ids: Set<number>; label: string } | null> {
  const { candidates } = await resolveEntity(ctx, query, 'terminal', 15);
  const good = candidates.filter((c) => c.score >= 0.75);
  if (good.length === 0) return null;
  return { ids: new Set(good.map((c) => c.id)), label: good[0]?.name ?? query };
}

export const findBestRoutesTool = defineTool({
  name: 'find_best_routes',
  description:
    'Best trade routes for a ship and budget: profit total/per SCU, ROI, investment, distance, plus estimated time and profit/hour (labeled heuristics). Optionally pinned to an origin, destination or commodity.',
  inputSchema: {
    origin: z.string().min(1).optional().describe('Buy-side terminal or location name'),
    destination: z.string().min(1).optional().describe('Sell-side terminal or location name'),
    commodity: z.string().min(1).optional().describe('Restrict to one commodity'),
    capacity_scu: z.number().int().min(1).describe('Ship cargo capacity in SCU'),
    budget_uec: z.number().min(1).describe('Available aUEC for buying cargo'),
    legal_only: z.boolean().default(true).describe('Exclude illegal commodities'),
    max_results: z.number().int().min(1).max(20).default(5),
  },
  handler: async (ctx, input) => {
    const notes: string[] = [TIME_MODEL_NOTE, 'prices are aUEC per SCU, last reported by players to UEX'];
    const commodities = await getCommodities(ctx);
    const byId = new Map(commodities.data.map((c) => [c.id, c]));

    let candidateIds: number[];
    if (input.commodity) {
      const commodity = await requireEntity(ctx, input.commodity, 'commodity');
      if ('error' in commodity) return commodity.error;
      if (input.legal_only && commodity.entity.extra['is_illegal'] === true) {
        return fail(
          'NO_DATA',
          `${commodity.entity.name} is illegal; call again with legal_only=false to see its routes`,
        );
      }
      candidateIds = [commodity.entity.id];
    } else {
      // Pick the widest-spread tradeable commodities from the market snapshot.
      const pricesAll = await getPricesAll(ctx);
      const spread = new Map<number, { minBuy: number; maxSell: number }>();
      for (const row of pricesAll.data) {
        const agg = spread.get(row.id_commodity) ?? { minBuy: Infinity, maxSell: 0 };
        if (row.price_buy > 0) agg.minBuy = Math.min(agg.minBuy, row.price_buy);
        if (row.price_sell > 0) agg.maxSell = Math.max(agg.maxSell, row.price_sell);
        spread.set(row.id_commodity, agg);
      }
      candidateIds = [...spread.entries()]
        .filter(([id, s]) => {
          const c = byId.get(id);
          return (
            c !== undefined &&
            s.minBuy < Infinity &&
            s.maxSell > s.minBuy &&
            c.is_available_live === 1 &&
            (!input.legal_only || c.is_illegal === 0)
          );
        })
        .sort((a, b) => b[1].maxSell - b[1].minBuy - (a[1].maxSell - a[1].minBuy))
        .slice(0, 10)
        .map(([id]) => id);
      notes.push('scanned the 10 widest-spread tradeable commodities; pass a commodity to go deeper on one');
    }

    const origin = input.origin ? await resolveTerminalIds(ctx, input.origin) : null;
    if (input.origin && !origin) return fail('ENTITY_NOT_FOUND', `no terminal matched origin "${input.origin}"`);
    const destination = input.destination ? await resolveTerminalIds(ctx, input.destination) : null;
    if (input.destination && !destination) {
      return fail('ENTITY_NOT_FOUND', `no terminal matched destination "${input.destination}"`);
    }

    const live = await getGameVersions(ctx);
    let oldestFetch: { fetchedAt: number; ageSeconds: number; stale: boolean } | null = null;
    const failedCommodities: string[] = [];
    const routeSets = await Promise.all(
      candidateIds.map(async (id) => {
        try {
          const cached = await getCommodityRoutes(ctx, id);
          if (!oldestFetch || cached.fetchedAt < oldestFetch.fetchedAt) oldestFetch = cached;
          return cached.data;
        } catch {
          failedCommodities.push(byId.get(id)?.name ?? String(id));
          return [] as CommodityRoute[];
        }
      }),
    );
    if (failedCommodities.length > 0) {
      notes.push(`route lookups failed for: ${failedCommodities.join(', ')}`);
    }

    const results = routeSets
      .flat()
      .filter((r) => !origin || origin.ids.has(r.id_terminal_origin))
      .filter((r) => !destination || destination.ids.has(r.id_terminal_destination))
      .filter((r) => {
        const c = byId.get(r.id_commodity);
        return !input.legal_only || !c || c.is_illegal === 0;
      })
      .flatMap((r) => {
        const econ = computeRouteEconomics(r, input.capacity_scu, input.budget_uec);
        if (!econ) return [];
        const c = byId.get(r.id_commodity);
        return [
          {
            commodity: r.commodity_name,
            commodity_id: r.id_commodity,
            is_illegal: c ? c.is_illegal === 1 : null,
            buy: {
              terminal: r.origin_terminal_name,
              terminal_id: r.id_terminal_origin,
              star_system: r.origin_star_system_name,
              price_per_scu: r.price_origin,
              reported_supply_scu: r.scu_origin,
              has_freight_elevator: r.has_freight_elevator_origin === 1,
              is_cargo_center: r.has_cargo_center_origin === 1,
              container_sizes_scu: r.container_sizes_origin,
              game_version: r.game_version_origin,
            },
            sell: {
              terminal: r.destination_terminal_name,
              terminal_id: r.id_terminal_destination,
              star_system: r.destination_star_system_name,
              price_per_scu: r.price_destination,
              reported_demand_scu: r.scu_destination,
              has_freight_elevator: r.has_freight_elevator_destination === 1,
              is_cargo_center: r.has_cargo_center_destination === 1,
              container_sizes_scu: r.container_sizes_destination,
              game_version: r.game_version_destination,
            },
            game_version_outdated:
              r.game_version_origin !== live.data.live || r.game_version_destination !== live.data.live,
            last_reported_at: isoFromEpoch(r.date_added),
            ...econ,
          },
        ];
      })
      .sort((a, b) => b.profit_total_uec - a.profit_total_uec)
      .slice(0, input.max_results);

    if (results.length === 0) {
      return fail('NO_DATA', 'no profitable route found under these constraints', {
        origin: input.origin ?? null,
        destination: input.destination ?? null,
        commodity: input.commodity ?? null,
      });
    }

    notes.push(
      'sorted by profit_total_uec; est_profit_per_hour_uec, profit_per_gm_uec, roi_percent and uex_score are included for alternative rankings',
    );
    const manualStops = results.filter(
      (r) => r.cargo_handling_origin === 'manual' || r.cargo_handling_destination === 'manual',
    );
    if (manualStops.length > 0) {
      notes.push(
        'cargo_handling "manual" means UEX reports no freight elevator or cargo centre at that terminal — the load moves by tractor beam, which est_load_minutes/est_unload_minutes account for. Tell the player when a big load is hand-hauled.',
      );
    }
    return ok(
      {
        unit: 'aUEC per SCU; distances in Gm',
        capacity_scu: input.capacity_scu,
        budget_uec: input.budget_uec,
        legal_only: input.legal_only,
        routes: results,
      },
      { ...(oldestFetch ? metaFromCache(oldestFetch) : {}), game_version: live.data.live, notes },
    );
  },
});

export const distanceBetweenTool = defineTool({
  name: 'distance_between',
  description: 'Reported travel distance in Gm between two named terminals.',
  inputSchema: {
    origin_terminal: z.string().min(1),
    destination_terminal: z.string().min(1),
  },
  handler: async (ctx, input) => {
    const origin = await requireEntity(ctx, input.origin_terminal, 'terminal');
    if ('error' in origin) return origin.error;
    const destination = await requireEntity(ctx, input.destination_terminal, 'terminal');
    if ('error' in destination) return destination.error;

    const cached = await getTerminalDistance(ctx, origin.entity.id, destination.entity.id);
    const row = cached.data[0];
    if (!row) {
      return fail('NO_DATA', `UEX has no distance between ${origin.entity.name} and ${destination.entity.name}`);
    }
    const distance = Number(row.distance) || 0;
    const notes = ['distance in Gm as reported by UEX'];
    if (distance === 0) notes.push('0 Gm usually means same-location terminals or an unreported pair');

    return ok(
      {
        origin: { terminal: row.terminal_name_origin, id: origin.entity.id },
        destination: { terminal: row.terminal_name_destination, id: destination.entity.id },
        distance_gm: distance,
      },
      { ...metaFromCache(cached), notes },
    );
  },
});

export const fuelCostEstimateTool = defineTool({
  name: 'fuel_cost_estimate',
  description:
    'Rough quantum-fuel cost ESTIMATE for a route and ship, from UEX distance and fuel prices plus documented heuristics.',
  inputSchema: {
    origin_terminal: z.string().min(1),
    destination_terminal: z.string().min(1),
    vehicle: z.string().min(1).describe('Ship name, e.g. "C2 Hercules"'),
  },
  handler: async (ctx, input) => {
    const origin = await requireEntity(ctx, input.origin_terminal, 'terminal');
    if ('error' in origin) return origin.error;
    const destination = await requireEntity(ctx, input.destination_terminal, 'terminal');
    if ('error' in destination) return destination.error;
    const vehicleEntity = await requireEntity(ctx, input.vehicle, 'vehicle');
    if ('error' in vehicleEntity) return vehicleEntity.error;

    const [distances, fuel, vehicles] = await Promise.all([
      getTerminalDistance(ctx, origin.entity.id, destination.entity.id),
      getFuelPrices(ctx),
      getVehicles(ctx),
    ]);
    const distanceRow = distances.data[0];
    if (!distanceRow) {
      return fail('NO_DATA', `UEX has no distance between ${origin.entity.name} and ${destination.entity.name}`);
    }
    const distance = Number(distanceRow.distance) || 0;
    const vehicle = vehicles.data.find((v) => v.id === vehicleEntity.entity.id);
    if (!vehicle) return fail('NO_DATA', `vehicle ${vehicleEntity.entity.name} not found in UEX data`);

    const quantumRows = fuel.data.filter((f) => f.commodity_name === 'Quantum Fuel' && f.price_buy > 0);
    if (quantumRows.length === 0) return fail('NO_DATA', 'UEX reports no quantum fuel prices');
    const atEndpoints = quantumRows.filter(
      (f) => f.id_terminal === origin.entity.id || f.id_terminal === destination.entity.id,
    );
    const marketAvg = quantumRows.reduce((sum, f) => sum + f.price_buy, 0) / quantumRows.length;
    const unitPrice = atEndpoints.length
      ? Math.min(...atEndpoints.map((f) => f.price_buy))
      : marketAvg;

    const tankFraction = (distance / 100) * TRAVEL_HEURISTICS.quantumFuelFractionPer100Gm;
    const hasTankData = vehicle.fuel_quantum > 0;
    const estUnits = hasTankData ? vehicle.fuel_quantum * tankFraction : null;
    const estCost = estUnits !== null ? Math.round((estUnits / 1000) * unitPrice) : null;

    const notes = [
      `ESTIMATE ONLY: assumes ${TRAVEL_HEURISTICS.quantumFuelFractionPer100Gm * 100}% of the quantum tank per 100 Gm; fuel prices are as reported to UEX`,
    ];
    if (!hasTankData) {
      notes.push(`UEX has no quantum tank size for ${vehicle.name_full}; returning price context only`);
    }
    if (atEndpoints.length === 0) notes.push('neither endpoint reports fuel prices; using market average');

    return ok(
      {
        vehicle: { name: vehicle.name_full, fuel_quantum: vehicle.fuel_quantum || null },
        route: {
          origin: origin.entity.name,
          destination: destination.entity.name,
          distance_gm: distance,
        },
        est_tank_fraction_used: Math.round(tankFraction * 1000) / 1000,
        quantum_fuel_unit_price_uec: Math.round(unitPrice * 100) / 100,
        est_fuel_cost_uec: estCost,
        cheapest_endpoint_fuel: atEndpoints.length
          ? atEndpoints.map((f) => ({ terminal: f.terminal_name, price_buy: f.price_buy }))
          : null,
      },
      { ...metaFromCache(fuel), notes },
    );
  },
});

export const getVehicleTool = defineTool({
  name: 'get_vehicle',
  description: 'Ship/vehicle specs from UEX: cargo SCU (use this to cap route loads), crew, fuel, containers.',
  inputSchema: {
    name: z.string().min(1).describe('Ship name, e.g. "C2", "Caterpillar"'),
  },
  handler: async (ctx, input) => {
    const entity = await requireEntity(ctx, input.name, 'vehicle');
    if ('error' in entity) return entity.error;
    const cached = await getVehicles(ctx);
    const vehicle = cached.data.find((v) => v.id === entity.entity.id);
    if (!vehicle) return fail('NO_DATA', `vehicle ${entity.entity.name} not in UEX data`);

    const notes: string[] = [];
    if (vehicle.is_concept === 1) notes.push('concept ship — not flyable in the live game');
    if (vehicle.scu === 0) notes.push('no cargo capacity reported; do not plan cargo runs with this vehicle');
    if (vehicle.scu > 0 && vehicle.is_loading_dock === 0) {
      notes.push(
        'no loading dock: at terminals without a freight elevator or cargo centre this hold is filled box by box — see est_load_minutes on find_best_routes before promising a turnaround time',
      );
    }

    return ok(
      {
        id: vehicle.id,
        name: vehicle.name_full,
        company: vehicle.company_name,
        cargo_scu: vehicle.scu,
        crew: vehicle.crew,
        fuel_quantum: vehicle.fuel_quantum || null,
        fuel_hydrogen: vehicle.fuel_hydrogen || null,
        container_sizes_scu: vehicle.container_sizes,
        pad_type: vehicle.pad_type,
        has_loading_dock: vehicle.is_loading_dock === 1,
        has_tractor_beam: vehicle.is_tractor_beam === 1,
        is_cargo_ship: vehicle.is_cargo === 1,
        is_ground_vehicle: vehicle.is_ground_vehicle === 1,
        is_concept: vehicle.is_concept === 1,
        game_version: vehicle.game_version,
      },
      { ...metaFromCache(cached), game_version: vehicle.game_version, notes },
    );
  },
});

export const routeTools = [findBestRoutesTool, distanceBetweenTool, fuelCostEstimateTool, getVehicleTool];
