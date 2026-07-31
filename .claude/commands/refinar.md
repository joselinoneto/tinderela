---
description: Vale a pena refinar? Compara vender bruto vs refinar
argument-hint: <minério> <quantidade SCU> [local]
---

O jogador quer decidir entre refinar ou vender bruto: $ARGUMENTS

Delegue ao subagente `mining-advisor` com o minério, a quantidade em SCU e o local (se informado). O mining-advisor deve:

- usar `refinery_advisor` e explicar o `break_even_refined_ratio` em linguagem simples;
- mostrar melhor terminal para vender bruto (preço aUEC/SCU e total), referência do refinado, bônus de rendimento por refinaria e ratings dos métodos (escala UEX 1–3);
- deixar claro o que a UEX NÃO fornece (rendimento absoluto, taxas e duração do job — o orçamento da refinaria no jogo é a fonte final);
- avisar sobre a volatilidade do Quantainium quando for o caso.

Se faltar quantidade, pergunte. Responda na língua do jogador, sempre com idade dos dados e versão do jogo.
