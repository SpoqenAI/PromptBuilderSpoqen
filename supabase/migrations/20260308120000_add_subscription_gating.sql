begin;

create extension if not exists pgcrypto;

-- Feature usage tracking: one row per user per feature for free-tier gating.
create table if not exists public.feature_usage (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feature_key text not null check (feature_key in ('import_prompt','import_transcript')),
  used_at timestamptz not null default now(),
  unique (user_id, feature_key)
);

create index if not exists idx_feature_usage_user_id on public.feature_usage(user_id);

-- Helper: does the current user have an active paid subscription?
create or replace function public.user_has_active_subscription()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = auth.uid()
      and s.status in ('active', 'trialing', 'past_due')
  );
$$;

-- Helper: count of prompt flow projects owned by current user.
create or replace function public.user_prompt_flow_count()
returns integer
language sql
stable
security definer
as $$
  select count(*)::integer
  from public.projects p
  where p.owner_id = auth.uid();
$$;

-- Helper: count of transcript flows owned by current user.
create or replace function public.user_transcription_flow_count()
returns integer
language sql
stable
security definer
as $$
  select count(*)::integer
  from public.transcript_flows tf
  join public.transcripts t on t.id = tf.transcript_id
  join public.transcript_sets ts on ts.id = t.transcript_set_id
  where ts.owner_id = auth.uid();
$$;

-- Can the current user create another prompt flow?
create or replace function public.user_can_create_prompt_flow()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_active_subscription() or public.user_prompt_flow_count() < 3;
$$;

-- Can the current user create another transcription flow?
create or replace function public.user_can_create_transcription_flow()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_active_subscription() or public.user_transcription_flow_count() < 3;
$$;

-- Can the current user use a given import feature?
create or replace function public.user_can_use_import_feature(p_feature_key text)
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_active_subscription()
    or not exists (
      select 1
      from public.feature_usage fu
      where fu.user_id = auth.uid()
        and fu.feature_key = p_feature_key
    );
$$;

-- RLS: feature_usage
alter table public.feature_usage enable row level security;

drop policy if exists "feature_usage_select_own" on public.feature_usage;
create policy "feature_usage_select_own"
  on public.feature_usage
  for select
  using (auth.uid() = user_id);

drop policy if exists "feature_usage_insert_own" on public.feature_usage;
create policy "feature_usage_insert_own"
  on public.feature_usage
  for insert
  with check (
    auth.uid() = user_id
    and public.user_can_use_import_feature(feature_key)
  );

-- Update projects insert policy to enforce prompt flow limit.
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects
  for insert
  with check (
    auth.uid() = owner_id
    and public.user_can_create_prompt_flow()
  );

-- Update transcript_flows insert policy to enforce transcription flow limit.
drop policy if exists "transcript_flows_insert_own" on public.transcript_flows;
create policy "transcript_flows_insert_own"
  on public.transcript_flows
  for insert
  with check (
    public.user_owns_transcript(transcript_id)
    and public.user_can_create_transcription_flow()
  );

commit;
