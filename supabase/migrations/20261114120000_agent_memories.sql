-- Memória compartilhada do agente do MULT-CHAT-HUB lite (ferramentas memory_save / memory_search).
-- NÃO aplicada automaticamente. Revise e aplique manualmente (SQL Editor ou `supabase db push`).
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) between 1 and 4000),
  tags text[] not null default '{}',
  source text not null default 'mult-chat-hub-lite',
  created_at timestamptz not null default now()
);

create index if not exists agent_memories_created_at_idx on public.agent_memories (created_at desc);

-- RLS ligado e sem policies: anon/authenticated ficam bloqueados.
-- Só o servidor local, com SUPABASE_SERVICE_ROLE_KEY no apps/lite/.env.local, lê e grava.
alter table public.agent_memories enable row level security;
