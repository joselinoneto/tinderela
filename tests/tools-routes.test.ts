import { describe, expect, it } from 'vitest';
import { TRAVEL_HEURISTICS } from '../src/config.js';
import {
  computeRouteEconomics,
  routeAutoLoad,
  terminalAutoLoads,
} from '../src/domain/routes.js';
import {
  distanceBetweenTool,
  findBestRoutesTool,
  fuelCostEstimateTool,
  getVehicleTool,
} from '../src/tools/routes.js';
import { runTool } from '../src/tools/types.js';
import type { CommodityRoute, Terminal } from '../src/uex/types.js';
import { makeTestContext } from './helpers/fake-context.js';

const SAMPLE_ROUTE = {
  price_origin: 7000,
  price_destination: 8800,
  scu_origin: 450,
  distance: 69,
  score: 100,
} as CommodityRoute;

describe('computeRouteEconomics', () => {
  it('clamps load to the budget and reports the limiting factor', () => {
    const econ = computeRouteEconomics(SAMPLE_ROUTE, 696, 800_000);
    expect(econ).not.toBeNull();
    if (!econ) return;
    expect(econ.scu_loaded).toBe(Math.floor(800_000 / 7000)); // 114
    expect(econ.limiting_factor).toBe('budget');
    expect(econ.investment_uec).toBe(114 * 7000);
    expect(econ.profit_total_uec).toBe(114 * 1800);
    expect(econ.profit_per_scu_uec).toBe(1800);
    expect(econ.roi_percent).toBeCloseTo((1800 / 7000) * 100, 1);
  });

  it('clamps to ship capacity when the budget covers a full hold', () => {
    const econ = computeRouteEconomics(SAMPLE_ROUTE, 100, 10_000_000);
    expect(econ?.scu_loaded).toBe(100);
    expect(econ?.limiting_factor).toBe('ship_capacity');
  });

  it('clamps to reported supply when the terminal has less than the ship fits', () => {
    const econ = computeRouteEconomics(SAMPLE_ROUTE, 696, 10_000_000);
    expect(econ?.scu_loaded).toBe(450);
    expect(econ?.limiting_factor).toBe('reported_supply');
  });

  it('estimates flying and docking time only, never loading', () => {
    const econ = computeRouteEconomics(SAMPLE_ROUTE, 100, 10_000_000);
    if (!econ) throw new Error('expected economics');
    // 69 Gm / 10 Gm-per-min + 2 * 15 min docking = 36.9 min. Cargo handling is
    // deliberately not modelled — the tools report auto_load instead.
    const expected = 6.9 + 2 * TRAVEL_HEURISTICS.stopOverheadMinutes;
    expect(econ.est_time_minutes).toBeCloseTo(expected, 1);
    expect(econ.est_profit_per_hour_uec).toBeCloseTo((100 * 1800) / (expected / 60), 0);
    expect(econ.profit_per_gm_uec).toBeCloseTo((100 * 1800) / 69, 1);
    expect(econ.uex_score).toBe(100);
  });

  it('does not vary the time estimate with the size of the load', () => {
    const small = computeRouteEconomics(SAMPLE_ROUTE, 10, 10_000_000);
    const big = computeRouteEconomics(SAMPLE_ROUTE, 400, 10_000_000);
    expect(small?.est_time_minutes).toBe(big?.est_time_minutes);
  });

  it('returns null for unprofitable or unpriced routes', () => {
    expect(computeRouteEconomics({ ...SAMPLE_ROUTE, price_destination: 6000 }, 100, 1e7)).toBeNull();
    expect(computeRouteEconomics({ ...SAMPLE_ROUTE, price_origin: 0 }, 100, 1e7)).toBeNull();
  });
});

describe('find_best_routes', () => {
  it('returns capacity-safe, budget-aware routes with all ranking metrics', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Laranite',
      capacity_scu: 696,
      budget_uec: 800_000,
      max_results: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { routes: Array<Record<string, number>> };
    expect(data.routes.length).toBeGreaterThan(0);
    expect(data.routes.length).toBeLessThanOrEqual(3);
    for (const route of data.routes) {
      expect(route['scu_loaded']).toBeLessThanOrEqual(696);
      expect(route['investment_uec']).toBeLessThanOrEqual(800_000);
      for (const key of [
        'profit_total_uec',
        'profit_per_scu_uec',
        'roi_percent',
        'est_profit_per_hour_uec',
        'uex_score',
      ]) {
        expect(route[key], key).toBeTypeOf('number');
      }
    }
    const profits = data.routes.map((r) => r['profit_total_uec'] ?? 0);
    expect(profits).toEqual([...profits].sort((a, b) => b - a));
    expect(result.meta.notes.join(' ')).toContain('heuristics');
  });

  it('filters by origin location name', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Laranite',
      origin: 'ArcCorp Mining Area 045',
      capacity_scu: 100,
      budget_uec: 1_000_000,
      auto_load: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { routes: Array<{ buy: { terminal: string } }> };
    for (const route of data.routes) {
      expect(route.buy.terminal).toContain('ArcCorp Mining Area 045');
    }
  });

  it('joins each stop back to its terminal for the auto-load flag', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Laranite',
      origin: 'ArcCorp Mining Area 056',
      capacity_scu: 100,
      budget_uec: 1_000_000,
      auto_load: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      routes: Array<{
        buy: { auto_load: boolean };
        sell: { terminal: string; auto_load: boolean };
      }>;
    };
    const route = data.routes.find((r) => r.sell.terminal.includes('Area 18'));
    if (!route) throw new Error('expected the Area 056 → Area 18 route');
    // The mining outpost has a freight elevator but is NOT auto-load: the exact
    // case that made the elevator a bad proxy.
    expect(route.buy.auto_load).toBe(false);
    expect(route.sell.auto_load).toBe(true);
    expect(result.meta.notes.join(' ')).toContain('auto_load');
  });

  it('returns only routes that auto-load at both ends by default', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Laranite',
      capacity_scu: 100,
      budget_uec: 1_000_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      routes: Array<{ buy: { auto_load: boolean }; sell: { auto_load: boolean } }>;
    };
    expect(data.routes.length).toBeGreaterThan(0);
    for (const route of data.routes) {
      expect(route.buy.auto_load).toBe(true);
      expect(route.sell.auto_load).toBe(true);
    }
  });

  it('says how to widen the search when auto-load leaves nothing', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Laranite',
      origin: 'ArcCorp Mining Area 056',
      capacity_scu: 100,
      budget_uec: 1_000_000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });
    if (!result.ok) expect(result.error.message).toContain('auto_load=false');
  });

  it('refuses illegal commodities unless legal_only is disabled', async () => {
    const ctx = makeTestContext();
    const result = await runTool(findBestRoutesTool, ctx, {
      commodity: 'Maze',
      capacity_scu: 100,
      budget_uec: 100_000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'NO_DATA' } });
    if (!result.ok) expect(result.error.message).toContain('legal_only=false');
  });
});

