begin;

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where email = 'dc@dc-dev.space';

  if v_user_id is null then
    raise notice 'No auth.users row found for email dc@dc-dev.space; skipping user_role update.';
    return;
  end if;

  insert into public.user_profiles (user_id, email)
  values (v_user_id, 'dc@dc-dev.space')
  on conflict (user_id) do nothing;

  update public.user_profiles
  set user_role = 'admin'
  where user_id = v_user_id;
end $$;

commit;

