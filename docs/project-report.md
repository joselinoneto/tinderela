# SC Trade Intel: Validating AI-Assisted Development Practices in a Personal Research Project

**Author:** José Neto\
**Date:** August 2026\
**Status:** Draft — research report\
**Repository:** sc-trade-intel (private)

---

## Abstract

This report documents a personal research project undertaken after completing Anthropic's courses on building with large language models. The objective was to validate, in a real and personally meaningful setting, a set of ideas taught in those courses: grounding model answers in tools rather than model memory, the Model Context Protocol (MCP) as an integration layer, multi-agent decomposition with restricted capabilities, model tiering by task, and AI-assisted software development as a working method. The chosen domain is the in-game commodity trading economy of Star Citizen, a game the author has been playing with a group of new friends for close to a year. The result is a working system — an MCP server backed by live community market data, a set of specialised subagents, and a Discord bot deployed on a Raspberry Pi — built end to end with Claude Code. The project is strictly for research and personal use. This report lists the ideas under validation, describes the implementation, and records early observations, limitations and future work.

---

## 1. Introduction and Motivation

Courses and documentation teach patterns in idealised settings. The purpose of this project was to test whether those patterns survive contact with a messy, real-world data source and a real user community — even a small one.

The domain was chosen deliberately. Star Citizen features a player-driven commodity economy: commodities are bought and sold at hundreds of terminals across a persistent universe, prices drift with game patches and player behaviour, and profitable trading depends on timely, accurate information. The data that exists is crowdsourced — players report prices to community services such as UEX Corp — which makes it plentiful but also stale, inconsistent and occasionally wrong. This is precisely the kind of data environment in which an ungrounded language model fails silently: it will produce plausible prices and routes from training data that are months or years out of date.

The author has been playing the game with a group of new friends for almost a year. The group's recurring practical questions — "where do I sell this ore", "what is the best run for my ship and budget", "should I sell now or wait" — provided a natural, well-scoped problem statement and a real audience for evaluation.

The project therefore serves two purposes at once:

1. **As a product experiment:** can an AI assistant answer traders' questions with numbers that are always traceable to a live data source, never invented?
2. **As a process experiment:** can the entire system be built with an AI coding agent (Claude Code), applying the practices taught in the Anthropic courses, and what does that working method look like in practice?

This is a research project. It is not affiliated with Cloud Imperium Games or UEX Corp, it is not commercial, and all market data is attributed to its source.

## 2. Background

### 2.1 The problem domain

Star Citizen's trade loop is simple to state and hard to optimise: buy a commodity where it is cheap, haul it in a ship with finite cargo capacity (measured in SCU), and sell it where it is expensive, in the game currency aUEC. Complications include terminal stock levels, illegal commodities with jurisdiction risk, whether a terminal loads cargo automatically or the player must move boxes manually, refining decisions for mined ore, and the constant drift of prices across game versions.

### 2.2 The data source

All market data comes from the UEX API 2.0, a community-run service with published quotas (172,800 requests/day, 120 requests/minute). The data is crowdsourced: each price is the last report submitted by a player, with a timestamp and a game version. Treating this data honestly — exposing its age and provenance instead of presenting it as ground truth — became one of the central design principles of the project.

### 2.3 The courses and the concepts under test

The project follows four Anthropic courses completed by the author:

1. **Introduction to Agent Skills** — packaging reusable, task-specific capabilities for an agent.
2. **Building with the Claude API** — direct API usage: tool use, the agentic tool-use loop, structured outputs, and model selection.
3. **Introduction to Model Context Protocol** — MCP as a standard protocol for exposing tools and resources to any compatible client.
4. **Claude Code in Action** — AI-assisted development: subagents, slash commands, project rules files, and the agent as the primary author of code.

From these courses, the project set out to exercise the following ideas:

- Tool use and grounding: the model should fetch facts through tools, not recall them (Course 2).
- MCP as a write-once integration layer serving multiple clients (Course 3).
- Agent decomposition: specialised subagents with deliberately restricted tool access, and reusable skills/commands for recurring requests (Courses 1 and 4).
- A verification step between draft answers and delivered answers (Course 4).
- Model tiering: assigning cheaper, faster models to mechanical tasks and stronger models to open-ended reasoning (Course 2).
- Structured outputs validated by schemas at every boundary (Course 2).
- AI-assisted development: the agent writes the code under explicit, checked-in project rules (Course 4).

## 3. Research Objectives: Ideas to Validate

