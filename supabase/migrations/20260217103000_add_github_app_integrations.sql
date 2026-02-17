begin;

create table if not exists public.github_app_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_github_app_oauth_states_user on public.github_app_oauth_states(user_id);
create index if not exists idx_github_app_oauth_states_expires_at on public.github_app_oauth_states(expires_at);

create table if not exists public.github_installations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null default '',
  account_type text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_github_installations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_github_installations_updated_at on public.github_installations;
create trigger trg_set_github_installations_updated_at
before update on public.github_installations
for each row
execute function public.set_github_installations_updated_at();

alter table public.github_app_oauth_states enable row level security;
alter table public.github_installations enable row level security;

drop policy if exists "github_app_oauth_states_select_own" on public.github_app_oauth_states;
drop policy if exists "github_app_oauth_states_insert_own" on public.github_app_oauth_states;
drop policy if exists "github_app_oauth_states_delete_own" on public.github_app_oauth_states;

create policy "github_app_oauth_states_select_own"
  on public.github_app_oauth_states
  for select
  using (auth.uid() = user_id);

create policy "github_app_oauth_states_insert_own"
  on public.github_app_oauth_states
  for insert
  with check (auth.uid() = user_id);

create policy "github_app_oauth_states_delete_own"
  on public.github_app_oauth_states
  for delete
  using (auth.uid() = user_id);

drop policy if exists "github_installations_select_own" on public.github_installations;
drop policy if exists "github_installations_insert_own" on public.github_installations;
drop policy if exists "github_installations_update_own" on public.github_installations;
drop policy if exists "github_installations_delete_own" on public.github_installations;

create policy "github_installations_select_own"
  on public.github_installations
  for select
  using (auth.uid() = user_id);

create policy "github_installations_insert_own"
  on public.github_installations
  for insert
  with check (auth.uid() = user_id);

create policy "github_installations_update_own"
  on public.github_installations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "github_installations_delete_own"
  on public.github_installations
  for delete
  using (auth.uid() = user_id);

commit;
