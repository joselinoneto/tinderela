# SC Trade Intel

An MCP (Model Context Protocol) server that answers Star Citizen traders'
questions about live commodity prices, trade routes, mining/refining and ship
logistics — in Portuguese or English — with grounded, verifiable numbers.

All market data comes from the [UEX API 2.0](https://uexcorp.space/api/documentation/).

## Data attribution

Market data © [UEX Corp](https://uexcorp.space) — community-crowdsourced Star
Citizen trade data. Prices are **per SCU, in aUEC**, and reflect the *last
report* submitted by players; they can be stale or wrong. Every answer produced
by this server includes the data age, terminal name and game version so you can
judge freshness yourself.

Please respect UEX quotas: 172,800 requests/day, 120 requests/minute. This
server enforces both with a local rate limiter and an SQLite cache.

## Setup

```bash
npm install
cp .env.example .env   # then paste your token from https://uexcorp.space/api/apps
npm test               # offline test suite (recorded fixtures)
npm run build
```

Register with Claude Code:

```bash
claude mcp add sc-trade-intel -- node /path/to/sc-trade-intel/dist/server.js
```

## Tools

| Group | Tools |
| --- | --- |
| Prices | `resolve_entity`, `get_commodity_price`, `where_to_buy`, `where_to_sell`, `price_history`, `market_ranking` |
| Routes | `find_best_routes`, `distance_between`, `fuel_cost_estimate`, `get_vehicle` |
| Mining | `raw_ore_prices`, `refinery_advisor` |
| Trust | `data_freshness`, `set_price_alert` |

All tools return structured JSON with a `meta` block (data age in seconds,
`fetched_at` timestamp, game version, source terminal names). Errors are
explicit objects, never silent fallbacks.

## Caching

SQLite (`better-sqlite3`), TTL per data class (configured in `src/config.ts`):
prices/routes ~15 min, terminals/distances/vehicles/refineries ~7 days, static
reference data ~30 days. Every cached record stores `fetched_at`.

## Personal market scanner (no LLM)

Scan every tradeable commodity's routes for your ship and budget and print
the top table — pure TypeScript, zero tokens, ~6 s cold / ~0.1 s while the
15-minute cache is warm:

```bash
npm run scan -- --ship C2 --budget 800000
npm run scan -- --ship Caterpillar --budget 2500000 --top 15 --sort profit
npm run scan -- --ship C2 --budget 800000 --from "Area 18" --illegal
```

Sort keys: `hour` (est. profit/hour, default) | `profit` | `roi` | `scu` | `gm`.
Rows are flagged `⚠ILLEGAL` and `!old-gv` (report from an older game version);
time and profit/hour columns are heuristics (constants in `src/config.ts`).

## Discord bot

`src/bot/` runs a Discord bot that answers free-text questions (PT/EN) by
driving the same 14 tools through the Anthropic SDK tool runner — no MCP
transport involved; the tools are called in-process. The CLAUDE.md hard rules
ship as its system prompt.

```bash
# .env needs: DISCORD_BOT_TOKEN, ANTHROPIC_API_KEY (plus UEX_API_TOKEN)
npm run bot
```

Setup: create an app + bot at https://discord.com/developers/applications,
enable the **Message Content** intent, invite it with the `bot` scope +
Send Messages permission, and put the token in `.env`. The bot answers when
mentioned (`@SC Trade Intel qual o preço da laranita?`) or in DMs, with a
30-second per-user cooldown. It uses its own cache file (`bot-cache.db`) so it
never contends with a local Claude Code session.

## Deploying the bot to a Raspberry Pi

### On the Pi itself

Everything runs from a clone of this repo on the Pi — no dev machine involved:

```bash
git clone https://github.com/joselinoneto/tinderela.git
cd tinderela
cp .env.example .env
nano .env                                          # the three tokens
docker compose up -d --build
docker compose logs -f
```

The Pi builds its own image (native, no emulation) — a couple of minutes on a
Pi 4/5, considerably longer on a Pi 3, where `better-sqlite3` compiles from
source. Later updates are `git pull` then the same `up -d --build`.

### From a dev machine

```bash
./scripts/deploy-pi.sh pi@raspberrypi.local     # Git Bash on Windows
```

The image never goes to a registry and the tokens never enter it: the first run
copies `.env.example` to `~/sc-trade-intel/.env` on the Pi and stops so you can
fill in `UEX_API_TOKEN`, `ANTHROPIC_API_KEY` and `DISCORD_BOT_TOKEN` there. Then
re-run — the build is cached and it goes straight to starting the bot.

Two build modes, picked automatically (force with `BUILD=remote|local`):

| Mode | What happens | When |
| --- | --- | --- |
| `remote` | the local docker CLI drives the Pi's engine over ssh (`DOCKER_HOST=ssh://…`) and the Pi builds its own image natively | default; no local docker engine needed, just the CLI |
| `local` | buildx cross-builds under QEMU here and streams the image over ssh (`docker load`) | when a local engine is running; keeps the work off a small Pi |

A Pi 4/5 builds this in a couple of minutes; on a Pi 3 prefer `BUILD=local`,
where the platform is auto-detected from the Pi's `uname -m` (override with
`PLATFORM`). Compose v2 and the old standalone v1 are both supported.

Troubleshooting:

- **`set PI_HOST, e.g. …`** — pass the ssh destination as the first argument.
  PowerShell has no `VAR=value command` prefix, so `PI_HOST=… ./deploy-pi.sh`
  only works in bash.
- **`pull access denied for sc-trade-intel-bot`** — compose only pulls when the
  image is missing on the Pi, i.e. the deploy script never finished loading it.
  Re-run the script; don't run `docker compose up -d` on the Pi by hand before
  the first successful deploy.
- **`DISCORD_BOT_TOKEN is not set` in a restart loop** — the `.env` on the Pi
  has CRLF endings, so each value ends in a carriage return. The script strips
  them when it copies the file; if you edited `.env` from Windows, run
  `sed -i 's/\r$//' ~/sc-trade-intel/.env` on the Pi.

## Development

```bash
npm run test:watch      # vitest
npm run smoke           # live smoke test against the UEX API (needs token)
npm run record-fixtures # refresh recorded API fixtures (needs token)
```

No UI in phase 1 — the tool boundary is transport-agnostic so a Discord bot
can consume the same server later.
