begin;

-- Organizations: the billing entity for seat-based plans.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_plan text,
  subscription_period_start timestamptz,
  subscription_period_end timestamptz,
  monthly_credits integer not null default 0,
  top_up_credits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_organizations_owner on public.organizations(owner_user_id);
create index if not exists idx_organizations_stripe_customer on public.organizations(stripe_customer_id);
create index if not exists idx_organizations_stripe_subscription on public.organizations(stripe_subscription_id);

-- Organization members
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  unique (organization_id, member_user_id)
);

create index if not exists idx_org_members_org on public.organization_members(organization_id);
create index if not exists idx_org_members_user on public.organization_members(member_user_id);

-- Organization invites (pending)
create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create index if not exists idx_org_invites_org on public.organization_invites(organization_id);
create index if not exists idx_org_invites_email on public.organization_invites(email);

-- Billing event log for email deduplication (e.g. downsize alerts)
create table if not exists public.org_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  period_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, event_type, period_key)
);

create index if not exists idx_org_billing_events_org on public.org_billing_events(organization_id);

-- RLS for organizations
alter table public.organizations enable row level security;

drop policy if exists "org_select_owner" on public.organizations;
create policy "org_select_owner" on public.organizations
  for select using (auth.uid() = owner_user_id);

drop policy if exists "org_select_member" on public.organizations;
create policy "org_select_member" on public.organizations
  for select using (
    exists (
      select 1 from public.organization_members om
      where om.organization_id = id and om.member_user_id = auth.uid()
    )
  );

drop policy if exists "org_update_owner" on public.organizations;
create policy "org_update_owner" on public.organizations
  for update using (auth.uid() = owner_user_id);

drop policy if exists "org_insert_owner" on public.organizations;
create policy "org_insert_owner" on public.organizations
  for insert with check (auth.uid() = owner_user_id);

-- RLS for organization_members
alter table public.organization_members enable row level security;

drop policy if exists "org_members_select_org_admin" on public.organization_members;
create policy "org_members_select_org_admin" on public.organization_members
  for select using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

drop policy if exists "org_members_select_own" on public.organization_members;
create policy "org_members_select_own" on public.organization_members
  for select using (auth.uid() = member_user_id);

drop policy if exists "org_members_insert_admin" on public.organization_members;
create policy "org_members_insert_admin" on public.organization_members
  for insert with check (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

drop policy if exists "org_members_delete_admin" on public.organization_members;
create policy "org_members_delete_admin" on public.organization_members
  for delete using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

-- RLS for organization_invites
alter table public.organization_invites enable row level security;

drop policy if exists "org_invites_select_admin" on public.organization_invites;
create policy "org_invites_select_admin" on public.organization_invites
  for select using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

drop policy if exists "org_invites_insert_admin" on public.organization_invites;
create policy "org_invites_insert_admin" on public.organization_invites
  for insert with check (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

drop policy if exists "org_invites_delete_admin" on public.organization_invites;
create policy "org_invites_delete_admin" on public.organization_invites
  for delete using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

-- RLS for org_billing_events (service role only writes; org owners can read)
alter table public.org_billing_events enable row level security;

drop policy if exists "org_billing_events_select_admin" on public.org_billing_events;
create policy "org_billing_events_select_admin" on public.org_billing_events
  for select using (
    exists (
      select 1 from public.organizations o
      where o.id = organization_id and o.owner_user_id = auth.uid()
    )
  );

commit;
