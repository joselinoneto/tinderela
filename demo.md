# Demo — 10 real player questions, real tool outputs

All answers below were produced from live UEX API calls on **2026-07-31**
(fetched ≈ 15:54 UTC, game version **4.9 LIVE**). Prices are **aUEC per SCU**
and are *last reported* community data — they may have changed by the time you
read this. Raw tool JSON was abbreviated for readability; numbers are verbatim.

---

## 1. EN — "I have a C2 Hercules and 800k aUEC at Area18, what's my best run?"

Tools: `get_vehicle("C2 Hercules")` → `find_best_routes(capacity_scu=696, budget_uec=800000)`

> Your **Crusader C2 Hercules Starlifter** hauls **696 SCU** (UEX vehicle data).
> With 800,000 aUEC your budget, not the hold, is the constraint today.
>
> Best run (legal cargo, all metrics from UEX route data, game version 4.9):
> **Audio-Visual Equipment** — buy at **Fallow Field (Pyro)** at 25,004/SCU,
> sell at **Shubin Mining Facility SAL-5 (Stanton)** at 46,000/SCU
> (last reported 2026-07-31 15:47 UTC, minutes before this query).
> - Load: **31 SCU** (budget-limited: 31 × 25,004 = 775,124 aUEC invested)
> - Profit: **650,876 aUEC** total, 20,996/SCU, **ROI 84.0%**
> - Distance 108 Gm; est. ~41 min → **~957k aUEC/hour** *(time and per-hour
>   figures are heuristic estimates: 10 Gm/min quantum + 15 min per stop)*
> - Note: reported supply at Fallow Field was 32 SCU — this run barely fits it,
>   and it crosses into Pyro (lawless space, gank risk is yours to price in).
>
> Runner-up: same cargo to **HDMS-Lathan** (46,000/SCU, 121 Gm, ~928k/h est.).
> Your C2 would be far from full — with a bigger bankroll this route scales
> hard. Data age: 0 s (fetched fresh for this answer).

## 2. PT — "Quanto tá a laranita?"

Tools: `get_commodity_price("laranita")` (resolvido via alias → **Laranite**)

> **Laranite (LARA)** — legal, negociada em 26 terminais (versão 4.9, dados
> UEX reportados por jogadores):
> - Melhor venda: **TDD Cloudview Center – Orison**: **9.100 aUEC/SCU**
>   (último reporte 2026-07-30 05:36 UTC)
> - **TDD Area 18**: 8.800 aUEC/SCU (reporte 2026-07-29 17:38 UTC)
> - **Admin – Ruin Station**: 8.700 aUEC/SCU (reporte 2026-07-29 22:32 UTC)
> - Melhor compra: **ArcCorp Mining Area 056**: 7.047 aUEC/SCU
>
> São preços *reportados* (crowdsourced) — o reporte de Orison tem ~1 dia.

## 3. PT — "Onde vendo Quantainium bruto?"

Tools: `raw_ore_prices(ore="Quantainium")`

> **Quantainium (Raw)** — melhores preços de venda reportados (aUEC/SCU):
> | Terminal | Preço | Último reporte |
> |---|---|---|
> | MIC-L5 | **54.996** | 2026-05-28 ⚠ |
> | Orbituary (Pyro) | 24.200 | 2025-12-20 ⚠ |
> | Checkmate (Pyro) | 14.980 | 2025-12-09 ⚠ |
>
> ⚠ Atenção: o topo da tabela tem reportes **de 2 meses ou mais** — preço de
> MIC-L5 pode estar desatualizado. Confirme no terminal antes de voar, e
> lembre que Quantainium bruto **degrada e explode** com o tempo: rota longa
> com carga instável é risco duplo.

## 4. EN — "Where's the cheapest place to buy Titanium in Stanton?"

Tools: `where_to_buy(commodity="Titanium", system="Stanton", max_results=5)`

> Cheapest **Titanium** buys in **Stanton** (aUEC/SCU, game version 4.9):
> 1. **Shubin Mining Facility SAL-5** (Lyria) — **6,699**, ~310 SCU stock reported (2026-07-24)
> 2. **Shubin Mining Facility SAL-2** (Lyria) — 6,699, ~100 SCU (2026-07-24)
> 3. **HDMS-Lathan** — 7,034, ~6,697 SCU (2026-07-27)
> 4. **HDMS-Bezdek** — 7,034, ~7,968 SCU (2026-07-27)
>
> SAL-5/SAL-2 are cheapest but stock-thin; for a big freighter the HDMS
> terminals reported deep stock at +335/SCU. Reports are 4–7 days old.

## 5. PT — "Vale a pena refinar 100 SCU de Quantainium no ARC-L1?"

Tools: `refinery_advisor(ore="Quantainium", quantity_scu=100, location="ARC-L1")`

