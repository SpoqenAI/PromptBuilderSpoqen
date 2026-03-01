begin;

create extension if not exists pgcrypto;

create table if not exists public.optimization_run_patches (
  id text primary key default gen_random_uuid()::text,
  optimization_run_id text not null references public.optimization_runs(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  prompt_node_id text not null references public.prompt_nodes(id) on delete cascade,
  old_content text not null default '',
  new_content text not null default '',
  rationale text not null default '',
  evidence jsonb not null default '[]',
  confidence real not null default 0,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'applied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_optimization_run_patches_run_id
  on public.optimization_run_patches(optimization_run_id);
create index if not exists idx_optimization_run_patches_project_id
  on public.optimization_run_patches(project_id);
create index if not exists idx_optimization_run_patches_prompt_node_id
  on public.optimization_run_patches(prompt_node_id);
create index if not exists idx_optimization_run_patches_status
  on public.optimization_run_patches(status);

create table if not exists public.prompt_node_sync_meta (
  prompt_node_id text primary key references public.prompt_nodes(id) on delete cascade,
  section_hash text not null,
  last_assembled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prompt_node_sync_meta_last_assembled_at
  on public.prompt_node_sync_meta(last_assembled_at desc);

alter table public.optimization_run_patches enable row level security;
alter table public.prompt_node_sync_meta enable row level security;

drop policy if exists "optimization_run_patches_select_own" on public.optimization_run_patches;
drop policy if exists "optimization_run_patches_insert_own" on public.optimization_run_patches;
drop policy if exists "optimization_run_patches_update_own" on public.optimization_run_patches;
drop policy if exists "optimization_run_patches_delete_own" on public.optimization_run_patches;

create policy "optimization_run_patches_select_own"
  on public.optimization_run_patches
  for select
  using (
    exists (
      select 1
      from public.optimization_runs run
      where run.id = optimization_run_id
        and public.user_owns_transcript_set(run.transcript_set_id)
    )
    and public.user_owns_project(project_id)
  );

create policy "optimization_run_patches_insert_own"
  on public.optimization_run_patches
  for insert
  with check (
    exists (
      select 1
      from public.optimization_runs run
      where run.id = optimization_run_id
        and public.user_owns_transcript_set(run.transcript_set_id)
    )
    and public.user_owns_project(project_id)
  );

create policy "optimization_run_patches_update_own"
  on public.optimization_run_patches
  for update
  using (
    exists (
      select 1
      from public.optimization_runs run
      where run.id = optimization_run_id
        and public.user_owns_transcript_set(run.transcript_set_id)
    )
    and public.user_owns_project(project_id)
  )
  with check (
    exists (
      select 1
      from public.optimization_runs run
      where run.id = optimization_run_id
        and public.user_owns_transcript_set(run.transcript_set_id)
    )
    and public.user_owns_project(project_id)
  );

create policy "optimization_run_patches_delete_own"
  on public.optimization_run_patches
  for delete
  using (
    exists (
      select 1
      from public.optimization_runs run
      where run.id = optimization_run_id
        and public.user_owns_transcript_set(run.transcript_set_id)
    )
    and public.user_owns_project(project_id)
  );

drop policy if exists "prompt_node_sync_meta_select_own" on public.prompt_node_sync_meta;
drop policy if exists "prompt_node_sync_meta_insert_own" on public.prompt_node_sync_meta;
drop policy if exists "prompt_node_sync_meta_update_own" on public.prompt_node_sync_meta;
drop policy if exists "prompt_node_sync_meta_delete_own" on public.prompt_node_sync_meta;

create policy "prompt_node_sync_meta_select_own"
  on public.prompt_node_sync_meta
  for select
  using (public.user_owns_project((select pn.project_id from public.prompt_nodes pn where pn.id = prompt_node_id)));

create policy "prompt_node_sync_meta_insert_own"
  on public.prompt_node_sync_meta
  for insert
  with check (public.user_owns_project((select pn.project_id from public.prompt_nodes pn where pn.id = prompt_node_id)));

create policy "prompt_node_sync_meta_update_own"
  on public.prompt_node_sync_meta
  for update
  using (public.user_owns_project((select pn.project_id from public.prompt_nodes pn where pn.id = prompt_node_id)))
  with check (public.user_owns_project((select pn.project_id from public.prompt_nodes pn where pn.id = prompt_node_id)));

create policy "prompt_node_sync_meta_delete_own"
  on public.prompt_node_sync_meta
  for delete
  using (public.user_owns_project((select pn.project_id from public.prompt_nodes pn where pn.id = prompt_node_id)));

commit;
