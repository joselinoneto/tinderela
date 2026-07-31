import { z } from 'zod';
import {
  getCommodities,
  getCommodityPrices,
  getRawPricesAll,
  getRefineryCapacities,
  getRefineryMethods,
  getRefineryYields,
  type AppContext,
} from '../domain/data.js';
import { normalize, resolveEntity } from '../domain/resolve.js';
import type { Commodity } from '../uex/types.js';
import { isoFromEpoch, requireEntity } from './helpers.js';
import { defineTool, fail, metaFromCache, ok } from './types.js';
import type { EntityCandidate } from '../domain/resolve.js';

const METHOD_RATING_NOTE =
  'refining method ratings are UEX 1–3 scales: higher rating_yield = more output, higher rating_cost = more expensive, higher rating_speed = faster; UEX does not publish absolute yield/cost/duration figures';

/** Base name without the "(Raw)" / "(Ore)" suffix, for matching raw variants. */
function baseName(name: string): string {
  return normalize(name.replace(/\s*\((raw|ore)\)\s*$/i, ''));
}

/**
 * Finds the raw and refined variants for a resolved commodity using the
 * id_parent link (e.g. Quantainium 58 <-> Quantainium (Raw) 59).
 */
function rawAndRefined(
  resolved: EntityCandidate,
  commodities: Commodity[],
): { raw: Commodity | null; refined: Commodity | null } {
  const self = commodities.find((c) => c.id === resolved.id) ?? null;
  if (!self) return { raw: null, refined: null };
  const linked = commodities.find((c) => c.id === self.id_parent || c.id_parent === self.id) ?? null;
  const raw = self.is_raw === 1 ? self : linked && linked.is_raw === 1 ? linked : null;
  const refined = self.is_raw === 0 ? self : linked && linked.is_raw === 0 ? linked : null;
  return { raw, refined };
}

export const rawOrePricesTool = defineTool({
  name: 'raw_ore_prices',
  description:
    'Last reported prices (aUEC per SCU) for raw/unrefined ores at refinery and trade terminals, optionally filtered by ore or terminal.',
  inputSchema: {
    ore: z.string().min(1).optional().describe('Ore name, raw or refined form (e.g. "Quantainium")'),
    terminal: z.string().min(1).optional(),
  },
  handler: async (ctx, input) => {
    const cached = await getRawPricesAll(ctx);
    let rows = cached.data;
    const notes = ['prices are aUEC per SCU of RAW material, as last reported to UEX'];

    if (input.ore) {
      const ore = await requireEntity(ctx, input.ore, 'commodity');
      if ('error' in ore) return ore.error;
      const base = baseName(ore.entity.name);
      rows = rows.filter((r) => r.id_commodity === ore.entity.id || baseName(r.commodity_name) === base);
      if (rows.length === 0) return fail('NO_DATA', `no raw prices reported for ${ore.entity.name}`);
      notes.push(`filtered to ${ore.entity.name} (raw variants matched by name)`);
    }
    if (input.terminal) {
      const terminal = await requireEntity(ctx, input.terminal, 'terminal');
      if ('error' in terminal) return terminal.error;
      rows = rows.filter((r) => r.id_terminal === terminal.entity.id);
      if (rows.length === 0) return fail('NO_DATA', 'that terminal reports no raw ore prices');
    }

    const sorted = [...rows].sort((a, b) => b.price_sell - a.price_sell);
    return ok(
      {
        unit: 'aUEC/SCU',
        prices: sorted.map((r) => ({
          commodity: r.commodity_name,
          terminal: r.terminal_name,
          terminal_id: r.id_terminal,
          price_sell: r.price_sell,
          price_buy: r.price_buy,
          last_reported_at: isoFromEpoch(r.date_modified),
        })),
      },
      { ...metaFromCache(cached), notes },
    );
  },
});

