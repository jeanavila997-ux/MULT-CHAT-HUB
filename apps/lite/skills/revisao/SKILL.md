---
name: revisao
description: Use ao revisar um branch, PR, commit ou mudanças em andamento. Revisão em dois eixos (Standards e Spec) sempre separados, mais baseline de code smells.
---

# Skill: Revisão de código

## Quando usar
"revise isso", "review do PR", "revise desde X", revisão de mudanças antes de merge.

## Ponto fixo
- Descubra contra o que comparar: commit, branch, tag ou `main`.
- Confirme que resolve: `git rev-parse <ref>`.
- Diff: `git diff <ref>...HEAD` (três pontos, contra o merge-base).
- Diff vazio ou ref inválida → pare e avise; não siga.

## Dois eixos — nunca misture
**A) Standards** — o código segue as convenções documentadas do repositório?
- Fontes: `CODING_STANDARDS.md`, `CONTRIBUTING.md`, docs de estilo.
- Cite arquivo + regra violada; o padrão do repo vence o baseline.
- Ignore o que tooling já garante (lint/formatter).

**B) Spec** — o código entrega o que o chamado/spec pedia?
- Requisitos faltantes ou parciais.
- Comportamento não pedido (scope creep).
- Requisito implementado, mas errado.

## Baseline de smells (julgamento, nunca violação dura)
Nome confuso · código duplicado · feature envy · data clumps · primitive obsession ·
switches repetidos · shotgun surgery · divergent change · generalidade especulativa ·
message chains · middle man · refused bequest.
Formato: "possível <smell>" + trecho citado + como corrigir.

## Saída
- Seções separadas `## Standards` e `## Spec`.
- Não mescle nem reranqueie os eixos.
- Resumo de uma linha: total por eixo e o pior item **de cada** eixo.