Each idea is stated as a hypothesis with its validation criterion.

**H1 — Grounding eliminates invented market data.** An assistant that is required to obtain every price, route and profit figure from a tool call in the current session will not state stale or fabricated numbers. *Validation:* project rules forbid any market figure that did not come from a tool call; answers are audited against tool output; a validator agent checks drafts before delivery.

**H2 — Provenance metadata makes crowdsourced data usable.** If every answer carries data age, source terminal and game version, users can judge freshness themselves and trust the system more, not less, for admitting uncertainty. *Validation:* every tool returns a `meta` block (age in seconds, `fetched_at`, game version, terminal names); answers are phrased as "last reported at", never "the price is".

**H3 — MCP is a practical integration layer.** One server, written once, should serve multiple clients without modification. *Validation:* the same server is consumed by Claude Code (interactive sessions), by four subagents, and by a Discord bot using the Anthropic tool runner.

**H4 — Restricted-capability subagents improve reliability.** Giving each specialised agent only the tools its task requires (a route planner cannot touch refinery tools; a validator can only read freshness and history) reduces error surface and makes behaviour auditable. *Validation:* four subagents — `route-planner`, `mining-advisor`, `market-analyst`, `data-validator` — each with an explicit tool allowlist, exercised on real player questions.

**H5 — A validation gate catches errors a single pass does not.** Routing every draft answer that contains prices, routes or profits through a `data-validator` agent (which drops records from older game versions and flags suspicious price deviations) measurably improves answer quality. *Validation:* validator reports on real queries; recorded cases where the gate changed the delivered answer.

**H6 — Model tiering controls cost without hurting quality.** Mechanical checking can run on a small model while analytical work runs on a larger one. *Validation:* the validator runs on Haiku, the analyst agents on Sonnet; cost and answer quality observed in day-to-day use.

**H7 — Not every problem needs a model.** Where the task is deterministic, plain code is cheaper, faster and more reliable than any agent. *Validation:* a zero-LLM market scanner (`npm run scan`) covers the recurring "anything interesting today?" use case with no model in the loop.

**H8 — An agentic system can run on minimal consumer hardware.** The interactive assistant should be deployable where the friend group already is (Discord) on hardware the author already owns (a Raspberry Pi 3, 1 GB RAM). *Validation:* a Docker deployment with a cross-build pipeline and a memory cap; the bot running continuously for the group.

**H9 — AI-assisted development is viable end to end under explicit rules.** The entire codebase — client, cache, fourteen tools, agents, bot, deployment — can be built with Claude Code guided by a checked-in rules file (`CLAUDE.md`), with quality enforced by strict typing, schema validation and offline tests rather than by line-by-line human authorship. *Validation:* the project itself; the commit history; the defect record (Section 6).

## 4. Implementation

### 4.1 Architecture overview

The system is organised in layers, each independently testable:

1. **UEX client** (TypeScript): typed endpoints, a local rate limiter honouring the published quotas, retries, and an SQLite cache with per-data-class TTLs (prices and routes roughly 15 minutes; terminals, distances, vehicles and refineries roughly 7 days; static reference data roughly 30 days). Every cached record stores its `fetched_at` timestamp — provenance is preserved at the lowest layer, not reconstructed later.
2. **MCP server**: fourteen tools in four groups — prices (`resolve_entity`, `get_commodity_price`, `where_to_buy`, `where_to_sell`, `price_history`, `market_ranking`), routes (`find_best_routes`, `distance_between`, `fuel_cost_estimate`, `get_vehicle`), mining (`raw_ore_prices`, `refinery_advisor`) and trust (`data_freshness`, `set_price_alert`). All inputs and outputs are validated with Zod schemas; errors are explicit objects, never silent fallbacks. Entity resolution is bilingual, so players can ask in Portuguese or English.
3. **Agent layer**: the four subagents of H4/H5, each defined declaratively with a system prompt, a tool allowlist and a model assignment; plus three slash commands (`/preco`, `/rota`, `/refinar`) for the most common requests.
4. **Interfaces**: interactive Claude Code sessions; a Discord bot that answers free-text questions via the Anthropic tool runner, with per-user cooldowns, threaded conversations for follow-up context, and message splitting for Discord's length limits; and the zero-LLM scanner of H7.
5. **Deployment**: a multi-stage Docker build and a deploy script supporting two modes — building natively on the Pi, or cross-building locally under QEMU and streaming the image over SSH — with the SQLite cache on a persistent volume and a 512 MB memory cap.

