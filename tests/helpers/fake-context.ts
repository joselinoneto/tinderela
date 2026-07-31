import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UexCache } from '../../src/cache/cache.js';
import { openDb } from '../../src/cache/db.js';
import type { AppContext, UexApi } from '../../src/domain/data.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf-8')) as T;
}

/**
 * UexApi implementation backed by the recorded fixtures. Counts calls so
 * tests can assert caching behavior. Throws for combinations that have no
 * fixture, which keeps tests honest about what was recorded.
 */
export class FakeUex implements UexApi {
  calls: string[] = [];

  private load<T>(name: string, call: string): Promise<T> {
    this.calls.push(call);
    return Promise.resolve(fixture<T>(name));
  }

  gameVersions() {
    return this.load<never>('game_versions', 'game_versions');
  }
  commodities() {
    return this.load<never>('commodities', 'commodities');
  }
  starSystems() {
    return this.load<never>('star_systems', 'star_systems');
  }
  terminals(idStarSystem?: number) {
    if (idStarSystem !== undefined && idStarSystem !== 68) {
      throw new Error(`no terminals fixture for system ${idStarSystem}`);
    }
    return this.load<never>('terminals_stanton', `terminals:${idStarSystem ?? 'all'}`);
  }
  commodityPrices(params: { id_commodity?: number; id_terminal?: number }) {
    if (params.id_commodity !== 47) {
      throw new Error(`no commodities_prices fixture for ${JSON.stringify(params)}`);
    }
    return this.load<never>('commodities_prices_laranite', `commodities_prices:${params.id_commodity}`);
  }
  commodityPricesAll() {
    return this.load<never>('commodities_prices_all', 'commodities_prices_all');
  }
  commodityRawPricesAll() {
    return this.load<never>('commodities_raw_prices_all', 'commodities_raw_prices_all');
  }
  async commodityPriceHistory(params: { id_commodity: number; id_terminal: number }) {
    const rows = await this.load<Array<{ id_terminal: number }>>(
      'commodities_prices_history_laranite',
      `history:${params.id_commodity}:${params.id_terminal}`,
    );
    if (params.id_commodity !== 47) throw new Error('no history fixture for that commodity');
    return rows.filter((r) => r.id_terminal === params.id_terminal) as never;
  }
  commodityRoutes(params: { id_commodity?: number }) {
    if (params.id_commodity !== 47) {
      throw new Error(`no routes fixture for ${JSON.stringify(params)}`);
    }
    return this.load<never>('commodities_routes_laranite', `routes:${params.id_commodity}`);
  }
  terminalDistance(idOrigin: number, idDestination: number) {
    return this.load<never>('terminals_distance_sample', `distance:${idOrigin}:${idDestination}`);
  }
  orbitDistances(a: number, b: number) {
    return this.load<never>('orbits_distances_stanton', `orbits:${a}:${b}`);
  }
  vehicles() {
    return this.load<never>('vehicles', 'vehicles');
  }
  fuelPricesAll() {
    return this.load<never>('fuel_prices_all', 'fuel_prices_all');
  }
  refineryMethods() {
    return this.load<never>('refineries_methods', 'refineries_methods');
  }
  refineryYields() {
    return this.load<never>('refineries_yields', 'refineries_yields');
  }
  refineryCapacities() {
    return this.load<never>('refineries_capacities', 'refineries_capacities');
  }
}

export interface TestContext extends AppContext {
  fake: FakeUex;
  clock: { value: number };
}

export function makeTestContext(nowSeconds = Math.floor(Date.now() / 1000)): TestContext {
  const clock = { value: nowSeconds };
  const db = openDb(':memory:');
  const fake = new FakeUex();
  return {
    uex: fake,
    cache: new UexCache(db, { now: () => clock.value }),
    db,
    now: () => clock.value,
    fake,
    clock,
  };
}
