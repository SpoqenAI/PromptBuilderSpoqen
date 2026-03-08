begin;

create extension if not exists pgcrypto;

-- Stripe customer mapping: one Stripe customer per Supabase user.
create table if not exists public.stripe_customers (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_stripe_customers_user_id on public.stripe_customers(user_id);
create index if not exists idx_stripe_customers_stripe_customer_id on public.stripe_customers(stripe_customer_id);

-- Subscription tracking: one active subscription per user.
create table if not exists public.subscriptions (
  id text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null default '',
  status text not null default 'incomplete'
    check (status in ('active','canceled','incomplete','incomplete_expired','past_due','trialing','unpaid','paused')),
  tier text not null default 'individual'
    check (tier in ('individual','enterprise')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_stripe_subscription_id on public.subscriptions(stripe_subscription_id);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

-- RLS: stripe_customers (user can read own row; writes via service role only)
alter table public.stripe_customers enable row level security;

drop policy if exists "stripe_customers_select_own" on public.stripe_customers;
create policy "stripe_customers_select_own"
  on public.stripe_customers
  for select
  using (auth.uid() = user_id);

-- RLS: subscriptions (user can read own rows; writes via service role only)
alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

commit;
