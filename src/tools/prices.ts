import { z } from 'zod';
import {
  getCommodities,
  getCommodityPrices,
  getPriceHistory,
  getPricesAll,
} from '../domain/data.js';
import { resolveEntity } from '../domain/resolve.js';
import {
  dominantGameVersion,
  illegalityNotes,
  isoFromEpoch,
  locationOf,
  requireEntity,
} from './helpers.js';
import { defineTool, fail, metaFromCache, ok } from './types.js';

const UNIT_NOTE = 'All prices are aUEC per SCU, as last reported by players to UEX.';

export const resolveEntityTool = defineTool({
  name: 'resolve_entity',
  description:
    'Fuzzy-match free text (PT/EN, e.g. "laranita", "LAR", "Area18", "C2") to canonical UEX entities; call this before other tools when the user wording is not an exact name.',
  inputSchema: {
    query: z.string().min(1).describe('User text to match'),
    type: z.enum(['commodity', 'terminal', 'vehicle', 'star_system']).describe('Entity kind'),
    max_results: z.number().int().min(1).max(20).default(5),
  },
  handler: async (ctx, input) => {
    const result = await resolveEntity(ctx, input.query, input.type, input.max_results);
    if (result.candidates.length === 0) {
      return fail('ENTITY_NOT_FOUND', `no ${input.type} matched "${input.query}"`);
    }
    return ok(
      { query: input.query, type: input.type, candidates: result.candidates },
      {
        data_age_seconds: result.dataAgeSeconds,
        stale: result.stale,
        notes: ['score is match confidence 0..1; treat < 0.7 as needing user confirmation'],
      },
    );
  },
});

export const getCommodityPriceTool = defineTool({
  name: 'get_commodity_price',
  description:
    'Last reported buy/sell prices (aUEC per SCU) for one commodity, at every terminal trading it or at one specific terminal.',
  inputSchema: {
    commodity: z.string().min(1).describe('Commodity name/code, PT or EN'),
    terminal: z.string().min(1).optional().describe('Optional terminal or location name'),
  },
  handler: async (ctx, input) => {
    const commodity = await requireEntity(ctx, input.commodity, 'commodity');
    if ('error' in commodity) return commodity.error;

    const cached = await getCommodityPrices(ctx, commodity.entity.id);
    let rows = cached.data;
    const notes = [UNIT_NOTE, ...illegalityNotes(commodity.entity)];

    if (input.terminal) {
      const terminal = await requireEntity(ctx, input.terminal, 'terminal');
      if ('error' in terminal) return terminal.error;
      rows = rows.filter((r) => r.id_terminal === terminal.entity.id);
      if (rows.length === 0) {
        return fail(
          'NO_DATA',
          `${commodity.entity.name} has no reported prices at ${terminal.entity.name}`,
        );
      }
    }
    if (rows.length === 0) {
      return fail('NO_DATA', `no terminal has reported prices for ${commodity.entity.name}`);
    }

    return ok(
      {
        commodity: {
          id: commodity.entity.id,
          name: commodity.entity.name,
          code: commodity.entity.code,
          is_illegal: commodity.entity.extra['is_illegal'] === true,
        },
        unit: 'aUEC/SCU',
        prices: rows.map((r) => ({
          terminal: r.terminal_name,
          terminal_id: r.id_terminal,
          location: locationOf(r),
          price_buy: r.price_buy,
          price_sell: r.price_sell,
          price_buy_avg: r.price_buy_avg,
          price_sell_avg: r.price_sell_avg,
          scu_available_to_buy: r.scu_buy,
          scu_sellable_demand: r.scu_sell,
          container_sizes: r.container_sizes,
          game_version: r.game_version,
          last_reported_at: isoFromEpoch(r.date_modified),
        })),
      },
      { ...metaFromCache(cached), game_version: dominantGameVersion(rows), notes },
    );
  },
});

