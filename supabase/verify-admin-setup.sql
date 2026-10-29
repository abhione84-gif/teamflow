-- Test both configured admin emails without sending email or leaving accounts.
begin;
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); begin
  if exists(select 1 from auth.users where email in ('abhilash@cartafella.com','abhione84@gmail.com')) then
    raise exception 'Stop: real admin accounts now exist; preserve them and test bootstrap separately.';
  end if;
  perform set_config('teamflow.admin_qa',json_build_object('first',a,'second',b,'outsider',outsider)::text,true);
  insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at) values
    (a,'authenticated','authenticated','abhilash@cartafella.com',now(),false,now(),now()),
    (b,'authenticated','authenticated','abhione84@gmail.com',now(),false,now(),now()),
    (outsider,'authenticated','authenticated','outsider-'||outsider||'@example.invalid',now(),false,now(),now());
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.admin_qa')::json->>'first','role','authenticated')::text,true);
select set_config('teamflow.first_workspace',public.initialize_admin()::text,true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.admin_qa')::json->>'second','role','authenticated')::text,true);
do $$ declare w uuid; n integer; begin
  w:=public.initialize_admin();
  if w::text <> current_setting('teamflow.first_workspace') then raise exception 'FAIL: admins got different workspaces'; end if;
  select count(*) into n from public.team_members where workspace_id=w and role='Admin';
  if n<>2 then raise exception 'FAIL: both configured emails must be admins'; end if;
  if not private.is_admin(w) then raise exception 'FAIL: second admin was not authorized'; end if;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.admin_qa')::json->>'outsider','role','authenticated')::text,true);
do $$ declare blocked boolean:=false; begin
  begin perform public.initialize_admin(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: unconfigured email could become an admin'; end if;
end $$;
rollback;
select 'PASS: both verified configured emails join one workspace as admins; other emails cannot bootstrap; all fixture accounts rolled back.' as verification;
