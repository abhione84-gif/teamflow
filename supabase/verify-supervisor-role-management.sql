-- All fixture users, memberships, tasks, and grants are rolled back.
begin;
create function pg_temp.check_qa(ok boolean,msg text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'FAIL: %',msg;end if;end$$;
do $$declare a uuid:=gen_random_uuid();s uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();w uuid:=gen_random_uuid();p uuid:=gen_random_uuid();ma uuid:=gen_random_uuid();ms uuid:=gen_random_uuid();mb uuid:=gen_random_uuid();mc uuid:=gen_random_uuid();ta uuid:=gen_random_uuid();tb uuid:=gen_random_uuid();ts uuid:=gen_random_uuid();shared uuid:=gen_random_uuid();begin
 perform set_config('teamflow.collaboration_qa',json_build_object('a',a,'s',s,'b',b,'c',c,'w',w,'p',p,'ma',ma,'ms',ms,'mb',mb,'mc',mc,'ta',ta,'tb',tb,'ts',ts,'shared',shared)::text,true);
 insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at) select id,'authenticated','authenticated','qa-'||id||'@example.invalid',now(),false,now(),now() from unnest(array[a,s,b,c]) id;
 insert into public.workspaces(id,name,owner_id) values(w,'Rollback collaboration QA',a);
 insert into public.team_members(id,workspace_id,email,display_name,role,user_id) values(ma,w,'qa-'||a||'@example.invalid','QA Admin','Admin',a),(ms,w,'qa-'||s||'@example.invalid','QA Supervisor','Supervisor',s),(mb,w,'qa-'||b||'@example.invalid','QA Alice','Member',b),(mc,w,'qa-'||c||'@example.invalid','QA Bob','Member',c);
 insert into public.supervisor_assignments values(w,ms,mb);
 insert into public.projects(id,workspace_id,name,color,created_by) values(p,w,'QA Project','#7350d6',a);
 insert into public.project_members(workspace_id,project_id,member_id) select w,p,id from unnest(array[ma,ms,mb,mc]) id;
 insert into public.tasks(id,workspace_id,project_id,creator_id,assignee_member_id,title,due_at,due_date,due_timezone) values
 (ta,w,p,a,mb,'Alice task',now()-interval '1 hour',((now()-interval '1 hour') at time zone 'UTC')::date,'UTC'),
 (tb,w,p,a,mc,'Bob private team task',now()-interval '1 hour',((now()-interval '1 hour') at time zone 'UTC')::date,'UTC'),
 (ts,w,p,a,ms,'Supervisor own task',now()-interval '1 hour',((now()-interval '1 hour') at time zone 'UTC')::date,'UTC'),
 (shared,w,p,a,mc,'Shared Bob and Alice task',now()-interval '1 hour',((now()-interval '1 hour') at time zone 'UTC')::date,'UTC');
 insert into public.task_collaborators(workspace_id,task_id,member_id) values(w,shared,mb);
 insert into public.tasks(workspace_id,creator_id,personal,title) values(w,b,true,'Alice personal'),(w,c,true,'Bob personal');
 insert into public.login_activity(workspace_id,user_id,session_id,email,display_name,logged_in_at,ip_address) values(w,a,gen_random_uuid(),'qa-'||a||'@example.invalid','QA Admin',now(),'203.0.113.10');
end$$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'s','role','authenticated')::text,true);
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json; blocked boolean; v jsonb; stamp timestamptz; new_task_id uuid;begin
 perform pg_temp.check_qa((select count(*)=3 from public.tasks where workspace_id=(x->>'w')::uuid),'Supervisor scope must include own and assigned-team shared tasks only');
 perform pg_temp.check_qa((select count(*)=3 from public.get_due_task_alerts((x->>'w')::uuid)),'Supervisor due alerts must follow team scope');
 perform pg_temp.check_qa((select count(*)=0 from public.login_activity),'Supervisors cannot read login history');
 blocked:=false;begin perform public.configure_member((x->>'ms')::uuid,'Admin',null);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot promote themselves');
 blocked:=false;begin update public.tasks set assignee_member_id=(x->>'mc')::uuid where id=(x->>'ta')::uuid;exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot reassign outside team');
 select to_jsonb(t),updated_at into v,stamp from public.tasks t where id=(x->>'ta')::uuid;
 blocked:=false;begin perform public.save_team_task((x->>'ta')::uuid,v,stamp,array[(x->>'mc')::uuid]);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot add outside collaborator');
 new_task_id:=public.save_team_task(gen_random_uuid(),jsonb_build_object('workspace_id',x->>'w','project_id',x->>'p','assignee_member_id',x->>'mb','creator_id',x->>'a','title','Supervisor-created shared task','status','To Do','priority','Medium'),null,array[(x->>'ms')::uuid]);
 perform pg_temp.check_qa((select creator_id=auth.uid() from public.tasks where tasks.id=new_task_id),'Creator must come from verified session');
 blocked:=false;begin perform public.save_team_task((x->>'ta')::uuid,v,stamp-interval '1 second','{}');exception when serialization_failure then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Stale writes must be rejected');
