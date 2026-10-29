-- Verification is transaction-local. All fixtures are rolled back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); ma uuid:=gen_random_uuid(); mb uuid:=gen_random_uuid(); mc uuid:=gen_random_uuid();
  ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid(); tf uuid:=gen_random_uuid(); td uuid:=gen_random_uuid();
  sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid();
begin
  perform set_config('teamflow.deadline_qa',json_build_object('admin',a,'alice',b,'bob',c,'w',w,'p',p,'ma',ma,'mb',mb,'mc',mc,'ta',ta,'tb',tb,'tf',tf,'td',td,'sa',sa,'sb',sb)::text,true);
  insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at) values
    (a,'authenticated','authenticated','qa-'||a||'@example.invalid',now(),false,now(),now()),
    (b,'authenticated','authenticated','qa-'||b||'@example.invalid',now(),false,now(),now()),
    (c,'authenticated','authenticated','qa-'||c||'@example.invalid',now(),false,now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at,ip,user_agent) values
    (sa,a,now(),now(),'198.51.100.10','QA Admin browser'),(sb,b,now(),now(),'203.0.113.10','QA Member browser');
  insert into public.workspaces(id,name,owner_id) values(w,'Temporary deadlines verification',a);
  insert into public.team_members(id,workspace_id,email,display_name,role,user_id) values
    (ma,w,'qa-'||a||'@example.invalid','QA Admin','Admin',a),
    (mb,w,'qa-'||b||'@example.invalid','QA Alice','Member',b),
    (mc,w,'qa-'||c||'@example.invalid','QA Bob','Member',c);
  insert into public.projects(id,workspace_id,name,color,created_by) values(p,w,'QA Project','#7350d6',a);
  insert into public.project_members(workspace_id,project_id,member_id) values(w,p,ma),(w,p,mb),(w,p,mc);
  insert into public.tasks(id,workspace_id,project_id,creator_id,assignee_member_id,title,due_date,due_at,due_timezone,status) values
    (ta,w,p,a,mb,'Alice due task',((now()-interval '1 hour') at time zone 'UTC')::date,now()-interval '1 hour','UTC','To Do'),
    (tb,w,p,a,mc,'Bob due task',((now()-interval '1 hour') at time zone 'UTC')::date,now()-interval '1 hour','UTC','To Do'),
    (tf,w,p,a,mb,'Alice future task',((now()+interval '1 hour') at time zone 'UTC')::date,now()+interval '1 hour','UTC','To Do'),
    (td,w,p,a,mb,'Alice completed task',((now()-interval '1 hour') at time zone 'UTC')::date,now()-interval '1 hour','UTC','Done');
end $$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.deadline_qa')::json->>'alice','session_id',current_setting('teamflow.deadline_qa')::json->>'sb','role','authenticated')::text,true);
do $$ declare x json:=current_setting('teamflow.deadline_qa')::json; n integer; audit jsonb; blocked boolean; begin
  select count(*) into n from public.get_due_task_alerts((x->>'w')::uuid);
  if n<>1 then raise exception 'FAIL: teammate must receive only their due task, excluding future and completed tasks'; end if;
  if exists(select 1 from public.get_due_task_alerts(gen_random_uuid())) then raise exception 'FAIL: workspace isolation'; end if;
  audit:=public.capture_login_activity();
  if audit->>'ip_address'<>'203.0.113.10' then raise exception 'FAIL: IP did not come from the native Auth session'; end if;
  perform public.capture_login_activity();
  select count(*) into n from public.login_activity where workspace_id=(x->>'w')::uuid;
  if n<>0 then raise exception 'FAIL: teammate can read login history'; end if;
  blocked:=false;
  begin insert into public.login_activity(workspace_id,session_id,email,display_name,logged_in_at,ip_address)
    values((x->>'w')::uuid,gen_random_uuid(),'forged@example.invalid','Forged',now(),'8.8.8.8');
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: browser can forge login records'; end if;
  insert into public.task_alert_receipts(user_id,task_id,due_at)
    select auth.uid(),task_id,due_at from public.get_due_task_alerts((x->>'w')::uuid);
  if exists(select 1 from public.get_due_task_alerts((x->>'w')::uuid)) then raise exception 'FAIL: acknowledged alert is repeated'; end if;
  blocked:=false;
  begin insert into public.task_alert_receipts(user_id,task_id,due_at)
    select auth.uid(),id,due_at from public.tasks where id=(x->>'tf')::uuid;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: future deadline can be dismissed before it is due'; end if;
end $$;

-- A JWT subject may not claim another user's native session.
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.deadline_qa')::json->>'alice','session_id',current_setting('teamflow.deadline_qa')::json->>'sa','role','authenticated')::text,true);
do $$ declare blocked boolean:=false; begin
  begin perform public.capture_login_activity(); exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: session binding can be spoofed'; end if;
end $$;

select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.deadline_qa')::json->>'admin','session_id',current_setting('teamflow.deadline_qa')::json->>'sa','role','authenticated')::text,true);
do $$ declare x json:=current_setting('teamflow.deadline_qa')::json; n integer; blocked boolean; begin
  select count(*) into n from public.get_due_task_alerts((x->>'w')::uuid);
  if n<>2 then raise exception 'FAIL: teammate dismissal suppressed the admin alert'; end if;
  perform public.capture_login_activity();
  select count(*) into n from public.login_activity where workspace_id=(x->>'w')::uuid;
  if n<>2 then raise exception 'FAIL: login records are missing or repeated for one session'; end if;
  blocked:=false;
  begin update public.login_activity set ip_address='8.8.8.8' where workspace_id=(x->>'w')::uuid;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: client can rewrite audit records'; end if;
  blocked:=false;
  begin insert into public.task_alert_receipts(user_id,task_id,due_at)
    select (x->>'bob')::uuid,task_id,due_at from public.get_due_task_alerts((x->>'w')::uuid) where task_id=(x->>'tb')::uuid;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'FAIL: admin could dismiss on behalf of a teammate'; end if;
  update public.tasks set due_at=now()-interval '30 minutes',due_date=((now()-interval '30 minutes') at time zone 'UTC')::date where id=(x->>'ta')::uuid;
end $$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.deadline_qa')::json->>'alice','session_id',current_setting('teamflow.deadline_qa')::json->>'sb','role','authenticated')::text,true);
do $$ declare n integer; begin
  select count(*) into n from public.get_due_task_alerts((current_setting('teamflow.deadline_qa')::json->>'w')::uuid);
  if n<>1 then raise exception 'FAIL: rescheduled deadline does not produce a new alert'; end if;
end $$;
rollback;
select 'PASS: due-time filtering, own-task alert isolation, per-person dismissal, rescheduling, native-IP session binding, admin-only history, immutable audit records; all fixtures rolled back.' as verification;
