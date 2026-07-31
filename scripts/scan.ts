/**
 * Personal market scanner — no LLM in the loop. Scans every tradeable
 * commodity's UEX routes, re-scales them to your ship and budget, and prints
 * the top N as a table. Subsequent runs within the cache TTL (15 min) cost
 * zero API requests.
 *
 * Usage:
 *   npm run scan -- --ship C2 --budget 800000
 *   npm run scan -- --ship Caterpillar --budget 2500000 --top 15 --sort profit
 *   npm run scan -- --ship C2 --budget 800000 --from "Area 18" --illegal
 *
 * Sort keys: hour (default, est. profit/hour) | profit | roi | scu | gm
 */
import { parseArgs } from 'node:util';
import { createContext } from '../src/context.js';
import {
  getCommodities,
  getCommodityRoutes,
  getGameVersions,
  type AppContext,
} from '../src/domain/data.js';
import { resolveEntity, resolveOne } from '../src/domain/resolve.js';
import { computeRouteEconomics, TIME_MODEL_NOTE, type RouteEconomics } from '../src/domain/routes.js';
import type { CommodityRoute } from '../src/uex/types.js';

const SORT_KEYS = {
  hour: 'est_profit_per_hour_uec',
  profit: 'profit_total_uec',
  roi: 'roi_percent',
  scu: 'profit_per_scu_uec',
  gm: 'profit_per_gm_uec',
} as const;
type SortName = keyof typeof SORT_KEYS;

interface ScanRow extends RouteEconomics {
  commodity: string;
  illegal: boolean;
  outdated: boolean;
  buyAt: string;
  sellAt: string;
  reportedDaysAgo: number;
}

function usageAndExit(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    'usage: npm run scan -- --ship <name> --budget <aUEC> [--top N] [--sort hour|profit|roi|scu|gm]\n' +
      '                       [--from <location>] [--to <location>] [--illegal] [--max-commodities N]',
  );
  process.exit(1);
}

async function locationTerminalIds(ctx: AppContext, query: string): Promise<Set<number>> {
  const { candidates } = await resolveEntity(ctx, query, 'terminal', 15);
  const ids = new Set(candidates.filter((c) => c.score >= 0.75).map((c) => c.id));
  if (ids.size === 0) usageAndExit(`no terminal matched "${query}"`);
  return ids;
}

