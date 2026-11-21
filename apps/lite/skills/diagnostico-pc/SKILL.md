---
name: diagnostico-pc
description: Use quando o usuário pedir para checar a saúde do PC (CPU, RAM, disco, uptime). Usa só ferramentas de leitura do Mestre do PC.
---

# Skill: Diagnóstico do PC

## Quando usar
- "Como está o PC?", "tá lento?", "quanto de RAM/disco livre?".

## Quando não usar
- Pedidos para limpar, otimizar ou rodar comandos: isso é execução, e a interface pede confirmação.

## Processo
1. Chame `mestre_system_status`.
2. Resuma CPU, RAM livre, disco livre e uptime em até 5 linhas.
3. Se algo estiver crítico (RAM livre < 10% ou disco C: < 10 GB), procure uma operação com
   `mestre_list_operations` (ex.: busca "temp" ou "memoria") e **sugira** o ID, sem executar.
4. Só chame `mestre_run_operation` ou `mestre_optimize_ram_and_temp` se o usuário pedir.

## Armadilhas
- Se o Mestre do PC estiver fora do ar, diga isso e não invente números.
- Números vêm da ferramenta; não arredonde para cima nem estime.
