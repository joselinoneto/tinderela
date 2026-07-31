import { z } from 'zod';
import { getGameVersions, getPricesAll } from '../domain/data.js';
import { isoFromEpoch, requireEntity } from './helpers.js';
import { defineTool, metaFromCache, ok } from './types.js';

export const dataFreshnessTool = defineTool({
  name: 'data_freshness',
  description:
    'Current supported game version and how fresh the UEX market snapshot is; call this when the user doubts the data.',
  inputSchema: {},
  handler: async (ctx) => {
    const [versions, pricesAll] = await Promise.all([getGameVersions(ctx), getPricesAll(ctx)]);

    let newest = 0;
    let oldest = Number.MAX_SAFE_INTEGER;
    for (const row of pricesAll.data) {
      if (row.date_modified > newest) newest = row.date_modified;
      if (row.date_modified > 0 && row.date_modified < oldest) oldest = row.date_modified;
    }

    const quotaRow = ctx.db
      .prepare('SELECT count FROM daily_requests WHERE date_key = ?')
      .get(new Date(ctx.now() * 1000).toISOString().slice(0, 10)) as { count: number } | undefined;

    return ok(
      {
        game_version_live: versions.data.live,
        game_version_ptu: versions.data.ptu,
        price_snapshot: {
          records: pricesAll.data.length,
          newest_report_at: isoFromEpoch(newest),
          oldest_report_at: oldest === Number.MAX_SAFE_INTEGER ? null : isoFromEpoch(oldest),
          cache_age_seconds: pricesAll.ageSeconds,
        },
        uex_requests_today: quotaRow?.count ?? 0,
      },
      {
        ...metaFromCache(pricesAll),
        game_version: versions.data.live,
        notes: ['UEX data is community-crowdsourced; individual terminals can be staler than the snapshot newest_report_at'],
      },
    );
  },
});

export const setPriceAlertTool = defineTool({
  name: 'set_price_alert',
  description:
    'Registers a local price alert for a commodity at a terminal (stored in this server; UEX webhook delivery is not wired up yet).',
  inputSchema: {
    commodity: z.string().min(1),
    terminal: z.string().min(1),
    threshold: z.number().min(0).describe('Price threshold in aUEC per SCU'),
    direction: z.enum(['above', 'below']).default('above'),
  },
  handler: async (ctx, input) => {
    const commodity = await requireEntity(ctx, input.commodity, 'commodity');
    if ('error' in commodity) return commodity.error;
    const terminal = await requireEntity(ctx, input.terminal, 'terminal');
    if ('error' in terminal) return terminal.error;

    const result = ctx.db
      .prepare(
        'INSERT INTO alerts (id_commodity, id_terminal, threshold, direction, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(commodity.entity.id, terminal.entity.id, input.threshold, input.direction, ctx.now());

    return ok(
      {
        alert_id: Number(result.lastInsertRowid),
        commodity: commodity.entity.name,
        terminal: terminal.entity.name,
        threshold_uec_per_scu: input.threshold,
        direction: input.direction,
        status: 'stored_locally',
      },
      {
        notes: [
          'alert persisted in the local SQLite database only — UEX webhook notification delivery is a planned follow-up, so nothing will fire yet',
        ],
      },
    );
  },
});

export const trustTools = [dataFreshnessTool, setPriceAlertTool];
