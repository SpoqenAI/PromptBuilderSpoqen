-- PromptBuilder Supabase baseline schema
-- Run in Supabase SQL Editor for a fresh project.
-- Policies require an authenticated user (including anonymous auth users).

create extension if not exists pgcrypto;

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

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default '',
  heard_about text not null default '',
  primary_goal text not null default '',
  primary_use_case text not null default '',
  team_size text not null default '',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_profiles_email on public.user_profiles(email);

alter table public.projects enable row level security;
alter table public.prompt_nodes enable row level security;
alter table public.connections enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.user_profiles enable row level security;

drop policy if exists "Allow all on projects" on public.projects;
drop policy if exists "Allow all on prompt_nodes" on public.prompt_nodes;
drop policy if exists "Allow all on connections" on public.connections;
drop policy if exists "Allow all on prompt_versions" on public.prompt_versions;
drop policy if exists "Allow all on user_profiles" on public.user_profiles;

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

drop policy if exists "user_profiles_select_own" on public.user_profiles;
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;
drop policy if exists "user_profiles_delete_own" on public.user_profiles;

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

create policy "user_profiles_select_own"
  on public.user_profiles
  for select
  using (auth.uid() = user_id);

create policy "user_profiles_insert_own"
  on public.user_profiles
  for insert
  with check (auth.uid() = user_id);

create policy "user_profiles_update_own"
  on public.user_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_profiles_delete_own"
  on public.user_profiles
  for delete
  using (auth.uid() = user_id);