end$$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'b','role','authenticated')::text,true);
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;v jsonb;stamp timestamptz;blocked boolean;begin
 perform pg_temp.check_qa((select count(*)=4 from public.tasks where workspace_id=(x->>'w')::uuid),'Normal user sees own personal and shared tasks only');
 select to_jsonb(t),updated_at into v,stamp from public.tasks t where id=(x->>'shared')::uuid;
 perform public.save_team_task((x->>'shared')::uuid,v||jsonb_build_object('status','Done'),stamp,array[(x->>'mb')::uuid]);
 perform pg_temp.check_qa((select status='Done' from public.tasks where id=(x->>'shared')::uuid),'Collaborator can update shared task');
 blocked:=false;begin perform public.save_team_task((x->>'shared')::uuid,v,(select updated_at from public.tasks where id=(x->>'shared')::uuid),'{}');exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Normal user cannot change participants');
 blocked:=false;begin insert into public.task_collaborators(workspace_id,task_id,member_id) values((x->>'w')::uuid,(x->>'ta')::uuid,(x->>'mc')::uuid);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Client cannot bypass collaboration permissions');
end$$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'a','role','authenticated')::text,true);
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;v jsonb;stamp timestamptz;begin
 select to_jsonb(t),updated_at into v,stamp from public.tasks t where id=(x->>'ta')::uuid;
 perform public.save_team_task((x->>'ta')::uuid,v,stamp,array[(x->>'mc')::uuid]);
 perform public.configure_member((x->>'mb')::uuid,'Member',null);
 perform public.configure_member((x->>'mc')::uuid,'Member',(x->>'ms')::uuid);
end$$;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'s','role','authenticated')::text,true);
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;begin
 perform pg_temp.check_qa(exists(select 1 from public.tasks where id=(x->>'tb')::uuid),'New supervisor assignment takes effect immediately');
end$$;
-- Insert before the final rollback in verify-supervision-and-collaboration.sql.
reset role;
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;d uuid:=gen_random_uuid();w uuid:=gen_random_uuid();m uuid:=gen_random_uuid();p uuid:=gen_random_uuid();t uuid:=gen_random_uuid();begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,created_at,updated_at) values(d,'authenticated','authenticated','qa-'||d||'@example.invalid',now(),false,now(),now());
 insert into public.workspaces(id,name,owner_id) values(w,'Isolated second QA workspace',d);
 insert into public.team_members(id,workspace_id,email,display_name,role,user_id) values(m,w,'qa-'||d||'@example.invalid','Other workspace admin','Admin',d);
 insert into public.projects(id,workspace_id,name,color,created_by) values(p,w,'Unrelated private project','#7350d6',d);
 insert into public.project_members(workspace_id,project_id,member_id) values(w,p,m);
 insert into public.tasks(id,workspace_id,project_id,creator_id,assignee_member_id,title) values(t,w,p,d,m,'Other workspace confidential task');
 perform set_config('teamflow.deep_qa',json_build_object('user',d,'w',w,'m',m,'p',p,'t',t)::text,true);
