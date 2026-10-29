create function private.save_team_task(p_task uuid,p_values jsonb,p_expected_updated_at timestamptz,p_collaborators uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.tasks%rowtype; v public.tasks%rowtype; me public.team_members%rowtype; w uuid; project uuid; owner uuid; personal boolean; ids uuid[]; manager boolean;
begin
 if auth.uid() is null or private.current_email() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 v:=jsonb_populate_record(null::public.tasks,p_values);
 select * into old from public.tasks where id=p_task for update;
 w:=coalesce(old.workspace_id,v.workspace_id);
 select * into me from public.team_members where workspace_id=w and user_id=auth.uid() and email=private.current_email();
 if not found then raise exception 'Workspace access is required.' using errcode='42501'; end if;
 personal:=coalesce(old.personal,v.personal,false);project:=v.project_id;owner:=v.assignee_member_id;
 if personal then project:=null;owner:=null;end if;
 select coalesce(array_agg(distinct x order by x),'{}'::uuid[]) into ids from unnest(coalesce(p_collaborators,'{}'::uuid[])) x where x is not null and x is distinct from owner;
 manager:=me.role='Admin' or (me.role='Supervisor' and not personal and (old.id is null or private.manages_member(w,old.assignee_member_id)) and private.manages_member(w,owner));
 if old.id is not null then
  if not private.can_edit_task(old.id) then raise exception 'Task access denied.' using errcode='42501';end if;
  if p_expected_updated_at is distinct from old.updated_at then raise exception 'Task changed. Reload and try again.' using errcode='40001';end if;
 elsif not personal and (not private.can_access_project(project) or not private.manages_member(w,owner)) then raise exception 'Assignment outside project or team access.' using errcode='42501';end if;
 perform private.check_task_collaborators(p_task,w,owner,ids,personal);
 if not personal then
  if not exists(select 1 from public.projects where id=project and workspace_id=w) or (select count(*) from public.team_members where workspace_id=w and id=any(ids||array[owner]))<>cardinality(ids)+1 then raise exception 'Choose workspace participants.' using errcode='23514';end if;
  if manager then insert into public.project_members(workspace_id,project_id,member_id) select w,project,x from unnest(ids||array[owner]) x on conflict do nothing;end if;
 end if;
 perform private.write_team_task(p_task,w,project,owner,personal,v,ids);
 return p_task;
end $$;
