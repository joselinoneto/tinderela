import { describe, expect, it } from 'vitest';
import {
  getCommodityPriceTool,
  marketRankingTool,
  priceHistoryTool,
  resolveEntityTool,
  whereToBuyTool,
  whereToSellTool,
} from '../src/tools/prices.js';
import { runTool } from '../src/tools/types.js';
import { makeTestContext } from './helpers/fake-context.js';

// Latest Laranite history report in the fixtures (epoch seconds).
const NEWEST_HISTORY_REPORT = 1_785_346_690;

describe('resolve_entity tool', () => {
  it('returns candidates with confidence scores', async () => {
    const ctx = makeTestContext();
    const result = await runTool(resolveEntityTool, ctx, { query: 'laranita', type: 'commodity' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { candidates: Array<{ name: string; score: number }> };
      expect(data.candidates[0]?.name).toBe('Laranite');
      expect(data.candidates.length).toBeLessThanOrEqual(5);
    }
  });

  it('fails explicitly when nothing matches', async () => {
    const ctx = makeTestContext();
    const result = await runTool(resolveEntityTool, ctx, { query: 'xyzzyplugh', type: 'commodity' });
    expect(result).toMatchObject({ ok: false, error: { code: 'ENTITY_NOT_FOUND' } });
  });
});

describe('get_commodity_price', () => {
  it('returns per-terminal prices with units, game version and report times', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getCommodityPriceTool, ctx, { commodity: 'Laranite' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { unit: string; prices: Array<Record<string, unknown>> };
    expect(data.unit).toBe('aUEC/SCU');
    expect(data.prices).toHaveLength(26);
    expect(result.meta.game_version).toBe('4.9');
    expect(result.meta.data_age_seconds).toBe(0);
    expect(result.meta.fetched_at).toBeTruthy();
    expect(data.prices[0]?.['last_reported_at']).toMatch(/^\d{4}-/);
    expect(result.meta.notes.join(' ')).toContain('aUEC per SCU');
  });

  it('filters to a single terminal resolved from a nickname', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getCommodityPriceTool, ctx, {
      commodity: 'Laranite',
      terminal: 'TDD Area 18',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { prices: Array<{ terminal: string; price_sell: number }> };
    expect(data.prices).toHaveLength(1);
    expect(data.prices[0]?.price_sell).toBe(8800);
  });

  it('serves the second call from cache', async () => {
    const ctx = makeTestContext();
    await runTool(getCommodityPriceTool, ctx, { commodity: 'Laranite' });
    await runTool(getCommodityPriceTool, ctx, { commodity: 'Laranite' });
    const priceCalls = ctx.fake.calls.filter((c) => c === 'commodities_prices:47');
    expect(priceCalls).toHaveLength(1);
  });

  it('reports ambiguous terminal names with candidates', async () => {
    const ctx = makeTestContext();
    const result = await runTool(getCommodityPriceTool, ctx, {
      commodity: 'Laranite',
      terminal: 'TDD',
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_ENTITY' } });
  });
});

describe('where_to_buy / where_to_sell', () => {
  it('sorts buy locations by lowest price', async () => {
    const ctx = makeTestContext();
    const result = await runTool(whereToBuyTool, ctx, { commodity: 'Laranite' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { terminals: Array<{ terminal: string; price: number }> };
    expect(data.terminals[0]).toMatchObject({ terminal: 'ArcCorp Mining Area 056', price: 7047 });
    const prices = data.terminals.map((t) => t.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it('sorts sell locations by highest price and respects max_results', async () => {
    const ctx = makeTestContext();
    const result = await runTool(whereToSellTool, ctx, { commodity: 'laranita', max_results: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { terminals: Array<{ price: number }>; total_terminals: number };
    expect(data.terminals).toHaveLength(5);
    expect(data.terminals[0]?.price).toBe(9100);
    expect(data.total_terminals).toBe(20);
  });

  it('filters by star system', async () => {
    const ctx = makeTestContext();
    const result = await runTool(whereToSellTool, ctx, { commodity: 'Laranite', system: 'Stanton' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meta.notes.join(' ')).toContain('Stanton');
  });
});

describe('price_history', () => {
  it('returns dated entries for an explicit terminal', async () => {
    const ctx = makeTestContext(NEWEST_HISTORY_REPORT + 3600);
    const result = await runTool(priceHistoryTool, ctx, {
      commodity: 'Laranite',
      terminal: 'TDD Area 18',
      days: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { series: Array<{ reports_in_window: number; entries: unknown[] }> };
    expect(data.series).toHaveLength(1);
    expect(data.series[0]?.reports_in_window).toBeGreaterThan(0);
  });

  it('notes when the window contains no reports', async () => {
    const ctx = makeTestContext(NEWEST_HISTORY_REPORT + 89 * 86_400);
    const result = await runTool(priceHistoryTool, ctx, {
      commodity: 'Laranite',
      terminal: 'TDD Area 18',
      days: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { series: Array<{ reports_in_window: number }> };
    expect(data.series[0]?.reports_in_window).toBe(0);
    expect(result.meta.notes.join(' ')).toContain('no reports within');
  });

  it('auto-selects the top 3 sell terminals when none is given', async () => {
    const ctx = makeTestContext(NEWEST_HISTORY_REPORT + 3600);
    const result = await runTool(priceHistoryTool, ctx, { commodity: 'Laranite' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { series: unknown[] };
    expect(data.series).toHaveLength(3);
    expect(result.meta.notes.join(' ')).toContain('top 3 terminals');
  });
});

describe('market_ranking', () => {
  it('ranks by spread with buy and sell terminals named', async () => {
    const ctx = makeTestContext();
    const result = await runTool(marketRankingTool, ctx, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      ranking: Array<{ spread_per_scu: number | null; best_buy: unknown; best_sell: unknown }>;
    };
    expect(data.ranking).toHaveLength(10);
    const spreads = data.ranking.map((r) => r.spread_per_scu ?? 0);
    expect(spreads).toEqual([...spreads].sort((a, b) => b - a));
    expect(data.ranking[0]?.best_buy).toBeTruthy();
    expect(data.ranking[0]?.best_sell).toBeTruthy();
  });

  it('supports top_sell ranking', async () => {
    const ctx = makeTestContext();
    const result = await runTool(marketRankingTool, ctx, { kind: 'top_sell', limit: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { ranking: Array<{ best_sell: { price: number } | null }> };
    expect(data.ranking).toHaveLength(3);
    const prices = data.ranking.map((r) => r.best_sell?.price ?? 0);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it('rejects invalid input explicitly', async () => {
    const ctx = makeTestContext();
    const result = await runTool(marketRankingTool, ctx, { kind: 'bogus' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });
});
