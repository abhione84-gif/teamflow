create function private.write_team_task(p_task uuid,w uuid,project uuid,owner uuid,personal boolean,v public.tasks,ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501';end if;
 delete from public.task_collaborators where task_id=p_task;
 if not exists(select 1 from public.tasks where id=p_task) then
  insert into public.tasks(id,workspace_id,project_id,creator_id,personal,assignee_member_id,title,description,status,priority,due_date,due_at,due_timezone,followup_date)
  values(p_task,w,project,auth.uid(),personal,owner,v.title,coalesce(v.description,''),v.status,v.priority,v.due_date,v.due_at,coalesce(v.due_timezone,'Asia/Bangkok'),v.followup_date);
 else
  update public.tasks set project_id=project,assignee_member_id=owner,title=v.title,description=coalesce(v.description,''),status=v.status,priority=v.priority,due_date=v.due_date,due_at=v.due_at,due_timezone=coalesce(v.due_timezone,'Asia/Bangkok'),followup_date=v.followup_date where id=p_task;
 end if;
 insert into public.task_collaborators(workspace_id,task_id,member_id) select w,p_task,x from unnest(ids) x;

end $$;
revoke all on function private.write_team_task(uuid,uuid,uuid,uuid,boolean,public.tasks,uuid[]) from public,anon,authenticated;
