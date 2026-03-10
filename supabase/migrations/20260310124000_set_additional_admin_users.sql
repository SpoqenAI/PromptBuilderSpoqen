begin;

do $$
declare
  rec record;
begin
  for rec in
    select id, email
    from auth.users
    where email in (
      'clark.ohlenbusch@gmail.com',
      'vesko.portev@gmail.com',
      'olivier.vroom@gmail.com'
    )
  loop
    insert into public.user_profiles (user_id, email)
    values (rec.id, rec.email)
    on conflict (user_id) do nothing;

    update public.user_profiles
    set user_role = 'admin'
    where user_id = rec.id;
  end loop;
end $$;

commit;