### 4.2 Honesty constraints as design rules

Several implementation decisions exist purely to keep the system honest:

- Travel-time and fuel figures are heuristics and are labelled as estimates in the tool output itself; only prices, distances and capability flags come from UEX directly.
- Cargo handling is reported, never estimated: each terminal's auto-load flag is surfaced and the player decides what it means for their run. An earlier attempt to derive handling behaviour from ship properties produced a real defect (Section 6) and was replaced by this rule.
- Illegal commodities are flagged with jurisdiction risk whenever they appear.
- Suggested cargo loads are clamped to the ship's actual capacity, looked up per query.

### 4.3 Development method

The repository encodes its own working agreement in `CLAUDE.md`: strict TypeScript with no `any`, Zod validation at every boundary, tests that run offline against recorded fixtures (no test may hit the live API), all tunable constants in a single configuration module, small conventional commits, and secrets never committed. Claude Code performed the implementation under these rules; the rules file evolved as defects and ambiguities were discovered, functioning as the project's institutional memory.

## 5. Validation Approach

- **Offline test suite:** recorded fixtures allow the full tool surface to be tested deterministically without network access.
- **Live demonstrations:** a set of ten real player questions answered against live UEX data, recorded with their tool traces, serves as a qualitative benchmark (`demo.md`).
- **Field use:** the Discord bot is exposed to the friend group, whose questions are unscripted and bilingual — a small but genuine user study.
- **Defect journal:** bugs found in the field are recorded together with the rule change that prevents their recurrence.

## 6. Early Observations

*(Draft — to be expanded as evidence accumulates.)*

- Grounding (H1) and provenance (H2) work, but only if enforced structurally. The decisive mechanisms were rules the model cannot bypass — schemas, the validator gate, and tool output that carries its own metadata — rather than prompt-level exhortations.
- The documented behaviour of a community API and its actual behaviour differ. Several UEX endpoints behave differently from their documentation (history requiring a terminal parameter, a ranking endpoint returning empty results, inconsistent response shapes). Recording these quirks as durable notes proved necessary; rediscovering them each session is expensive.
- Restricted tool access (H4) caught category errors early: an agent that cannot call the wrong tool cannot produce the wrong class of answer.
- A representative field defect: the bot once told a pilot their ship could not be auto-loaded because it derived a terminal property from an unrelated ship property. The fix was not a code patch alone but a written rule separating the two concepts permanently — an example of H9's feedback loop between defects and checked-in rules.
- Deployment to constrained hardware (H8) surfaced an entire class of practical issues invisible in development: CPU architecture cross-builds, native-module compilation, CRLF corruption of secrets when deploying from Windows, and the absence of modern build tooling on the target. All were solvable; none were anticipated.

## 7. Limitations

- The underlying data is crowdsourced and can be stale or wrong; the system mitigates by exposing provenance, not by verifying prices independently.
- The user population is a single small friend group; observations are qualitative and anecdotal, not statistically meaningful.
- Travel-time, fuel and profit-per-hour figures are heuristic estimates by design.
- The project depends on the continued availability and terms of a community API and respects its quotas; it is not suitable for public operation at scale, and does not aim to be.
- As a single-author project built with a single vendor's tooling, conclusions about the development method (H9) may not generalise.

## 8. Future Work

- Quantify the validator gate: log accepted versus corrected drafts to measure H5 rather than illustrate it.
- Price-alert delivery through the Discord bot, closing the loop on the `set_price_alert` tool.
- Structured collection of the friend group's questions and satisfaction to strengthen the field-use evidence.
- Evaluate newer models in the tiering scheme (H6) as they become available, holding the task assignment methodology constant.

## 9. Conclusion

The project set out to test whether the practices taught in Anthropic's courses hold up in a personally meaningful, data-hostile, resource-constrained setting. In its current state the system demonstrates that they can: a grounded, provenance-carrying, multi-agent assistant runs continuously on a one-gigabyte single-board computer and answers a real community's questions in two languages, and the entire artefact was produced through AI-assisted development under explicit, evolving rules. The most transferable finding so far is structural: honesty in an AI system is a property of its architecture — schemas, restricted capabilities, provenance carried from the lowest layer, and verification gates — not of its prompts.

---

## Acknowledgements

Market data © UEX Corp, community-crowdsourced Star Citizen trade data. Star Citizen is a product of Cloud Imperium Games; this project is unaffiliated fan research. Built with Claude Code (Anthropic).
