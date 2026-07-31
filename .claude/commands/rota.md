---
description: Melhor rota de comércio para sua nave e orçamento
argument-hint: <nave> <orçamento> [local de partida]
---

O jogador quer uma rota de comércio: $ARGUMENTS

Delegue ao subagente `route-planner` com tudo o que o jogador informou (nave, orçamento em aUEC, localização atual, tolerância a risco). O route-planner deve:

- confirmar a capacidade da nave com `get_vehicle` antes de qualquer cálculo;
- retornar três opções (segura / equilibrada / agressiva) ordenadas por lucro estimado por hora — deixando claro que tempo e lucro/hora são estimativas heurísticas;
- mostrar investimento, lucro total, lucro por SCU, ROI, distância, idade dos dados e versão do jogo em cada opção.

Se faltar nave ou orçamento, pergunte antes de rodar. Responda na língua do jogador.