> Comparação (dados UEX, aUEC/SCU):
> - **Vender bruto**: melhor terminal **MIC-L5** a 54.996/SCU → **5.499.600 aUEC**
>   pelos 100 SCU *(mas o reporte é de 28/05 — confirme antes)*.
> - **Refinado**: Quantainium refinado vende a **170.000/SCU** no
>   **TDD Cloudview Center – Orison** (reporte 2026-07-30).
> - **Ponto de equilíbrio: 0,324** — refinar ganha se você obtiver mais de
>   ~32,4 SCU refinados por 100 SCU brutos, antes das taxas. Rendimentos
>   típicos de Quantainium no jogo ficam bem acima disso, então refinar
>   normalmente compensa — mas a UEX **não fornece** rendimento absoluto,
>   taxa nem duração do job: o orçamento da refinaria no jogo é a palavra final.
> - **ARC-L1** (Refinement Processing): bônus de rendimento reportado **+3%**
>   (média mensal +3%), capacidade reportada 13.920.
> - Métodos com rendimento máximo (escala UEX 1–3): **Dinyx Solventation**
>   (barato, lento), Ferron Exchange, Pyrometric Chromalysis (caro, lento).

## 6. EN — "Should I sell my Gold now or wait?"

Tools: `where_to_sell("Gold")` + `price_history("Gold", days=30)`

> Current best: **31,000 aUEC/SCU** at **TDD Area 18** (last reported
> 2026-07-29) and **Admin – Pyro Gateway (Nyx)** (2026-07-26); TDD New Babbage
> pays 30,000.
>
> 30-day history: TDD Area 18 logged **8 reports, all at exactly 31,000** —
> zero variance. New Babbage showed 32,000 in mid-July before settling at
> 30,000. Gold's sell price is effectively flat this patch.
>
> **Verdict: sell now.** There is no volatility to wait out — 31,000 at TDD
> Area 18 *is* the ceiling in the current data, and waiting only risks a patch
> or a bad report. (Crowdsourced data, game version 4.9.)

## 7. PT — "Qual a distância entre o TDD de Area 18 e o de New Babbage?"

Tools: `distance_between("TDD Area 18", "TDD New Babbage")`

> **59 Gm** entre o TDD – Area 18 (ArcCorp) e o TDD – Commons – New Babbage
> (MicroTech), conforme reportado à UEX. No modelo heurístico do servidor
> (10 Gm/min de quantum + paradas), isso é ~6 min de voo quântico puro.

## 8. EN — "What are the biggest profit spreads on the market right now?"

Tools: `market_ranking(kind="spread", limit=5)`

> Widest buy→sell spreads (aUEC/SCU, computed from the full UEX price
> snapshot, fetched 15:54 UTC, cache age 3 s):
> | Commodity | Spread | Buy at | Sell at | Legal? |
> |---|---|---|---|---|
> | Osoian Hides | **586,500** | The Golden Riviera (283,500) | Devlin Scrap (870,000) | **⚠ ILLEGAL** |
> | Gasping Weevil Eggs | 38,592 | Fallow Field | Brio's Breaker | **⚠ ILLEGAL** |
> | Stileron | 37,150 | Bueno Ravine (122,850) | Levski (160,000) | legal |
> | Diamond Laminate | 32,120 | Canard View (66,880) | Levski (99,000) | legal |
> | Atlasium | 27,786 | — | — | legal |
>
> The two big ones are **illegal** — expect CrimeStat, scans and confiscation
> in UEE space. Spread ignores distance and supply; use a route query for an
> actionable plan.

## 9. PT — "Quanto gasto de combustível quântico num C2 de Area 18 até Orison?"

Tools: `fuel_cost_estimate("TDD Area 18", "TDD Orison", "C2")`

> Resposta honesta: **a UEX não tem o tanque quântico do C2 Hercules** no
> banco de veículos, então não dá para estimar o custo total sem chutar.
> O que os dados mostram: distância **42 Gm** (≈3,4% de um tanque típico pela
> heurística de 8%/100 Gm) e combustível quântico a **~1.552 aUEC/unidade**
> (média de mercado reportada; nenhum dos dois terminais reporta preço de
> combustível). Na prática: trecho curto, custo pequeno — mas o número exato
> a UEX não sustenta.

## 10. PT — "Me avisa se a Laranite passar de 9.000 no TDD de Area 18."

Tools: `set_price_alert(commodity="Laranite", terminal="TDD Area 18", threshold=9000, direction="above")`

> Alerta **#1** registrado: Laranite > 9.000 aUEC/SCU no TDD – Area 18.
> **Transparência**: o alerta está salvo apenas no banco local deste servidor —
> a entrega via webhook da UEX ainda não foi ligada, então **nenhuma
> notificação vai disparar por enquanto**. (Hoje, Orison já paga 9.100.)

---

### Data provenance for this file

`data_freshness()` at generation time: game version **4.9 live** / 4.10.0 PTU;
market snapshot of 2,597 price records, newest report 2026-07-31 15:34 UTC,
oldest 2025-03-14 (long tail of stale outposts — exactly why every answer
above carries its own report date).
