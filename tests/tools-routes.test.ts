import { describe, expect, it } from 'vitest';
import { computeRouteEconomics } from '../src/domain/routes.js';
import {
  distanceBetweenTool,
  findBestRoutesTool,
  fuelCostEstimateTool,
  getVehicleTool,
} from '../src/tools/routes.js';
import { runTool } from '../src/tools/types.js';
import type { CommodityRoute } from '../src/uex/types.js';
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

  it('estimates time and profit/hour from the documented heuristics', () => {
    const econ = computeRouteEconomics(SAMPLE_ROUTE, 100, 10_000_000);
    if (!econ) throw new Error('expected economics');
    // 69 Gm / 10 Gm-per-min + 2 * 15 min = 36.9 min
    expect(econ.est_time_minutes).toBeCloseTo(36.9, 1);
    expect(econ.est_profit_per_hour_uec).toBeCloseTo((100 * 1800) / (36.9 / 60), 0);
    expect(econ.profit_per_gm_uec).toBeCloseTo((100 * 1800) / 69, 1);
    expect(econ.uex_score).toBe(100);
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
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { routes: Array<{ buy: { terminal: string } }> };
    for (const route of data.routes) {
      expect(route.buy.terminal).toContain('ArcCorp Mining Area 045');
    }
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
});
