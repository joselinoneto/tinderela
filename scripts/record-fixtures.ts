/**
 * Records live UEX API responses into tests/fixtures/ so the test suite runs
 * offline. Run with: npm run record-fixtures
 *
 * Uses Laranite (id 47) and its first reporting terminal as the canonical
 * parameterized fixtures.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { getApiToken } from '../src/config.js';
import { UexClient } from '../src/uex/client.js';
import { UexEndpoints } from '../src/uex/endpoints.js';
import { RateLimiter } from '../src/uex/rate-limiter.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures');
const LARANITE_ID = 47;

async function main(): Promise<void> {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const client = new UexClient({ token: getApiToken(), rateLimiter: new RateLimiter() });
  const uex = new UexEndpoints(client);

  const save = (name: string, data: unknown): void => {
    const file = join(FIXTURES_DIR, `${name}.json`);
    writeFileSync(file, JSON.stringify(data, null, 1));
    const rows = Array.isArray(data) ? data.length : 1;
    console.log(`recorded ${name}.json (${rows} rows)`);
  };

  save('game_versions', await uex.gameVersions());
  save('commodities', await uex.commodities());
  save('star_systems', await uex.starSystems());

  const systems = await uex.starSystems();
  const stanton = systems.find((s) => s.code === 'ST');
  if (!stanton) throw new Error('Stanton not found in star_systems');
  save('terminals_stanton', await uex.terminals(stanton.id));

  const laranitePrices = await uex.commodityPrices({ id_commodity: LARANITE_ID });
  save('commodities_prices_laranite', laranitePrices);
  const firstTerminal = laranitePrices[0];
  if (!firstTerminal) throw new Error('no Laranite prices returned');

  save('commodities_prices_all', await uex.commodityPricesAll());
  save('commodities_raw_prices_all', await uex.commodityRawPricesAll());
  save(
    'commodities_prices_history_laranite',
    await uex.commodityPriceHistory({
      id_commodity: LARANITE_ID,
      id_terminal: firstTerminal.id_terminal,
    }),
  );
  save('commodities_routes_laranite', await uex.commodityRoutes({ id_commodity: LARANITE_ID }));
  save('vehicles', await uex.vehicles());
  save('fuel_prices_all', await uex.fuelPricesAll());
  save('refineries_methods', await uex.refineryMethods());
  save('refineries_yields', await uex.refineryYields());
  save('refineries_capacities', await uex.refineryCapacities());
  save(
    'terminals_distance_sample',
    await uex.terminalDistance(firstTerminal.id_terminal, laranitePrices[1]?.id_terminal ?? firstTerminal.id_terminal),
  );
  save('orbits_distances_stanton', await uex.orbitDistances(stanton.id, stanton.id));

  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