const trunc = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const num = (n: number): string => Math.round(n).toLocaleString('en-US');

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      ship: { type: 'string' },
      budget: { type: 'string' },
      top: { type: 'string', default: '10' },
      sort: { type: 'string', default: 'hour' },
      from: { type: 'string' },
      to: { type: 'string' },
      illegal: { type: 'boolean', default: false },
      'max-commodities': { type: 'string', default: '60' },
    },
  });

  if (!values.ship) usageAndExit('--ship is required');
  if (!values.budget) usageAndExit('--budget is required');
  const budget = Number(values.budget.replace(/[,._]/g, ''));
  if (!Number.isFinite(budget) || budget <= 0) usageAndExit('--budget must be a positive number');
  const top = Number(values.top);
  const maxCommodities = Number(values['max-commodities']);
  const sortName = values.sort as SortName;
  if (!(sortName in SORT_KEYS)) usageAndExit(`unknown --sort "${values.sort}"`);
  const sortKey = SORT_KEYS[sortName];

  const ctx = createContext();
  const started = Date.now();

  const ship = await resolveOne(ctx, values.ship, 'vehicle');
  if (ship.outcome !== 'ok') usageAndExit(`could not resolve ship "${values.ship}" (${ship.outcome})`);
  const capacity = Number(ship.candidate.extra['scu'] ?? 0);
  if (capacity <= 0) usageAndExit(`${ship.candidate.name} has no cargo capacity in UEX data`);

  const fromIds = values.from ? await locationTerminalIds(ctx, values.from) : null;
  const toIds = values.to ? await locationTerminalIds(ctx, values.to) : null;

  const [commodities, versions] = await Promise.all([getCommodities(ctx), getGameVersions(ctx)]);
  const live = versions.data.live;
  const candidates = commodities.data
    .filter(
      (c) =>
        c.is_available_live === 1 &&
        c.is_buyable === 1 &&
        c.is_sellable === 1 &&
        (values.illegal || c.is_illegal === 0),
    )
    .slice(0, maxCommodities);
  const flagById = new Map(commodities.data.map((c) => [c.id, c]));

  process.stderr.write(`scanning routes for ${candidates.length} commodities`);
  let failures = 0;
  const routeSets = await Promise.all(
    candidates.map(async (c) => {
      try {
        const cached = await getCommodityRoutes(ctx, c.id);
        process.stderr.write('.');
        return cached.data;
      } catch {
        failures += 1;
        process.stderr.write('x');
        return [] as CommodityRoute[];
      }
    }),
  );
  process.stderr.write('\n');

  const nowSeconds = ctx.now();
  const rows: ScanRow[] = routeSets
    .flat()
    .filter((r) => !fromIds || fromIds.has(r.id_terminal_origin))
    .filter((r) => !toIds || toIds.has(r.id_terminal_destination))
    .flatMap((r) => {
      const econ = computeRouteEconomics(r, capacity, budget);
      if (!econ) return [];
      const flags = flagById.get(r.id_commodity);
      return [
        {
          ...econ,
          commodity: r.commodity_name,
          illegal: flags ? flags.is_illegal === 1 : false,
          outdated: r.game_version_origin !== live || r.game_version_destination !== live,
          buyAt: `${r.origin_terminal_name} [${r.origin_star_system_name ?? '?'}]`,
          sellAt: `${r.destination_terminal_name} [${r.destination_star_system_name ?? '?'}]`,
          reportedDaysAgo: Math.floor((nowSeconds - r.date_added) / 86_400),
        },
      ];
    })
    .sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))
    .slice(0, top);

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${ship.candidate.name} — ${capacity} SCU | budget ${num(budget)} aUEC | ` +
      `sort: ${sortName} | game version ${live} | ${new Date().toISOString()} | scan ${elapsed}s` +
      (failures > 0 ? ` | ${failures} commodity lookups failed` : ''),
  );

  if (rows.length === 0) {
    console.log('\nno profitable routes under these constraints.');
    return;
  }

  const header = [
    '#'.padStart(2),
    'COMMODITY'.padEnd(20),
    'BUY AT'.padEnd(34),
    'SELL AT'.padEnd(34),
    'SCU'.padStart(4),
    'INVEST'.padStart(10),
    'PROFIT'.padStart(10),
    'ROI%'.padStart(6),
    'GM'.padStart(4),
    '~MIN'.padStart(5),
    '~UEC/H'.padStart(10),
    'AGE'.padStart(4),
    '',
  ].join('  ');
  console.log(`\n${header}`);
  console.log('-'.repeat(header.length));

  rows.forEach((r, i) => {
    const marks = [r.illegal ? '⚠ILLEGAL' : '', r.outdated ? '!old-gv' : ''].filter(Boolean).join(' ');
    console.log(
      [
        String(i + 1).padStart(2),
        trunc(r.commodity, 20).padEnd(20),
        trunc(r.buyAt, 34).padEnd(34),
        trunc(r.sellAt, 34).padEnd(34),
        String(r.scu_loaded).padStart(4),
        num(r.investment_uec).padStart(10),
        num(r.profit_total_uec).padStart(10),
        r.roi_percent.toFixed(1).padStart(6),
        String(Math.round(r.distance_gm)).padStart(4),
        String(Math.round(r.est_time_minutes)).padStart(5),
        num(r.est_profit_per_hour_uec).padStart(10),
        `${r.reportedDaysAgo}d`.padStart(4),
        marks,
      ].join('  '),
    );
  });

  console.log(
    `\nprices: aUEC/SCU, last reported by players (UEX, crowdsourced). AGE = days since the route report.\n` +
      `${TIME_MODEL_NOTE}\n` +
      `SCU column is your actual load (capped by ship/budget/reported supply). ⚠ILLEGAL = CrimeStat/confiscation risk. !old-gv = report from an older game version.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
