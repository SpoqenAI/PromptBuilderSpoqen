begin;

alter table if exists public.prompt_versions
  add column if not exists snapshot_json jsonb;

commit;