end$$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'b','role','authenticated')::text,true);
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;y json:=current_setting('teamflow.deep_qa')::json;blocked boolean;v jsonb;stamp timestamptz;new_task uuid;begin
 perform pg_temp.check_qa(not exists(select 1 from public.tasks where workspace_id=(y->>'w')::uuid),'Cross-workspace task reads must be empty');
 perform pg_temp.check_qa(not exists(select 1 from public.team_members where workspace_id=(y->>'w')::uuid),'Cross-workspace member reads must be empty');
 blocked:=false;begin perform public.save_team_task((y->>'t')::uuid,jsonb_build_object('workspace_id',y->>'w','title','Unauthorized change'),now(),'{}');exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Cross-workspace task RPC must be denied');
 blocked:=false;begin perform public.configure_member((y->>'m')::uuid,'Member',null);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Cross-workspace role updates must be denied');
 blocked:=false;begin perform private.write_team_task(gen_random_uuid(),(x->>'w')::uuid,(x->>'p')::uuid,(x->>'mb')::uuid,false,null::public.tasks,'{}');exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Clients cannot call the private privileged writer');
 select to_jsonb(t),updated_at into v,stamp from public.tasks t where id=(x->>'ta')::uuid;
 blocked:=false;begin perform public.save_team_task((x->>'ta')::uuid,v||jsonb_build_object('title','Invalid partially saved change','due_date','2026-10-29','due_at','2026-10-29T10:00:00Z','due_timezone','Invalid/Zone'),stamp,array[(x->>'mc')::uuid]);exception when check_violation then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Invalid time zones must be rejected');
 perform pg_temp.check_qa((select title=v->>'title' from public.tasks where id=(x->>'ta')::uuid),'A rejected update must roll back all fields');
 perform pg_temp.check_qa((select count(*)=1 from public.task_collaborators where task_id=(x->>'ta')::uuid),'A rejected update must retain collaborators');
 new_task:=gen_random_uuid();
 insert into public.tasks(id,workspace_id,project_id,creator_id,assignee_member_id,title,created_at) values(new_task,(x->>'w')::uuid,(x->>'p')::uuid,auth.uid(),(x->>'mb')::uuid,'Timestamp integrity test','2000-01-01');
 perform pg_temp.check_qa((select created_at>=transaction_timestamp()-interval '1 second' from public.tasks where id=new_task),'Task creation time must be server-owned for accurate monthly reporting');
end$$;
reset role;
do $$declare y json:=current_setting('teamflow.deep_qa')::json;begin update auth.users set email_confirmed_at=null where id=(y->>'user')::uuid;end$$;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.deep_qa')::json->>'user','role','authenticated')::text,true);
do $$begin perform pg_temp.check_qa((select count(*)=0 from public.tasks),'An unverified account must have no task access');end$$;
reset role;
set local role anon;
do $$declare blocked boolean:=false;begin
 begin perform public.save_team_task(gen_random_uuid(),'{}',null,'{}');exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Anonymous task saves must be denied');
end$$;
reset role;

reset role;
select set_config('request.jwt.claims',json_build_object('sub',current_setting('teamflow.collaboration_qa')::json->>'s','role','authenticated')::text,true);
set local role authenticated;
do $$declare x json:=current_setting('teamflow.collaboration_qa')::json;blocked boolean;begin
 -- The base fixture currently assigns Bob to this supervisor.
 perform public.configure_member((x->>'mc')::uuid,'Supervisor',null);
 perform pg_temp.check_qa((select role='Supervisor' and managed_by_member_id=(x->>'ms')::uuid from public.team_members where id=(x->>'mc')::uuid),'Supervisor can promote an assigned normal user');
 perform pg_temp.check_qa(not exists(select 1 from public.tasks where id=(x->>'tb')::uuid),'Role management must not inherit another supervisor task data');
 blocked:=false;begin perform public.configure_member((x->>'mc')::uuid,'Admin',null);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot promote an Admin');
 blocked:=false;begin perform public.configure_member((x->>'ma')::uuid,'Member',null);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot modify an existing Admin');
 blocked:=false;begin perform public.configure_member((x->>'mb')::uuid,'Supervisor',null);exception when insufficient_privilege then blocked:=true;end;
 perform pg_temp.check_qa(blocked,'Supervisor cannot manage an unassigned teammate');
 perform public.configure_member((x->>'mc')::uuid,'Member',null);
 perform pg_temp.check_qa(exists(select 1 from public.supervisor_assignments where supervisor_id=(x->>'ms')::uuid and member_id=(x->>'mc')::uuid),'Demotion restores the invited teammate to the supervisor team');
end$$;
reset role;

rollback;
select 'PASS: cross-workspace isolation, timestamp integrity, anonymous/unverified access denial, private helper permissions, rejected-update rollback, supervisor scope, protected personal tasks, shared task access/editing, scoped assignments and alerts, immutable role boundaries, atomic save, stale-write detection, and admin team management. All fixtures rolled back.' as verification;
