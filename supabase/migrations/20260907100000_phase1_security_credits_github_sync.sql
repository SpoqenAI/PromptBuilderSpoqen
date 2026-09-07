begin;

-- ============================================================================
-- 1. Secure user_credits: Revoke client INSERT / UPDATE RLS policies
-- ============================================================================

drop policy if exists "user_credits_insert_own" on public.user_credits;
drop policy if exists "user_credits_update_own" on public.user_credits;
drop policy if exists "user_credits_update_plan_owner" on public.user_credits;

-- Ensure select policies remain intact (user can read own, plan owner can read member)
drop policy if exists "user_credits_select_own" on public.user_credits;
create policy "user_credits_select_own"
  on public.user_credits
  for select
  using (auth.uid() = user_id);

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

-- Function to safely initialize or fetch user credits via SECURITY DEFINER
create or replace function public.get_or_init_user_credits(p_tier text default 'free')
returns public.user_credits
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowance integer := 25;
  v_row public.user_credits;
begin
  if v_user_id is null then
    raise exception 'Not authenticated.';
  end if;

  if p_tier = 'enterprise' then
    v_allowance := 1000;
  elsif p_tier = 'growth' then
    v_allowance := 500;
  elsif p_tier = 'individual' then
    v_allowance := 100;
  else
    v_allowance := 25;
  end if;

  select * into v_row
  from public.user_credits
  where user_id = v_user_id;

  if not found then
    insert into public.user_credits (user_id, credits_remaining, credits_allowance)
    values (v_user_id, v_allowance, v_allowance)
    on conflict (user_id) do update
      set updated_at = now()
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ============================================================================
-- 2. Atomic credit consumption with FOR UPDATE locking
-- ============================================================================

create or replace function public.consume_org_credits(
  p_org_id uuid,
  p_amount integer
)
returns text
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_monthly integer;
  v_top_up integer;
  v_use_monthly integer;
  v_remainder integer;
  v_is_authorized boolean := false;
begin
  if p_amount <= 0 then
    return 'ok';
  end if;

  -- Verify caller is authorized (either org owner or active org member)
  if v_user_id is not null then
    select exists (
      select 1 from public.organizations o
      where o.id = p_org_id and o.owner_user_id = v_user_id
      union all
      select 1 from public.organization_members om
      where om.organization_id = p_org_id and om.member_user_id = v_user_id
    ) into v_is_authorized;

    if not v_is_authorized then
      raise exception 'Unauthorized to consume credits for this organization.';
    end if;
  end if;

  -- Lock the row for update to prevent concurrent double-spend
  select monthly_credits, top_up_credits
  into v_monthly, v_top_up
  from public.organizations
  where id = p_org_id
  for update;

  if not found or (v_monthly + v_top_up) < p_amount then
    return 'insufficient';
  end if;

  v_use_monthly := least(v_monthly, p_amount);
  v_remainder := p_amount - v_use_monthly;

  update public.organizations
  set monthly_credits = monthly_credits - v_use_monthly,
      top_up_credits = top_up_credits - v_remainder,
      updated_at = now()
  where id = p_org_id;

  return 'ok';
end;
$$;

-- ============================================================================
-- 3. Parameterized Admin Role Assignment RPC
-- ============================================================================

create or replace function public.assign_user_role(
  target_email text,
  target_role text
)
returns void
language plpgsql
security definer
as $$
declare
  v_caller_is_admin boolean := false;
  v_target_user_id uuid;
begin
  -- Validate target_role
  if target_role not in ('user', 'beta', 'admin') then
    raise exception 'Invalid role: %', target_role;
  end if;

  -- Caller must be an existing admin or service_role (auth.uid() is null for service_role)
  if auth.uid() is not null then
    select exists (
      select 1 from public.user_profiles
      where user_id = auth.uid() and user_role = 'admin'
    ) into v_caller_is_admin;

    if not v_caller_is_admin then
      raise exception 'Only administrators can assign user roles.';
    end if;
  end if;

  select id into v_target_user_id
  from auth.users
  where lower(email) = lower(trim(target_email));

  if v_target_user_id is not null then
    insert into public.user_profiles (user_id, email, user_role)
    values (v_target_user_id, lower(trim(target_email)), target_role)
    on conflict (user_id) do update
      set user_role = target_role,
          updated_at = now();
  else
    raise notice 'User with email % not found in auth.users.', target_email;
  end if;
end;
$$;

-- ============================================================================
-- 4. Project GitHub Sync Persistence Table
-- ============================================================================

create table if not exists public.project_github_sync (
  project_id text primary key references public.projects(id) on delete cascade,
  owner text not null,
  repo text not null,
  branch text not null default 'main',
  file_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_github_sync_project on public.project_github_sync(project_id);

alter table public.project_github_sync enable row level security;

drop policy if exists "project_github_sync_select" on public.project_github_sync;
create policy "project_github_sync_select"
  on public.project_github_sync
  for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "project_github_sync_insert" on public.project_github_sync;
create policy "project_github_sync_insert"
  on public.project_github_sync
  for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "project_github_sync_update" on public.project_github_sync;
create policy "project_github_sync_update"
  on public.project_github_sync
  for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists "project_github_sync_delete" on public.project_github_sync;
create policy "project_github_sync_delete"
  on public.project_github_sync
  for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

commit;
