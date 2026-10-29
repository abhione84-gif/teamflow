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
