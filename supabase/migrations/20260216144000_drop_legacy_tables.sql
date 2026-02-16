-- Drop legacy tables from previous project and archived backups.
-- This keeps active PromptBuilder tables intact:
--   projects, prompt_nodes, connections, prompt_versions

begin;

-- Drop legacy runtime tables if they still exist under original names.
drop table if exists public.run_metrics cascade;
drop table if exists public.run_messages cascade;
drop table if exists public.runs cascade;
drop table if exists public.prompts cascade;
drop table if exists public.scenarios cascade;

-- Drop any archived legacy tables created by reconciliation migrations.
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and (
        tablename like 'projects_legacy_%'
        or tablename like 'prompts_legacy_%'
        or tablename like 'run_messages_legacy_%'
        or tablename like 'run_metrics_legacy_%'
        or tablename like 'runs_legacy_%'
        or tablename like 'scenarios_legacy_%'
      )
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
end
$$;

commit;