export const refineryAdvisorTool = defineTool({
  name: 'refinery_advisor',
  description:
    'Compares selling an ore raw versus refining it: raw/refined prices, per-refinery yield bonuses, method ratings and the break-even refined yield.',
  inputSchema: {
    ore: z.string().min(1).describe('Ore name, e.g. "Quantainium"'),
    quantity_scu: z.number().min(0.01).describe('Raw quantity in SCU'),
    location: z.string().min(1).optional().describe('Refinery location filter, e.g. "ARC-L1"'),
  },
  handler: async (ctx, input) => {
    const resolved = await requireEntity(ctx, input.ore, 'commodity');
    if ('error' in resolved) return resolved.error;
    const commodities = await getCommodities(ctx);
    const { raw, refined } = rawAndRefined(resolved.entity, commodities.data);
    if (!raw) {
      return fail('NO_DATA', `${resolved.entity.name} has no raw variant in UEX — nothing to refine`);
    }

    const [rawPrices, yields, capacities, methods] = await Promise.all([
      getRawPricesAll(ctx),
      getRefineryYields(ctx),
      getRefineryCapacities(ctx),
      getRefineryMethods(ctx),
    ]);

    const rawRows = rawPrices.data
      .filter((r) => r.id_commodity === raw.id && r.price_sell > 0)
      .sort((a, b) => b.price_sell - a.price_sell);
    const bestRaw = rawRows[0] ?? null;

    let refinedBest: { terminal: string; price_sell: number; last_reported_at: string | null } | null = null;
    if (refined) {
      const refinedPrices = await getCommodityPrices(ctx, refined.id);
      const best = [...refinedPrices.data]
        .filter((r) => r.price_sell > 0)
        .sort((a, b) => b.price_sell - a.price_sell)[0];
      if (best) {
        refinedBest = {
          terminal: best.terminal_name,
          price_sell: best.price_sell,
          last_reported_at: isoFromEpoch(best.date_modified),
        };
      }
    }

    let yieldRows = yields.data.filter((y) => y.id_commodity === raw.id);
    const notes = [
      'prices are aUEC per SCU',
      'yield_bonus_percent is the reported deviation from baseline yield at that refinery (UEX crowdsourced)',
      METHOD_RATING_NOTE,
    ];
    if (input.location) {
      // A location like "ARC-L1" names a station with several terminals, so
      // intersect every plausible terminal with the yield data instead of
      // demanding a unique terminal match.
      const { candidates } = await resolveEntity(ctx, input.location, 'terminal', 15);
      const ids = new Set(candidates.filter((c) => c.score >= 0.75).map((c) => c.id));
      const filtered = yieldRows.filter((y) => ids.has(y.id_terminal));
      if (filtered.length > 0) {
        yieldRows = filtered;
        notes.push(`yield data filtered to refineries matching "${input.location}"`);
      } else {
        notes.push(
          `no refinery matching "${input.location}" reports yield data for ${raw.name}; showing all refineries instead`,
        );
      }
    }

    const capacityByTerminal = new Map(capacities.data.map((c) => [c.id_terminal, c.value]));
    const rawRevenue = bestRaw ? Math.round(bestRaw.price_sell * input.quantity_scu) : null;
    const breakEvenRatio =
      bestRaw && refinedBest ? Math.round((bestRaw.price_sell / refinedBest.price_sell) * 1000) / 1000 : null;
    if (breakEvenRatio !== null) {
      notes.push(
        `break_even_refined_ratio: refining beats selling raw if you get more than ${breakEvenRatio} SCU of refined output per SCU of raw input (before refinery fees)`,
      );
    }

    return ok(
      {
        ore: { raw: raw.name, refined: refined?.name ?? null, quantity_scu: input.quantity_scu },
        sell_raw: bestRaw
          ? {
              best_terminal: bestRaw.terminal_name,
              price_per_scu: bestRaw.price_sell,
              revenue_for_quantity: rawRevenue,
              last_reported_at: isoFromEpoch(bestRaw.date_modified),
              other_terminals: rawRows.slice(1, 5).map((r) => ({
                terminal: r.terminal_name,
                price_sell: r.price_sell,
              })),
            }
          : null,
        sell_refined_reference: refinedBest,
        break_even_refined_ratio: breakEvenRatio,
        refineries: yieldRows
          .sort((a, b) => b.value - a.value)
          .map((y) => ({
            terminal: y.terminal_name,
            terminal_id: y.id_terminal,
            star_system: y.star_system_name,
            yield_bonus_percent: y.value,
            yield_bonus_percent_month_avg: y.value_month,
            capacity_reported: capacityByTerminal.get(y.id_terminal) ?? null,
            last_reported_at: isoFromEpoch(y.date_modified),
          })),
        methods: methods.data.map((m) => ({
          name: m.name,
          code: m.code,
          rating_yield: m.rating_yield,
          rating_cost: m.rating_cost,
          rating_speed: m.rating_speed,
        })),
      },
      { ...metaFromCache(yields), notes },
    );
  },
});

export const miningTools = [rawOrePricesTool, refineryAdvisorTool];
