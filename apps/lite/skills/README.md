# Skills do agente local

Uma skill é uma pasta com um arquivo `SKILL.md`:

```
apps/lite/skills/
  minha-skill/
    SKILL.md
```

O `SKILL.md` começa com um frontmatter:

```markdown
---
name: minha-skill
description: Use quando <gatilho concreto>. Uma frase dizendo quando o agente deve usar.
---

# Skill: Minha skill

## Quando usar
...

## Processo
1. ...
```

- `name`: letras, números, `-` ou `_` (até 64 caracteres). Se faltar, vale o nome da pasta.
- `description`: entra no prompt do agente (até 300 caracteres). Escreva o gatilho.
- O corpo só é lido quando o agente chama a ferramenta `load_skill`.

## Onde o servidor procura

`SKILLS_DIRS` no `apps/lite/.env.local`, pastas separadas por `;` (relativas a `apps/lite`):

```
SKILLS_DIRS="skills;C:/Users/Jean/.ollama/agente-model-file/skills"
```

Se duas pastas tiverem uma skill com o mesmo nome, a da pasta que vem **depois** ganha.
Vazio = só `apps/lite/skills`. Os arquivos são apenas lidos, nunca alterados.

As skills aparecem no painel lateral ("Skills e ferramentas do agente") e na ferramenta `list_skills`.
Não precisa reiniciar o app: a lista é relida a cada mensagem.