describe('distance_between', () => {
  it('returns the distance in Gm coercing UEX string values', async () => {
    const ctx = makeTestContext();
    const result = await runTool(distanceBetweenTool, ctx, {
      origin_terminal: 'TDD Area 18',
      destination_terminal: 'TDD New Babbage',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { distance_gm: number };
    expect(data.distance_gm).toBe(59);
  });
});

describe('fuel_cost_estimate', () => {
  it('degrades honestly when UEX lacks tank data for the ship', async () => {
    const ctx = makeTestContext();
    const result = await runTool(fuelCostEstimateTool, ctx, {
      origin_terminal: 'TDD Area 18',
      destination_terminal: 'TDD New Babbage',
      vehicle: 'C2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { est_fuel_cost_uec: number | null; route: { distance_gm: number } };
    expect(data.est_fuel_cost_uec).toBeNull();
    expect(data.route.distance_gm).toBe(59);
    expect(result.meta.notes.join(' ')).toContain('no quantum tank size');
  });
});

describe('get_vehicle', () => {
  it('returns the C2 Hercules with its 696 SCU capacity', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getVehicleTool, ctx, { name: 'C2' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { name: string; cargo_scu: number; is_cargo_ship: boolean };
    expect(data.name).toBe('Crusader C2 Hercules Starlifter');
    expect(data.cargo_scu).toBe(696);
    expect(data.is_cargo_ship).toBe(true);
  });

  it('reports the ship loading interfaces', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getVehicleTool, ctx, { name: 'C2' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { has_loading_dock: boolean; has_tractor_beam: boolean };
    expect(data.has_loading_dock).toBe(false);
    expect(data.has_tractor_beam).toBe(false);
  });

  it('never implies a ship without a loading dock cannot be auto-loaded', async () => {
    const ctx = makeTestContext();
    // The Railen has no loading dock (only the Hull series and Kraken do) but
    // is auto-loaded by any admin terminal that supports it.
    const result = await runTool(getVehicleTool, ctx, { name: 'Railen' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { cargo_scu: number; has_loading_dock: boolean };
    expect(data.cargo_scu).toBe(640);
    expect(data.has_loading_dock).toBe(false);

    const notes = result.meta.notes.join(' ');
    expect(notes).toContain('property of the TERMINAL');
    // The old wording tied hauling to the ship and produced a wrong answer.
    expect(notes).not.toContain('no loading dock');
  });

  it('explains the loading dock on the few ships that have one', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getVehicleTool, ctx, { name: 'Hull C' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { has_loading_dock: boolean };
    expect(data.has_loading_dock).toBe(true);
    expect(result.meta.notes.join(' ')).toContain('not a requirement for terminal auto-load');
  });
});

describe('auto-load reporting', () => {
  const terminal = (id: number, autoLoad: number, freightElevator = 0): Terminal =>
    ({
      id,
      is_auto_load: autoLoad,
      has_freight_elevator: freightElevator,
    }) as Terminal;

  it('reads is_auto_load, not the freight elevator', () => {
    expect(terminalAutoLoads(terminal(1, 1))).toBe(true);
    expect(terminalAutoLoads(terminal(2, 0))).toBe(false);
    // 96 of 509 Stanton terminals look like this — an elevator but no auto-load.
    expect(terminalAutoLoads(terminal(3, 0, 1))).toBe(false);
  });

  it('reports false for a terminal missing from the cache rather than guessing', () => {
    expect(terminalAutoLoads(undefined)).toBe(false);
    const autoLoad = routeAutoLoad(
      { ...SAMPLE_ROUTE, id_terminal_origin: 1, id_terminal_destination: 99 },
      new Map([[1, terminal(1, 1)]]),
    );
    expect(autoLoad).toEqual({ origin: true, destination: false });
  });
});
