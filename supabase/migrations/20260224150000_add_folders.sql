begin;

create extension if not exists pgcrypto;

-- Folder hierarchy for organizing projects and transcript sets.
create table if not exists public.folders (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id text references public.folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_folders_owner_id on public.folders(owner_id);
create index if not exists idx_folders_parent_id on public.folders(parent_id);

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
drop policy if exists "folders_insert_own" on public.folders;
drop policy if exists "folders_update_own" on public.folders;
drop policy if exists "folders_delete_own" on public.folders;

create policy "folders_select_own"
  on public.folders
  for select
  using (auth.uid() = owner_id);

create policy "folders_insert_own"
  on public.folders
  for insert
  with check (auth.uid() = owner_id);

create policy "folders_update_own"
  on public.folders
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "folders_delete_own"
  on public.folders
  for delete
  using (auth.uid() = owner_id);

-- Add folder_id to projects (ON DELETE SET NULL keeps items at root when folder is deleted).
alter table public.projects add column if not exists folder_id text references public.folders(id) on delete set null;
create index if not exists idx_projects_folder_id on public.projects(folder_id);

-- Add folder_id to transcript_sets.
alter table public.transcript_sets add column if not exists folder_id text references public.folders(id) on delete set null;
create index if not exists idx_transcript_sets_folder_id on public.transcript_sets(folder_id);

commit;