function makeWhereTool(side: 'buy' | 'sell') {
  const verb = side === 'buy' ? 'buy' : 'sell';
  return defineTool({
    name: `where_to_${verb}`,
    description:
      side === 'buy'
        ? 'Best terminals to BUY a commodity (lowest aUEC/SCU price first), with reported stock.'
        : 'Best terminals to SELL a commodity (highest aUEC/SCU price first), with reported demand.',
    inputSchema: {
      commodity: z.string().min(1).describe('Commodity name/code, PT or EN'),
      system: z.string().min(1).optional().describe('Optional star system filter, e.g. "Stanton"'),
      max_results: z.number().int().min(1).max(50).default(10),
    },
    handler: async (ctx, input) => {
      const commodity = await requireEntity(ctx, input.commodity, 'commodity');
      if ('error' in commodity) return commodity.error;

      const cached = await getCommodityPrices(ctx, commodity.entity.id);
      let rows = cached.data;
      const notes = [UNIT_NOTE, ...illegalityNotes(commodity.entity)];

      if (input.system) {
        const system = await requireEntity(ctx, input.system, 'star_system');
        if ('error' in system) return system.error;
        rows = rows.filter((r) => r.id_star_system === system.entity.id);
        notes.push(`filtered to star system ${system.entity.name}`);
      }

      rows = rows.filter((r) => (side === 'buy' ? r.price_buy > 0 : r.price_sell > 0));
      if (rows.length === 0) {
        return fail('NO_DATA', `no terminal reported a ${verb} price for ${commodity.entity.name}`);
      }
      rows = [...rows].sort((a, b) =>
        side === 'buy' ? a.price_buy - b.price_buy : b.price_sell - a.price_sell,
      );
      const top = rows.slice(0, input.max_results);

      return ok(
        {
          commodity: {
            id: commodity.entity.id,
            name: commodity.entity.name,
            code: commodity.entity.code,
            is_illegal: commodity.entity.extra['is_illegal'] === true,
          },
          unit: 'aUEC/SCU',
          side,
          terminals: top.map((r) => ({
            terminal: r.terminal_name,
            terminal_id: r.id_terminal,
            location: locationOf(r),
            price: side === 'buy' ? r.price_buy : r.price_sell,
            price_avg: side === 'buy' ? r.price_buy_avg : r.price_sell_avg,
            scu: side === 'buy' ? r.scu_buy : r.scu_sell,
            scu_meaning: side === 'buy' ? 'reported stock available' : 'reported demand capacity',
            game_version: r.game_version,
            last_reported_at: isoFromEpoch(r.date_modified),
          })),
          total_terminals: rows.length,
        },
        { ...metaFromCache(cached), game_version: dominantGameVersion(top), notes },
      );
    },
  });
}

export const whereToBuyTool = makeWhereTool('buy');
export const whereToSellTool = makeWhereTool('sell');

export const priceHistoryTool = defineTool({
  name: 'price_history',
  description:
    'Historical buy/sell price reports (aUEC per SCU) for a commodity at a terminal; without a terminal, covers the top 3 sell-price terminals.',
  inputSchema: {
    commodity: z.string().min(1).describe('Commodity name/code, PT or EN'),
    terminal: z.string().min(1).optional().describe('Optional terminal name'),
    days: z.number().int().min(1).max(90).default(15).describe('Lookback window in days'),
  },
  handler: async (ctx, input) => {
    const commodity = await requireEntity(ctx, input.commodity, 'commodity');
    if ('error' in commodity) return commodity.error;

    const prices = await getCommodityPrices(ctx, commodity.entity.id);
    const notes = [UNIT_NOTE, ...illegalityNotes(commodity.entity)];

    let terminalIds: Array<{ id: number; name: string }>;
    if (input.terminal) {
      const terminal = await requireEntity(ctx, input.terminal, 'terminal');
      if ('error' in terminal) return terminal.error;
      terminalIds = [{ id: terminal.entity.id, name: terminal.entity.name }];
    } else {
      terminalIds = [...prices.data]
        .filter((r) => r.price_sell > 0)
        .sort((a, b) => b.price_sell - a.price_sell)
        .slice(0, 3)
        .map((r) => ({ id: r.id_terminal, name: r.terminal_name }));
      notes.push('no terminal given — using the top 3 terminals by current sell price');
      if (terminalIds.length === 0) {
        return fail('NO_DATA', `no terminals with sell prices found for ${commodity.entity.name}`);
      }
    }

    const cutoff = ctx.now() - input.days * 86_400;
    let oldestFetch: { fetchedAt: number; ageSeconds: number; stale: boolean } | null = null;
    const series = [];
    for (const terminal of terminalIds) {
      const cached = await getPriceHistory(ctx, commodity.entity.id, terminal.id);
      if (!oldestFetch || cached.fetchedAt < oldestFetch.fetchedAt) oldestFetch = cached;
      const entries = cached.data.filter((e) => e.date_added >= cutoff);
      series.push({
        terminal: terminal.name,
        terminal_id: terminal.id,
        entries: entries.map((e) => ({
          date: isoFromEpoch(e.date_added),
          price_buy: e.price_buy,
          price_sell: e.price_sell,
          game_version: e.game_version,
        })),
        reports_in_window: entries.length,
        reports_total_available: cached.data.length,
      });
    }

    const allEntries = series.flatMap((s) => s.entries);
    if (allEntries.length === 0) {
      notes.push(`no reports within the last ${input.days} days; UEX history for these terminals may be sparse`);
    }

    return ok(
      {
        commodity: { id: commodity.entity.id, name: commodity.entity.name, code: commodity.entity.code },
        unit: 'aUEC/SCU',
        days: input.days,
        series,
      },
      {
        ...(oldestFetch ? metaFromCache(oldestFetch) : {}),
        game_version: dominantGameVersion(allEntries.filter((e) => e.game_version)),
        notes,
      },
    );
  },
});

