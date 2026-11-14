---
name: criador-de-skills
description: Use ao criar, revisar ou melhorar uma skill (SKILL.md) — gatilhos, estrutura, progressão de contexto e validação.
---

# Skill: Criador de skills

## Quando usar
Criar skill nova, ajustar a descrição/gatilhos de uma existente, ou decidir se um
procedimento deve virar skill.

## Anatomia de uma skill
```
nome-da-skill/
└── SKILL.md     # frontmatter + corpo
```
```markdown
---
name: nome-da-skill            # kebab-case, curto, único
description: Use quando ...    # gatilhos concretos; é o que decide o carregamento
---

# Título
## Quando usar / Quando NÃO usar
## Processo (passos numerados)
## Checklist de verificação
## Armadilhas
```

## Regras de autoria
1. **Uma skill = uma responsabilidade.** Se o título precisa de "e", divida.
2. **Description é gatilho, não resumo.** Escreva situações concretas do usuário
   ("quando ele pede X", "ao editar Y"). Sem gatilho, a skill nunca é carregada.
3. **Contexto mínimo primeiro:** objetivo, ações e restrições no topo; detalhe sob demanda.
4. **Imperativo e testável.** Cada passo deve ser executável e verificável.
5. **Diga cada fato uma vez.** Sem repetir a description no corpo.
6. **Bounded outputs:** devolva resultado curto + caminho/ID para detalhe; marque truncamento.
7. **Sem regra óbvia do ambiente** (ex.: "se o arquivo não existe, falhe") — o modelo aprende na hora.
8. **Segurança:** permissões, efeitos destrutivos e validação obrigatória aparecem **antes** da ação.

## Checklist de validação
- [ ] `name` em kebab-case e único
- [ ] `description` com gatilhos reais e "Use quando..."
- [ ] passos numerados e executáveis
- [ ] verificação explícita (como saber que funcionou)
- [ ] armadilhas listadas
- [ ] testei mentalmente: a description dispara na hora certa?

## Armadilhas
- Skill "enciclopédia" (longa e sem ação).
- Description vaga ("ajuda com código") → nunca carrega.
- Duplicar uma skill existente em vez de estendê-la.
- Escrever a skill sem testar o gatilho com 2–3 pedidos reais.
