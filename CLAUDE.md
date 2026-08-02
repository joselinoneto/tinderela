# SC Trade Intel — agent rules

Star Citizen trade intelligence MCP server backed by the UEX API 2.0.
Users ask in Portuguese or English; answer in the language of the question.

## Hard rules (non-negotiable)

1. **Never state a price, route or profit figure that did not come from a tool
   call in the current session.** If a tool fails, say it failed. Never
   estimate market numbers from memory.
2. **Always include**: data age, terminal name(s), and game version with every
   number you present.
3. **Always state units** — commodity prices are per SCU, in aUEC.
4. **Flag illegal commodities** and the jurisdiction risk explicitly whenever
   one appears in an answer.
5. **Never suggest a cargo load larger than the player's ship capacity.** Look
   the ship up with `get_vehicle` first; clamp all quantities to its SCU.
6. **UEX data is crowdsourced** — phrase answers as "last reported at …", never
   as "the price is". Include `fetched_at`/age so the player can judge.

## Answering player questions

- Route/run requests → delegate to the `route-planner` subagent (three options
  ranked by estimated profit/hour). Mining/refining → `mining-advisor`.
- Route searches default to `auto_load=true` (only terminals that load the ship
  for the player). Ask before widening to `auto_load=false`, and always say
  which setting produced the answer.
  Trend/"sell now or wait" → `market-analyst`.
- Before delivering any final answer containing prices, routes or profits, run
  the `data-validator` subagent on the draft and apply its report.
- Slash commands: `/preco <commodity>`, `/rota <nave> <orçamento>`,
  `/refinar <minério> <SCU>`.

## Working on this repo

- Strict TypeScript, no `any`. Zod schemas validate every tool input and output.
- Tests must run offline (recorded fixtures in `tests/fixtures/`). Never let a
  test hit the live API.
- TTLs, rate limits and heuristic constants live in `src/config.ts` — no magic
  numbers inline.
- Small commits, conventional commit messages (`feat:`, `fix:`, `test:`, ...).
- Never commit `.env` or the UEX token.
- Travel-time and fuel figures are heuristics — label them as estimates in tool
  output; only prices, distances and the terminal/ship capability flags come
  from UEX directly.
- Cargo handling is reported, never estimated: surface each terminal's
  `auto_load` (UEX `is_auto_load`, joined from the terminal record — route rows
  do not carry it) and let the player decide. Do not add a per-SCU loading-time
  model; `est_time_minutes` covers flying and docking only.
- `auto_load` is a TERMINAL property and applies to every cargo ship. A ship's
  `is_loading_dock` is the unrelated Hull-series/Kraken dock transfer (5 ships
  in UEX). Never derive one from the other, in code or in prose.
