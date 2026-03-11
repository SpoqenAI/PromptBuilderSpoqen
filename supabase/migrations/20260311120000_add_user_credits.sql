begin;

create table if not exists public.user_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits_remaining integer not null default 0,
  credits_allowance integer not null default 25,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_credits_user_id on public.user_credits(user_id);

alter table public.user_credits enable row level security;

drop policy if exists "user_credits_select_own" on public.user_credits;
create policy "user_credits_select_own"
  on public.user_credits
  for select
  using (auth.uid() = user_id);

drop policy if exists "user_credits_insert_own" on public.user_credits;
create policy "user_credits_insert_own"
  on public.user_credits
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_credits_update_own" on public.user_credits;
create policy "user_credits_update_own"
  on public.user_credits
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;
