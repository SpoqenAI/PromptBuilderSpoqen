begin;

-- Count of transcript sets (workspaces) owned by current user.
create or replace function public.user_transcript_set_count()
returns integer
language sql
stable
security definer
as $$
  select count(*)::integer
  from public.transcript_sets ts
  where ts.owner_id = auth.uid();
$$;

-- Can the current user create another transcript set?
create or replace function public.user_can_create_transcript_set()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_active_subscription() or public.user_transcript_set_count() < 3;
$$;

-- Enforce transcript set limit on insert.
drop policy if exists "transcript_sets_insert_own" on public.transcript_sets;
create policy "transcript_sets_insert_own"
  on public.transcript_sets
  for insert
  with check (
    auth.uid() = owner_id
    and public.user_can_create_transcript_set()
  );

commit;
