begin;

create table if not exists public.plan_members (
  id text primary key default gen_random_uuid()::text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (owner_id, member_user_id)
);

create index if not exists idx_plan_members_owner_id on public.plan_members(owner_id);
create index if not exists idx_plan_members_member_user_id on public.plan_members(member_user_id);

alter table public.plan_members enable row level security;

-- Owner can see their plan members
drop policy if exists "plan_members_select_owner" on public.plan_members;
create policy "plan_members_select_owner"
  on public.plan_members
  for select
  using (auth.uid() = owner_id);

-- Members can see their own membership (to look up who owns their plan)
drop policy if exists "plan_members_select_member" on public.plan_members;
create policy "plan_members_select_member"
  on public.plan_members
  for select
  using (auth.uid() = member_user_id);

-- Only owner can insert members
drop policy if exists "plan_members_insert_owner" on public.plan_members;
create policy "plan_members_insert_owner"
  on public.plan_members
  for insert
  with check (auth.uid() = owner_id);

-- Only owner can remove members
drop policy if exists "plan_members_delete_owner" on public.plan_members;
create policy "plan_members_delete_owner"
  on public.plan_members
  for delete
  using (auth.uid() = owner_id);

-- Allow plan owner to read credits of their members
drop policy if exists "user_credits_select_plan_owner" on public.user_credits;
create policy "user_credits_select_plan_owner"
  on public.user_credits
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.plan_members pm
      where pm.owner_id = auth.uid()
        and pm.member_user_id = public.user_credits.user_id
    )
  );

-- Allow plan owner to update credits of their members
drop policy if exists "user_credits_update_plan_owner" on public.user_credits;
create policy "user_credits_update_plan_owner"
  on public.user_credits
  for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.plan_members pm
      where pm.owner_id = auth.uid()
        and pm.member_user_id = public.user_credits.user_id
    )
  );

-- Allow plan members to see their owner's profile (for display name)
drop policy if exists "user_profiles_select_plan_owner" on public.user_profiles;
create policy "user_profiles_select_plan_owner"
  on public.user_profiles
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.plan_members pm
      where pm.member_user_id = auth.uid()
        and pm.owner_id = public.user_profiles.user_id
    )
  );

-- Allow plan owners to see their members' profiles (for email/name display)
drop policy if exists "user_profiles_select_plan_member" on public.user_profiles;
create policy "user_profiles_select_plan_member"
  on public.user_profiles
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.plan_members pm
      where pm.owner_id = auth.uid()
        and pm.member_user_id = public.user_profiles.user_id
    )
  );

commit;
