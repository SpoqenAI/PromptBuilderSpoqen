begin;

create extension if not exists pgcrypto;

create table if not exists public.transcript_sets (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  name text not null,
  description text not null default '',
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_transcript_sets_owner_id on public.transcript_sets(owner_id);
create index if not exists idx_transcript_sets_project_id on public.transcript_sets(project_id);

create table if not exists public.transcripts (
  id text primary key default gen_random_uuid()::text,
  transcript_set_id text not null references public.transcript_sets(id) on delete cascade,
  external_id text not null default '',
  title text not null default '',
  transcript_text text not null,
  metadata jsonb not null default '{}',
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_transcripts_set_id on public.transcripts(transcript_set_id);
create index if not exists idx_transcripts_ingested_at on public.transcripts(ingested_at desc);

create table if not exists public.transcript_flows (
  id text primary key default gen_random_uuid()::text,
  transcript_id text not null references public.transcripts(id) on delete cascade,
  prompt_version_id text references public.prompt_versions(id) on delete set null,
  model text not null default '',
  flow_title text not null default 'Transcript Flow',
  flow_summary text not null default '',
  nodes_json jsonb not null default '[]',
  connections_json jsonb not null default '[]',
  used_fallback boolean not null default false,
  warning text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_transcript_flows_transcript_id on public.transcript_flows(transcript_id);
create index if not exists idx_transcript_flows_created_at on public.transcript_flows(created_at desc);

create table if not exists public.canonical_flow_nodes (
  id text primary key default gen_random_uuid()::text,
  transcript_set_id text not null references public.transcript_sets(id) on delete cascade,
  label text not null,
  type text not null default 'custom',
  icon text not null default 'widgets',
  content text not null default '',
  meta jsonb not null default '{}',
  support_count integer not null default 0,
  confidence real not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_canonical_flow_nodes_set_id on public.canonical_flow_nodes(transcript_set_id);

create table if not exists public.canonical_flow_edges (
  id text primary key default gen_random_uuid()::text,
  transcript_set_id text not null references public.transcript_sets(id) on delete cascade,
  from_node_id text not null references public.canonical_flow_nodes(id) on delete cascade,
  to_node_id text not null references public.canonical_flow_nodes(id) on delete cascade,
  reason text not null default '',
  support_count integer not null default 0,
  transition_rate real not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transcript_set_id, from_node_id, to_node_id)
);

create index if not exists idx_canonical_flow_edges_set_id on public.canonical_flow_edges(transcript_set_id);
create index if not exists idx_canonical_flow_edges_from_node_id on public.canonical_flow_edges(from_node_id);
create index if not exists idx_canonical_flow_edges_to_node_id on public.canonical_flow_edges(to_node_id);

create table if not exists public.prompt_flow_alignments (
  id text primary key default gen_random_uuid()::text,
  transcript_set_id text not null references public.transcript_sets(id) on delete cascade,
  project_id text not null references public.projects(id) on delete cascade,
  prompt_node_id text not null references public.prompt_nodes(id) on delete cascade,
  canonical_node_id text not null references public.canonical_flow_nodes(id) on delete cascade,
  alignment_score real not null default 0,
  alignment_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transcript_set_id, prompt_node_id, canonical_node_id)
);

create index if not exists idx_prompt_flow_alignments_set_id on public.prompt_flow_alignments(transcript_set_id);
create index if not exists idx_prompt_flow_alignments_project_id on public.prompt_flow_alignments(project_id);
create index if not exists idx_prompt_flow_alignments_prompt_node_id on public.prompt_flow_alignments(prompt_node_id);
create index if not exists idx_prompt_flow_alignments_canonical_node_id on public.prompt_flow_alignments(canonical_node_id);

create table if not exists public.optimization_runs (
  id text primary key default gen_random_uuid()::text,
  transcript_set_id text not null references public.transcript_sets(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  objective text not null default '',
  input_snapshot jsonb not null default '{}',
  output_patch jsonb not null default '{}',
  metrics jsonb not null default '{}',
  error_message text not null default '',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_optimization_runs_set_id on public.optimization_runs(transcript_set_id);
create index if not exists idx_optimization_runs_project_id on public.optimization_runs(project_id);
create index if not exists idx_optimization_runs_status on public.optimization_runs(status);
create index if not exists idx_optimization_runs_created_at on public.optimization_runs(created_at desc);

create or replace function public.user_owns_transcript_set(target_transcript_set_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.transcript_sets ts
    where ts.id = target_transcript_set_id
      and ts.owner_id = auth.uid()
  );
$$;

create or replace function public.user_owns_transcript(target_transcript_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.transcripts t
    join public.transcript_sets ts on ts.id = t.transcript_set_id
    where t.id = target_transcript_id
      and ts.owner_id = auth.uid()
  );
$$;

alter table public.transcript_sets enable row level security;
alter table public.transcripts enable row level security;
alter table public.transcript_flows enable row level security;
alter table public.canonical_flow_nodes enable row level security;
alter table public.canonical_flow_edges enable row level security;
alter table public.prompt_flow_alignments enable row level security;
alter table public.optimization_runs enable row level security;

drop policy if exists "transcript_sets_select_own" on public.transcript_sets;
drop policy if exists "transcript_sets_insert_own" on public.transcript_sets;
drop policy if exists "transcript_sets_update_own" on public.transcript_sets;
drop policy if exists "transcript_sets_delete_own" on public.transcript_sets;

create policy "transcript_sets_select_own"
  on public.transcript_sets
  for select
  using (auth.uid() = owner_id);

create policy "transcript_sets_insert_own"
  on public.transcript_sets
  for insert
  with check (auth.uid() = owner_id);

create policy "transcript_sets_update_own"
  on public.transcript_sets
  for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "transcript_sets_delete_own"
  on public.transcript_sets
  for delete
  using (auth.uid() = owner_id);

drop policy if exists "transcripts_select_own" on public.transcripts;
drop policy if exists "transcripts_insert_own" on public.transcripts;
drop policy if exists "transcripts_update_own" on public.transcripts;
drop policy if exists "transcripts_delete_own" on public.transcripts;

create policy "transcripts_select_own"
  on public.transcripts
  for select
  using (public.user_owns_transcript_set(transcript_set_id));

create policy "transcripts_insert_own"
  on public.transcripts
  for insert
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "transcripts_update_own"
  on public.transcripts
  for update
  using (public.user_owns_transcript_set(transcript_set_id))
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "transcripts_delete_own"
  on public.transcripts
  for delete
  using (public.user_owns_transcript_set(transcript_set_id));

drop policy if exists "transcript_flows_select_own" on public.transcript_flows;
drop policy if exists "transcript_flows_insert_own" on public.transcript_flows;
drop policy if exists "transcript_flows_update_own" on public.transcript_flows;
drop policy if exists "transcript_flows_delete_own" on public.transcript_flows;

create policy "transcript_flows_select_own"
  on public.transcript_flows
  for select
  using (public.user_owns_transcript(transcript_id));

create policy "transcript_flows_insert_own"
  on public.transcript_flows
  for insert
  with check (public.user_owns_transcript(transcript_id));

create policy "transcript_flows_update_own"
  on public.transcript_flows
  for update
  using (public.user_owns_transcript(transcript_id))
  with check (public.user_owns_transcript(transcript_id));

create policy "transcript_flows_delete_own"
  on public.transcript_flows
  for delete
  using (public.user_owns_transcript(transcript_id));

drop policy if exists "canonical_flow_nodes_select_own" on public.canonical_flow_nodes;
drop policy if exists "canonical_flow_nodes_insert_own" on public.canonical_flow_nodes;
drop policy if exists "canonical_flow_nodes_update_own" on public.canonical_flow_nodes;
drop policy if exists "canonical_flow_nodes_delete_own" on public.canonical_flow_nodes;

create policy "canonical_flow_nodes_select_own"
  on public.canonical_flow_nodes
  for select
  using (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_nodes_insert_own"
  on public.canonical_flow_nodes
  for insert
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_nodes_update_own"
  on public.canonical_flow_nodes
  for update
  using (public.user_owns_transcript_set(transcript_set_id))
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_nodes_delete_own"
  on public.canonical_flow_nodes
  for delete
  using (public.user_owns_transcript_set(transcript_set_id));

drop policy if exists "canonical_flow_edges_select_own" on public.canonical_flow_edges;
drop policy if exists "canonical_flow_edges_insert_own" on public.canonical_flow_edges;
drop policy if exists "canonical_flow_edges_update_own" on public.canonical_flow_edges;
drop policy if exists "canonical_flow_edges_delete_own" on public.canonical_flow_edges;

create policy "canonical_flow_edges_select_own"
  on public.canonical_flow_edges
  for select
  using (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_edges_insert_own"
  on public.canonical_flow_edges
  for insert
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_edges_update_own"
  on public.canonical_flow_edges
  for update
  using (public.user_owns_transcript_set(transcript_set_id))
  with check (public.user_owns_transcript_set(transcript_set_id));

create policy "canonical_flow_edges_delete_own"
  on public.canonical_flow_edges
  for delete
  using (public.user_owns_transcript_set(transcript_set_id));

drop policy if exists "prompt_flow_alignments_select_own" on public.prompt_flow_alignments;
drop policy if exists "prompt_flow_alignments_insert_own" on public.prompt_flow_alignments;
drop policy if exists "prompt_flow_alignments_update_own" on public.prompt_flow_alignments;
drop policy if exists "prompt_flow_alignments_delete_own" on public.prompt_flow_alignments;

create policy "prompt_flow_alignments_select_own"
  on public.prompt_flow_alignments
  for select
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and public.user_owns_project(project_id)
  );

create policy "prompt_flow_alignments_insert_own"
  on public.prompt_flow_alignments
  for insert
  with check (
    public.user_owns_transcript_set(transcript_set_id)
    and public.user_owns_project(project_id)
  );

create policy "prompt_flow_alignments_update_own"
  on public.prompt_flow_alignments
  for update
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and public.user_owns_project(project_id)
  )
  with check (
    public.user_owns_transcript_set(transcript_set_id)
    and public.user_owns_project(project_id)
  );

create policy "prompt_flow_alignments_delete_own"
  on public.prompt_flow_alignments
  for delete
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and public.user_owns_project(project_id)
  );

drop policy if exists "optimization_runs_select_own" on public.optimization_runs;
drop policy if exists "optimization_runs_insert_own" on public.optimization_runs;
drop policy if exists "optimization_runs_update_own" on public.optimization_runs;
drop policy if exists "optimization_runs_delete_own" on public.optimization_runs;

create policy "optimization_runs_select_own"
  on public.optimization_runs
  for select
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and (project_id is null or public.user_owns_project(project_id))
  );

create policy "optimization_runs_insert_own"
  on public.optimization_runs
  for insert
  with check (
    public.user_owns_transcript_set(transcript_set_id)
    and (project_id is null or public.user_owns_project(project_id))
  );

create policy "optimization_runs_update_own"
  on public.optimization_runs
  for update
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and (project_id is null or public.user_owns_project(project_id))
  )
  with check (
    public.user_owns_transcript_set(transcript_set_id)
    and (project_id is null or public.user_owns_project(project_id))
  );

create policy "optimization_runs_delete_own"
  on public.optimization_runs
  for delete
  using (
    public.user_owns_transcript_set(transcript_set_id)
    and (project_id is null or public.user_owns_project(project_id))
  );

commit;
