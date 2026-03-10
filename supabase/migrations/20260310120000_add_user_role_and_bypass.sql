begin;

-- Add user_role column to user_profiles (distinct from the onboarding 'role' column).
alter table public.user_profiles
  add column if not exists user_role text not null default 'user'
  check (user_role in ('user', 'beta', 'admin'));

-- Returns true if the current user has an admin or beta role.
create or replace function public.user_has_bypass_role()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.user_profiles up
    where up.user_id = auth.uid()
      and up.user_role in ('admin', 'beta')
  );
$$;

-- Redefine limit helpers to include bypass for admin/beta.

create or replace function public.user_can_create_prompt_flow()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_bypass_role()
    or public.user_has_active_subscription()
    or public.user_prompt_flow_count() < 3;
$$;

create or replace function public.user_can_create_transcription_flow()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_bypass_role()
    or public.user_has_active_subscription()
    or public.user_transcription_flow_count() < 3;
$$;

create or replace function public.user_can_use_import_feature(p_feature_key text)
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_bypass_role()
    or public.user_has_active_subscription()
    or not exists (
      select 1
      from public.feature_usage fu
      where fu.user_id = auth.uid()
        and fu.feature_key = p_feature_key
    );
$$;

create or replace function public.user_can_create_transcript_set()
returns boolean
language sql
stable
security definer
as $$
  select public.user_has_bypass_role()
    or public.user_has_active_subscription()
    or public.user_transcript_set_count() < 3;
$$;

commit;
