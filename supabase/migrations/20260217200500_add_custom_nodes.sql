-- Add tenant-scoped custom node templates for reusable sidebar blocks.
-- Safe to run repeatedly.

begin;

create table if not exists public.custom_nodes (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null default 'custom',
  label text not null,
  icon text not null default 'widgets',
  content text not null default '',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_custom_nodes_owner_id on public.custom_nodes(owner_id);

alter table public.custom_nodes enable row level security;

drop policy if exists "custom_nodes_select_own" on public.custom_nodes;
drop policy if exists "custom_nodes_insert_own" on public.custom_nodes;
drop policy if exists "custom_nodes_update_own" on public.custom_nodes;
drop policy if exists "custom_nodes_delete_own" on public.custom_nodes;

create policy "custom_nodes_select_own"
  on public.custom_nodes
  for select
  using (auth.uid() = owner_id);

create policy "custom_nodes_insert_own"
  on public.custom_nodes
  for insert
  with check (auth.uid() = owner_id);

create policy "custom_nodes_update_own"
  on public.custom_nodes
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "custom_nodes_delete_own"
  on public.custom_nodes
  for delete
  using (auth.uid() = owner_id);

commit;
