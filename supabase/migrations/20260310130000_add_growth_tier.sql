begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_tier_check;

alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('individual', 'growth', 'enterprise'));

commit;
