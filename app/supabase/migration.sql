-- PromptBlueprint — Supabase Migration
-- Run this in the Supabase SQL Editor to create the required tables.

-- ──────────────────────────────────────────────
-- 1. Projects
-- ──────────────────────────────────────────────
create table if not exists public.projects (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  description text not null default '',
  model       text not null default 'GPT-4o',
  icon        text not null default 'schema',
  last_edited text not null default 'Just now',
  created_at  timestamptz not null default now()
);

-- ──────────────────────────────────────────────
-- 2. Prompt Nodes
-- ──────────────────────────────────────────────
create table if not exists public.prompt_nodes (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  type        text not null,
  label       text not null,
  icon        text not null default 'description',
  x           real not null default 0,
  y           real not null default 0,
  content     text not null default '',
  meta        jsonb not null default '{}',
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_prompt_nodes_project on public.prompt_nodes(project_id);

-- ──────────────────────────────────────────────
-- 3. Connections
-- ──────────────────────────────────────────────
create table if not exists public.connections (
  id            text primary key default gen_random_uuid()::text,
  project_id    text not null references public.projects(id) on delete cascade,
  from_node_id  text not null references public.prompt_nodes(id) on delete cascade,
  to_node_id    text not null references public.prompt_nodes(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique(project_id, from_node_id, to_node_id)
);

create index if not exists idx_connections_project on public.connections(project_id);

-- ──────────────────────────────────────────────
-- 4. Prompt Versions
-- ──────────────────────────────────────────────
create table if not exists public.prompt_versions (
  id          text primary key default gen_random_uuid()::text,
  project_id  text not null references public.projects(id) on delete cascade,
  timestamp   bigint not null default extract(epoch from now())::bigint * 1000,
  content     text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_prompt_versions_project on public.prompt_versions(project_id);

-- ──────────────────────────────────────────────
-- 5. Row-Level Security (RLS)
--    Using publishable key = all rows visible.
--    Tighten when you add auth.
-- ──────────────────────────────────────────────
alter table public.projects        enable row level security;
alter table public.prompt_nodes    enable row level security;
alter table public.connections     enable row level security;
alter table public.prompt_versions enable row level security;

-- Allow full access with the publishable key (no auth required for now)
create policy "Allow all on projects"        on public.projects        for all using (true) with check (true);
create policy "Allow all on prompt_nodes"    on public.prompt_nodes    for all using (true) with check (true);
create policy "Allow all on connections"     on public.connections     for all using (true) with check (true);
create policy "Allow all on prompt_versions" on public.prompt_versions for all using (true) with check (true);