export const marketRankingTool = defineTool({
  name: 'market_ranking',
  description:
    'Ranks commodities market-wide: by cross-terminal spread (best sell minus best buy, aUEC/SCU), top sell price, or top buy price.',
  inputSchema: {
    kind: z.enum(['spread', 'top_sell', 'top_buy']).default('spread'),
    limit: z.number().int().min(1).max(50).default(10),
  },
  handler: async (ctx, input) => {
    const [pricesAll, commodities] = await Promise.all([getPricesAll(ctx), getCommodities(ctx)]);
    const flags = new Map(commodities.data.map((c) => [c.id, c]));

    interface Agg {
      id_commodity: number;
      name: string;
      minBuy: { price: number; terminal: string } | null;
      maxSell: { price: number; terminal: string } | null;
    }
    const byCommodity = new Map<number, Agg>();
    for (const row of pricesAll.data) {
      let agg = byCommodity.get(row.id_commodity);
      if (!agg) {
        agg = { id_commodity: row.id_commodity, name: row.commodity_name, minBuy: null, maxSell: null };
        byCommodity.set(row.id_commodity, agg);
      }
      if (row.price_buy > 0 && (!agg.minBuy || row.price_buy < agg.minBuy.price)) {
        agg.minBuy = { price: row.price_buy, terminal: row.terminal_name };
      }
      if (row.price_sell > 0 && (!agg.maxSell || row.price_sell > agg.maxSell.price)) {
        agg.maxSell = { price: row.price_sell, terminal: row.terminal_name };
      }
    }

    const entries = [...byCommodity.values()].map((agg) => {
      const commodity = flags.get(agg.id_commodity);
      return {
        commodity: agg.name,
        commodity_id: agg.id_commodity,
        is_illegal: commodity ? commodity.is_illegal === 1 : null,
        best_buy: agg.minBuy,
        best_sell: agg.maxSell,
        spread_per_scu:
          agg.minBuy && agg.maxSell ? Math.round((agg.maxSell.price - agg.minBuy.price) * 100) / 100 : null,
      };
    });

    const ranked = entries
      .filter((e) =>
        input.kind === 'spread' ? e.spread_per_scu !== null : input.kind === 'top_sell' ? e.best_sell : e.best_buy,
      )
      .sort((a, b) => {
        if (input.kind === 'spread') return (b.spread_per_scu ?? 0) - (a.spread_per_scu ?? 0);
        if (input.kind === 'top_sell') return (b.best_sell?.price ?? 0) - (a.best_sell?.price ?? 0);
        return (b.best_buy?.price ?? 0) - (a.best_buy?.price ?? 0);
      })
      .slice(0, input.limit);

    return ok(
      { kind: input.kind, unit: 'aUEC/SCU', ranking: ranked },
      {
        ...metaFromCache(pricesAll),
        notes: [
          UNIT_NOTE,
          'computed locally from the UEX commodities_prices_all snapshot (the UEX ranking endpoint returns no data)',
          'spread ignores travel: use find_best_routes for actionable runs',
        ],
      },
    );
  },
});

export const priceTools = [
  resolveEntityTool,
  getCommodityPriceTool,
  whereToBuyTool,
  whereToSellTool,
  priceHistoryTool,
  marketRankingTool,
];
