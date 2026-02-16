-- Reconcile Supabase schema for PromptBuilder/Spoqen app.
-- Safe to run repeatedly.
-- Policies require an authenticated user (including anonymous auth users).
--
-- What this migration does:
-- 1) Archives legacy tables from the previous project by renaming them.
-- 2) Creates the tables used by this app:
--      projects, prompt_nodes, connections, prompt_versions
-- 3) Enables RLS and adds owner-scoped policies.

begin;

create extension if not exists pgcrypto;

-- Archive legacy tables so old data is preserved but does not conflict with the app schema.
do $$
declare
  suffix text := to_char(now(), 'YYYYMMDDHH24MISS');
  archived_name text;
begin
  -- Legacy projects table has updated_at and no last_edited column.
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'projects'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'last_edited'
  ) then
    archived_name := format('projects_legacy_%s', suffix);
    execute format('alter table public.projects rename to %I', archived_name);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'prompts') then
    archived_name := format('prompts_legacy_%s', suffix);
    execute format('alter table public.prompts rename to %I', archived_name);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'run_messages') then
    archived_name := format('run_messages_legacy_%s', suffix);
    execute format('alter table public.run_messages rename to %I', archived_name);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'run_metrics') then
    archived_name := format('run_metrics_legacy_%s', suffix);
    execute format('alter table public.run_metrics rename to %I', archived_name);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'runs') then
    archived_name := format('runs_legacy_%s', suffix);
    execute format('alter table public.runs rename to %I', archived_name);
  end if;

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'scenarios') then
    archived_name := format('scenarios_legacy_%s', suffix);
    execute format('alter table public.scenarios rename to %I', archived_name);
  end if;
end
$$;

create table if not exists public.projects (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  model text not null default 'GPT-4o',
  icon text not null default 'schema',
  last_edited text not null default 'Just now',
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);

create table if not exists public.prompt_nodes (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  type text not null,
  label text not null,
  icon text not null default 'description',
  x real not null default 0,
  y real not null default 0,
  content text not null default '',
  meta jsonb not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_prompt_nodes_project on public.prompt_nodes(project_id);

create table if not exists public.connections (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  from_node_id text not null references public.prompt_nodes(id) on delete cascade,
  to_node_id text not null references public.prompt_nodes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(project_id, from_node_id, to_node_id)
);

create index if not exists idx_connections_project on public.connections(project_id);

create table if not exists public.prompt_versions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references public.projects(id) on delete cascade,
  timestamp bigint not null default (extract(epoch from now())::bigint * 1000),
  content text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_prompt_versions_project on public.prompt_versions(project_id);

-- Ensure owner_id exists if projects table already existed from an earlier app migration.
alter table public.projects add column if not exists owner_id uuid;
alter table public.projects alter column owner_id set default auth.uid();

-- Enable row-level security.
alter table public.projects enable row level security;
alter table public.prompt_nodes enable row level security;
alter table public.connections enable row level security;
alter table public.prompt_versions enable row level security;

-- Remove any previous permissive policies.
drop policy if exists "Allow all on projects" on public.projects;
drop policy if exists "Allow all on prompt_nodes" on public.prompt_nodes;
drop policy if exists "Allow all on connections" on public.connections;
drop policy if exists "Allow all on prompt_versions" on public.prompt_versions;

drop policy if exists "projects_select_own" on public.projects;
drop policy if exists "projects_insert_own" on public.projects;
drop policy if exists "projects_update_own" on public.projects;
drop policy if exists "projects_delete_own" on public.projects;

drop policy if exists "prompt_nodes_select_own" on public.prompt_nodes;
drop policy if exists "prompt_nodes_insert_own" on public.prompt_nodes;
drop policy if exists "prompt_nodes_update_own" on public.prompt_nodes;
drop policy if exists "prompt_nodes_delete_own" on public.prompt_nodes;

drop policy if exists "connections_select_own" on public.connections;
drop policy if exists "connections_insert_own" on public.connections;
drop policy if exists "connections_update_own" on public.connections;
drop policy if exists "connections_delete_own" on public.connections;

drop policy if exists "prompt_versions_select_own" on public.prompt_versions;
drop policy if exists "prompt_versions_insert_own" on public.prompt_versions;
drop policy if exists "prompt_versions_update_own" on public.prompt_versions;
drop policy if exists "prompt_versions_delete_own" on public.prompt_versions;

create or replace function public.user_owns_project(target_project_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.owner_id = auth.uid()
  );
$$;

create policy "projects_select_own"
  on public.projects
  for select
  using (auth.uid() = owner_id);

create policy "projects_insert_own"
  on public.projects
  for insert
  with check (auth.uid() = owner_id);

create policy "projects_update_own"
  on public.projects
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "projects_delete_own"
  on public.projects
  for delete
  using (auth.uid() = owner_id);

create policy "prompt_nodes_select_own"
  on public.prompt_nodes
  for select
  using (public.user_owns_project(project_id));

create policy "prompt_nodes_insert_own"
  on public.prompt_nodes
  for insert
  with check (public.user_owns_project(project_id));

create policy "prompt_nodes_update_own"
  on public.prompt_nodes
  for update
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));

create policy "prompt_nodes_delete_own"
  on public.prompt_nodes
  for delete
  using (public.user_owns_project(project_id));

create policy "connections_select_own"
  on public.connections
  for select
  using (public.user_owns_project(project_id));

create policy "connections_insert_own"
  on public.connections
  for insert
  with check (public.user_owns_project(project_id));

create policy "connections_update_own"
  on public.connections
  for update
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));

create policy "connections_delete_own"
  on public.connections
  for delete
  using (public.user_owns_project(project_id));

create policy "prompt_versions_select_own"
  on public.prompt_versions
  for select
  using (public.user_owns_project(project_id));

create policy "prompt_versions_insert_own"
  on public.prompt_versions
  for insert
  with check (public.user_owns_project(project_id));

create policy "prompt_versions_update_own"
  on public.prompt_versions
  for update
  using (public.user_owns_project(project_id))
  with check (public.user_owns_project(project_id));

create policy "prompt_versions_delete_own"
  on public.prompt_versions
  for delete
  using (public.user_owns_project(project_id));

commit;
