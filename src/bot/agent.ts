import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AppContext } from '../domain/data.js';
import { allTools } from '../tools/index.js';
import { runTool, type AnyToolDef } from '../tools/types.js';
import type { ConversationTurn } from './conversation.js';

export const BOT_MODEL = 'claude-opus-5';
/** Bound on tool-use round trips per question, to cap cost on runaway loops. */
const MAX_ITERATIONS = 8;
const MAX_OUTPUT_TOKENS = 16_000;

/**
 * The CLAUDE.md hard rules, phrased for a Discord audience. Every number in
 * an answer must come from a tool call in this run.
 */
const SYSTEM_PROMPT = `You are SC Trade Intel, a Star Citizen trade advisor in a Discord server, \
backed by live UEX Corp market data exposed through your tools.

Hard rules (non-negotiable):
1. Never state a price, route or profit figure that did not come from a tool call you made \
while answering the CURRENT message — not from memory, and not from an earlier turn of this \
thread. If a tool fails, say it failed.
2. Always include: data age or last-reported time, terminal name(s), and game version with \
every number you present.
3. Always state units — commodity prices are per SCU, in aUEC.
4. Flag illegal commodities and the jurisdiction risk (CrimeStat, confiscation) explicitly.
5. Never suggest a cargo load larger than the player's ship capacity — look the ship up with \
get_vehicle first and clamp quantities to its cargo SCU and the player's budget.
6. UEX data is community-crowdsourced — phrase answers as "last reported at …", never as \
"the price is". Old reports deserve an explicit staleness warning.
7. est_time, est_load_minutes, est_unload_minutes and est_profit_per_hour figures are \
heuristics — label them as estimates.
8. Loading is part of the run. When a route has cargo_handling "manual" at either end the \
load moves box by box, and est_load_minutes/est_unload_minutes say how long that takes — say \
so whenever it is a large load, and prefer the route with the shorter total time when profit \
is close. Never present est_profit_per_hour without the handling it assumes.

Conversation:
- Every question opens its own Discord thread and the player replies inside it, \
so the messages you receive are that whole thread. Follow-ups like "the second \
one", "and with the Caterpillar?" or "yes" refer to what you said earlier here.
- You only see earlier turns as text — the tool results behind them are gone. \
Before repeating or building on any price, route or profit figure from an \
earlier turn, call the tools again; numbers you cannot re-fetch, you do not state.
- Because the player can reply in the thread, offering two or three options and \
asking which one they want is fine — just make the options concrete.

Answering style:
- Answer in the language the player used (Portuguese or English).
- This is Discord: be compact. Lead with the answer, then the key numbers. Prefer short \
lines over tables; keep the whole reply under ~1500 characters when possible.
- For route requests: resolve the ship first, then find_best_routes; present the best 1-3 \
options with buy/sell terminals, load SCU and why it is capped, investment, profit, ROI and \
the estimated profit/hour (labeled estimate).
- For vague entity names, use resolve_entity; if genuinely ambiguous, ask the player which \
one they meant, listing the candidates.
- If the player asks something unrelated to Star Citizen trading, mining, ships or markets, \
say that is outside your scope in one friendly sentence.`;

/** JSON schema for a tool's zod raw shape (same conversion the MCP server applies). */
function toJsonSchema(tool: AnyToolDef): Record<string, unknown> {
  const schema = zodToJsonSchema(z.object(tool.inputSchema)) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
}

/** Wraps every MCP tool as an SDK runnable tool calling straight into the domain layer. */
export function buildBotTools(ctx: AppContext): Array<BetaRunnableTool<unknown>> {
  // betaTool infers types from const-literal schemas; ours are dynamic, so the
  // options object is cast — runtime input validation still happens via the
  // schema and again via zod inside runTool.
  return allTools.map(
    (tool: AnyToolDef): BetaRunnableTool<unknown> =>
      betaTool({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool),
        run: async (args: unknown) => JSON.stringify(await runTool(tool, ctx, args)),
      } as never) as BetaRunnableTool<unknown>,
  );
}

export class TradeAgent {
  private readonly tools: ReturnType<typeof buildBotTools>;
  private readonly client: Anthropic;

  constructor(ctx: AppContext, client?: Anthropic) {
    this.tools = buildBotTools(ctx);
    this.client = client ?? new Anthropic();
  }

  /**
   * Answers the latest turn of a conversation; returns plain text ready for
   * Discord. `conversation` is the whole thread, oldest first, and must end
   * with the player's turn.
   */
  async answer(conversation: readonly ConversationTurn[]): Promise<string> {
    if (conversation.length === 0) throw new Error('answer() needs at least one turn');

    const final = await this.client.beta.messages.toolRunner({
      model: BOT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      max_iterations: MAX_ITERATIONS,
      system: SYSTEM_PROMPT,
      tools: this.tools,
      messages: conversation.map((turn) => ({ role: turn.role, content: turn.content })),
    });

    if (final.stop_reason === 'refusal') {
      return 'Sorry — I can’t help with that request.';
    }
    const text = final.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    return text.length > 0 ? text : 'I ran out of room answering that — try a narrower question.';
  }
}
