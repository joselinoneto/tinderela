import { describe, expect, it } from 'vitest';
import { buildBotTools } from '../src/bot/agent.js';
import { allTools } from '../src/tools/index.js';
import { makeTestContext } from './helpers/fake-context.js';

describe('buildBotTools', () => {
  it('wraps every registered MCP tool for the tool runner', () => {
    const tools = buildBotTools(makeTestContext());
    expect(tools.map((t) => t.name)).toEqual(allTools.map((t) => t.name));
    expect(tools).toHaveLength(14);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('executes a wrapped tool end to end and returns tool-result JSON', async () => {
    const tools = buildBotTools(makeTestContext());
    const whereToSell = tools.find((t) => t.name === 'where_to_sell');
    if (!whereToSell) throw new Error('where_to_sell not wrapped');

    const raw = await whereToSell.run({ commodity: 'laranita', max_results: 3 });
    const result = JSON.parse(raw as string) as {
      ok: boolean;
      data: { terminals: Array<{ price: number }> };
      meta: { game_version: string };
    };
    expect(result.ok).toBe(true);
    expect(result.data.terminals[0]?.price).toBe(9100);
    expect(result.meta.game_version).toBe('4.9');
  });

  it('returns explicit error JSON instead of throwing on bad input', async () => {
    const tools = buildBotTools(makeTestContext());
    const getPrice = tools.find((t) => t.name === 'get_commodity_price');
    if (!getPrice) throw new Error('get_commodity_price not wrapped');

    const raw = await getPrice.run({ commodity: 'xyzzyplugh' });
    const result = JSON.parse(raw as string) as { ok: boolean; error: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ENTITY_NOT_FOUND');
  });
});
