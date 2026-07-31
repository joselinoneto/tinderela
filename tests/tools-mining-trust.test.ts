import { describe, expect, it } from 'vitest';
import { rawOrePricesTool, refineryAdvisorTool } from '../src/tools/mining.js';
import { dataFreshnessTool, setPriceAlertTool } from '../src/tools/trust.js';
import { runTool } from '../src/tools/types.js';
import { makeTestContext } from './helpers/fake-context.js';

describe('raw_ore_prices', () => {
  it('matches raw variants from the refined name and sorts by sell price', async () => {
    const ctx = makeTestContext();
    const result = await runTool(rawOrePricesTool, ctx, { ore: 'Quantainium' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { prices: Array<{ commodity: string; price_sell: number }> };
    expect(data.prices.length).toBeGreaterThan(0);
    expect(data.prices.every((p) => p.commodity === 'Quantainium (Raw)')).toBe(true);
    const sells = data.prices.map((p) => p.price_sell);
    expect(sells).toEqual([...sells].sort((a, b) => b - a));
  });

  it('returns the full raw board when no ore is given', async () => {
    const ctx = makeTestContext();
    const result = await runTool(rawOrePricesTool, ctx, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { prices: unknown[] };
    expect(data.prices.length).toBeGreaterThan(100);
  });
});

describe('refinery_advisor', () => {
  it('compares selling raw vs refining with break-even ratio and yields', async () => {
    const ctx = makeTestContext();
    const result = await runTool(refineryAdvisorTool, ctx, { ore: 'Quantainium', quantity_scu: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      ore: { raw: string; refined: string };
      sell_raw: { price_per_scu: number; revenue_for_quantity: number };
      sell_refined_reference: { price_sell: number };
      break_even_refined_ratio: number;
      refineries: Array<{ yield_bonus_percent: number }>;
      methods: Array<{ rating_yield: number }>;
    };
    expect(data.ore.raw).toBe('Quantainium (Raw)');
    expect(data.ore.refined).toBe('Quantainium');
    expect(data.sell_raw.revenue_for_quantity).toBe(data.sell_raw.price_per_scu * 50);
    expect(data.break_even_refined_ratio).toBeCloseTo(
      data.sell_raw.price_per_scu / data.sell_refined_reference.price_sell,
      2,
    );
    expect(data.refineries.length).toBeGreaterThan(0);
    expect(data.methods).toHaveLength(9);
    expect(result.meta.notes.join(' ')).toContain('1–3 scales');
  });

  it('filters yields to a named refinery location', async () => {
    const ctx = makeTestContext();
    const result = await runTool(refineryAdvisorTool, ctx, {
      ore: 'Quantainium',
      quantity_scu: 10,
      location: 'ARC-L1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { refineries: Array<{ terminal: string }> };
    expect(data.refineries).toHaveLength(1);
    expect(data.refineries[0]?.terminal).toContain('ARC-L1');
  });
});

describe('data_freshness', () => {
  it('reports game versions and snapshot freshness', async () => {
    const ctx = makeTestContext();
    const result = await runTool(dataFreshnessTool, ctx, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      game_version_live: string;
      price_snapshot: { records: number; newest_report_at: string };
    };
    expect(data.game_version_live).toBe('4.9');
    expect(data.price_snapshot.records).toBe(2597);
    expect(data.price_snapshot.newest_report_at).toMatch(/^\d{4}-/);
  });
});

describe('set_price_alert', () => {
  it('persists the alert and reports it as a local stub', async () => {
    const ctx = makeTestContext();
    const result = await runTool(setPriceAlertTool, ctx, {
      commodity: 'Laranite',
      terminal: 'TDD Area 18',
      threshold: 9000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { alert_id: number; status: string; direction: string };
    expect(data.alert_id).toBeGreaterThan(0);
    expect(data.status).toBe('stored_locally');
    expect(data.direction).toBe('above');

    const row = ctx.db.prepare('SELECT * FROM alerts WHERE id = ?').get(data.alert_id) as {
      id_commodity: number;
      threshold: number;
    };
    expect(row.id_commodity).toBe(47);
    expect(row.threshold).toBe(9000);
    expect(result.meta.notes.join(' ')).toContain('webhook');
  });
});
