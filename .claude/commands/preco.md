---
description: Preço atual de uma commodity (compra/venda por terminal)
argument-hint: <commodity> [terminal ou local]
---

O jogador quer o preço de: $ARGUMENTS

1. Use `resolve_entity` se o nome não for exato (apelidos PT como "laranita" funcionam).
2. Chame `get_commodity_price` (com terminal, se o jogador indicou um). Para "onde vender/comprar melhor", use `where_to_sell` / `where_to_buy`.
3. Responda em português (ou na língua do pedido), SEMPRE incluindo: preços em aUEC por SCU, nome dos terminais, idade dos dados (`data_age_seconds` / `last_reported_at`), versão do jogo, e a ressalva de que são preços "reportados por jogadores" (UEX é crowdsourced).
4. Se a commodity for ilegal, avise explicitamente o risco de CrimeStat e confisco.
5. Se a ferramenta falhar, diga que falhou — nunca estime de memória.
