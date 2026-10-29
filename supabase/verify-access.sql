-- All fixture users and data are rolled back; no messages or invites are sent.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  ma uuid := gen_random_uuid(); mb uuid := gen_random_uuid(); mc uuid := gen_random_uuid();
  ta uuid := gen_random_uuid(); tb uuid := gen_random_uuid(); tp uuid := gen_random_uuid();
begin
  perform set_config('teamflow.qa', json_build_object('admin',a,'alice',b,'bob',c,'workspace',w,'project',p,'ma',ma,'mb',mb,'mc',mc,'ta',ta,'tb',tb,'tp',tp)::text, true);
  insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at) values
    (a,'authenticated','authenticated','qa-'||a||'@example.invalid',now(),false,now(),now()),
    (b,'authenticated','authenticated','qa-'||b||'@example.invalid',now(),false,now(),now()),
    (c,'authenticated','authenticated','qa-'||c||'@example.invalid',now(),false,now(),now());
  insert into public.workspaces(id,name,owner_id) values(w,'Temporary RLS verification',a);
  insert into public.team_members(id,workspace_id,email,display_name,role,user_id) values
    (ma,w,'qa-'||a||'@example.invalid','QA Admin','Admin',a),
    (mb,w,'qa-'||b||'@example.invalid','QA Alice','Member',b),
    (mc,w,'qa-'||c||'@example.invalid','QA Bob','Member',c);
  insert into public.projects(id,workspace_id,name,color,created_by) values(p,w,'QA Project','#7350d6',a);
  insert into public.project_members(workspace_id,project_id,member_id) values(w,p,ma),(w,p,mb),(w,p,mc);
  insert into public.tasks(id,workspace_id,project_id,creator_id,assignee_member_id,title) values
    (ta,w,p,a,mb,'Alice private work'),(tb,w,p,a,mc,'Bob private work');
  insert into public.tasks(id,workspace_id,personal,creator_id,title) values(tp,w,true,c,'Bob personal task');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(current_setting('teamflow.qa')::json->>'alice'),'role','authenticated')::text,true);
do $$
declare x json := current_setting('teamflow.qa')::json; n integer; blocked boolean;
begin
  select count(*) into n from public.tasks where workspace_id=(x->>'workspace')::uuid;
  if n<>1 then raise exception 'FAIL: Alice must see exactly her one task, saw %',n; end if;
  select count(*) into n from public.team_members where workspace_id=(x->>'workspace')::uuid;
  if n<>1 then raise exception 'FAIL: teammate roster leaks other members'; end if;
  update public.tasks set status='Done' where id=(x->>'ta')::uuid;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'FAIL: teammate cannot update their own task'; end if;
  update public.tasks set title='Unauthorized edit' where id=(x->>'tb')::uuid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'FAIL: teammate updated coworker task'; end if;
  delete from public.tasks where id=(x->>'ta')::uuid;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'FAIL: teammate deleted a task'; end if;
  blocked := false;
  begin update public.team_members set role='Admin' where id=(x->>'mb')::uuid;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: teammate could change an admin role'; end if;
  blocked := false;
  begin update public.tasks set assignee_member_id=(x->>'mc')::uuid where id=(x->>'ta')::uuid;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: teammate could reassign a task'; end if;
  blocked := false;
  begin insert into public.tasks(workspace_id,project_id,creator_id,assignee_member_id,title)
    values((x->>'workspace')::uuid,(x->>'project')::uuid,(x->>'alice')::uuid,(x->>'mc')::uuid,'Unauthorized assignment');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: teammate could create a task for someone else'; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub',(current_setting('teamflow.qa')::json->>'bob'),'role','authenticated')::text,true);
do $$ declare n integer; begin
  select count(*) into n from public.tasks where workspace_id=(current_setting('teamflow.qa')::json->>'workspace')::uuid;
  if n<>2 then raise exception 'FAIL: Bob must see his assigned and personal task, saw %',n; end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub',(current_setting('teamflow.qa')::json->>'admin'),'role','authenticated')::text,true);
do $$ declare n integer; x json:=current_setting('teamflow.qa')::json; begin
  select count(*) into n from public.tasks where workspace_id=(x->>'workspace')::uuid;
  if n<>3 then raise exception 'FAIL: admin must see every task including personal tasks, saw %',n; end if;
  select count(*) into n from public.team_members where workspace_id=(x->>'workspace')::uuid;
  if n<>3 then raise exception 'FAIL: admin cannot view all workspace members'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$ declare n integer; begin
  begin
    select count(*) into n from public.tasks;
    if n<>0 then raise exception 'FAIL: anonymous visitor could read tasks'; end if;
  exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: own-task reads and edits, coworker isolation, immutable assignment, no role escalation, admin visibility, and anonymous access; all fixtures rolled back.' as verification;
