/**
 * Live smoke test: runs every registered tool once against the real UEX API
 * and prints a compact summary. Requires network; uses the token if present.
 * Run with: npm run smoke
 */
import { createContext } from '../src/context.js';
import { allTools } from '../src/tools/index.js';
import { runTool } from '../src/tools/types.js';

const SAMPLE_INPUTS: Record<string, Record<string, unknown>> = {
  resolve_entity: { query: 'laranita', type: 'commodity' },
  get_commodity_price: { commodity: 'Laranite', terminal: 'TDD Area 18' },
  where_to_buy: { commodity: 'Laranite', max_results: 3 },
  where_to_sell: { commodity: 'laranita', system: 'Stanton', max_results: 3 },
  price_history: { commodity: 'Laranite', terminal: 'TDD Area 18', days: 30 },
  market_ranking: { kind: 'spread', limit: 5 },
  find_best_routes: { origin: 'Area 18', capacity_scu: 696, budget_uec: 800_000, max_results: 3 },
  distance_between: { origin_terminal: 'TDD Area 18', destination_terminal: 'TDD Orison' },
  fuel_cost_estimate: { origin_terminal: 'TDD Area 18', destination_terminal: 'TDD Orison', vehicle: 'C2' },
  get_vehicle: { name: 'C2' },
  raw_ore_prices: { ore: 'Quantainium' },
  refinery_advisor: { ore: 'Quantainium', quantity_scu: 50, location: 'ARC-L1' },
  data_freshness: {},
  set_price_alert: { commodity: 'Laranite', terminal: 'TDD Area 18', threshold: 9000, direction: 'above' },
};

async function main(): Promise<void> {
  const ctx = createContext();
  let failures = 0;

  for (const tool of allTools) {
    const input = SAMPLE_INPUTS[tool.name];
    if (!input) {
      console.log(`SKIP ${tool.name} (no sample input)`);
      continue;
    }
    const started = Date.now();
    const result = await runTool(tool, ctx, input);
    const elapsed = Date.now() - started;
    if (result.ok) {
      const meta = result.meta;
      console.log(
        `OK   ${tool.name} (${elapsed}ms) age=${meta.data_age_seconds}s gv=${meta.game_version} stale=${meta.stale}`,
      );
      console.log(`     ${JSON.stringify(result.data).slice(0, 220)}`);
    } else {
      failures += 1;
      console.log(`FAIL ${tool.name} (${elapsed}ms) ${result.error.code}: ${result.error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} tool(s) failed`);
    process.exit(1);
  }
  console.log('\nall tools OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
