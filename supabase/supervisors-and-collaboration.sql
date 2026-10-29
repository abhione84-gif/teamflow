-- Extend the existing workspace. No existing tasks or accounts are removed.
alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check(role in ('Admin','Supervisor','Member'));
alter table public.tasks add constraint tasks_workspace_id_id_key unique(workspace_id,id);
create table public.supervisor_assignments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supervisor_id uuid not null, member_id uuid not null,
  primary key(workspace_id,member_id),
  foreign key(workspace_id,supervisor_id) references public.team_members(workspace_id,id) on delete cascade,
  foreign key(workspace_id,member_id) references public.team_members(workspace_id,id) on delete cascade,
  check(supervisor_id<>member_id)
);
create index supervisor_assignments_supervisor_idx on public.supervisor_assignments(workspace_id,supervisor_id);
create table public.task_collaborators (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, task_id uuid not null, member_id uuid not null,
  created_at timestamptz not null default now(),
  unique(workspace_id,task_id,member_id),
  foreign key(workspace_id,task_id) references public.tasks(workspace_id,id) on delete cascade,
  foreign key(workspace_id,member_id) references public.team_members(workspace_id,id) on delete cascade
);
create index task_collaborators_member_idx on public.task_collaborators(workspace_id,member_id);
alter table public.supervisor_assignments enable row level security;
alter table public.task_collaborators enable row level security;
revoke all on public.supervisor_assignments,public.task_collaborators from anon,authenticated;
grant select on public.supervisor_assignments,public.task_collaborators to authenticated;
grant all on public.supervisor_assignments,public.task_collaborators to service_role;

create function private.is_supervisor(w uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.team_members where workspace_id=w and user_id=auth.uid() and email=private.current_email() and role='Supervisor')
$$;
create function private.manages_member(w uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.team_members me where me.workspace_id=w and me.user_id=auth.uid() and me.email=private.current_email()
    and (me.role='Admin' or me.id=m or (me.role='Supervisor' and exists(
      select 1 from public.supervisor_assignments s join public.team_members target on target.id=s.member_id and target.workspace_id=s.workspace_id
      where s.workspace_id=w and s.supervisor_id=me.id and s.member_id=m and target.role='Member'))))
$$;
create or replace function private.can_read_task(t uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.tasks ts where ts.id=t and private.is_member(ts.workspace_id)
    and (private.is_admin(ts.workspace_id) or (ts.personal and ts.creator_id=auth.uid()) or (not ts.personal and (
      private.manages_member(ts.workspace_id,ts.assignee_member_id) or exists(select 1 from public.task_collaborators c where c.task_id=ts.id and c.workspace_id=ts.workspace_id and private.manages_member(ts.workspace_id,c.member_id))
    ))))
$$;
create or replace function private.can_access_project(p uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.projects pr where pr.id=p and private.is_member(pr.workspace_id)
    and (private.is_admin(pr.workspace_id) or exists(select 1 from public.project_members pm where pm.project_id=pr.id and pm.workspace_id=pr.workspace_id and private.manages_member(pr.workspace_id,pm.member_id))))
$$;
create function private.can_view_member(w uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.is_member(w) and (private.manages_member(w,m) or exists(
    select 1 from public.tasks t where t.workspace_id=w and not t.personal and private.can_read_task(t.id)
    and (t.assignee_member_id=m or exists(select 1 from public.task_collaborators c where c.task_id=t.id and c.member_id=m))))
$$;
revoke all on function private.is_supervisor(uuid),private.manages_member(uuid,uuid),private.can_view_member(uuid,uuid) from public,anon;
grant execute on function private.is_supervisor(uuid),private.manages_member(uuid,uuid),private.can_view_member(uuid,uuid) to authenticated;
drop policy member_read on public.team_members;
create policy member_read on public.team_members for select to authenticated using(private.can_view_member(workspace_id,id));
create policy supervisor_assignment_read on public.supervisor_assignments for select to authenticated using(private.is_admin(workspace_id) or exists(select 1 from public.team_members m where m.id=supervisor_id and m.user_id=(select auth.uid()) and m.role='Supervisor' and private.is_member(workspace_id)));
create policy collaborator_read on public.task_collaborators for select to authenticated using(private.can_read_task(task_id));
drop policy task_create on public.tasks;
create policy task_create on public.tasks for insert to authenticated with check(
  creator_id=(select auth.uid()) and private.is_member(workspace_id) and ((personal and project_id is null and assignee_member_id is null)
    or (not personal and private.can_access_project(project_id) and private.manages_member(workspace_id,assignee_member_id)))
);
create or replace function private.protect_task_assignment() returns trigger language plpgsql set search_path='' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.workspace_id is distinct from old.workspace_id or new.creator_id is distinct from old.creator_id or new.personal is distinct from old.personal then
    raise exception 'Task identity cannot be changed.' using errcode='42501'; end if;
  if new.project_id is distinct from old.project_id and not private.is_admin(old.workspace_id) then
    raise exception 'Only admins can move existing tasks between projects.' using errcode='42501'; end if;
  if new.assignee_member_id is distinct from old.assignee_member_id and not private.is_admin(old.workspace_id) and not (
    private.is_supervisor(old.workspace_id) and private.manages_member(old.workspace_id,old.assignee_member_id) and private.manages_member(old.workspace_id,new.assignee_member_id)
  ) then raise exception 'This assignment is outside your team.' using errcode='42501'; end if;
  if new.project_id is distinct from old.project_id and exists(select 1 from public.task_collaborators c where c.task_id=old.id and not exists(
    select 1 from public.project_members pm where pm.workspace_id=new.workspace_id and pm.project_id=new.project_id and pm.member_id=c.member_id)) then
    raise exception 'Move task collaborators into the new project first.' using errcode='23514'; end if;
  return new;
end $$;
-- The task trigger must inspect collaborator rows even when the caller cannot.
alter function private.protect_task_assignment() security definer;

create function private.configure_member(p_member uuid,p_role text,p_supervisor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare m public.team_members%rowtype; boss public.team_members%rowtype;
begin
  select * into m from public.team_members where id=p_member;
  if not found or not private.is_admin(m.workspace_id) then raise exception 'Only admins can manage roles and teams.' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=m.workspace_id for update;
  if p_role not in ('Admin','Supervisor','Member') then raise exception 'Invalid role.' using errcode='23514'; end if;
  if m.role='Admin' and p_role<>'Admin' and (m.user_id=auth.uid() or (select count(*) from public.team_members where workspace_id=m.workspace_id and role='Admin')<2 or exists(select 1 from private.admin_setup where m.email=any(allowed_emails))) then
    raise exception 'This admin account must remain an admin.' using errcode='42501'; end if;
  if p_supervisor is not null then
    select * into boss from public.team_members where id=p_supervisor and workspace_id=m.workspace_id and role='Supervisor';
    if not found or p_role<>'Member' or p_supervisor=p_member then raise exception 'Choose a supervisor from this workspace for a normal teammate.' using errcode='23514'; end if;
  end if;
  update public.team_members set role=p_role where id=m.id;
  delete from public.supervisor_assignments where workspace_id=m.workspace_id and (member_id=m.id or (supervisor_id=m.id and p_role<>'Supervisor'));
  if p_supervisor is not null then insert into public.supervisor_assignments(workspace_id,supervisor_id,member_id) values(m.workspace_id,p_supervisor,m.id); end if;
end $$;
revoke all on function private.configure_member(uuid,text,uuid) from public,anon;
grant execute on function private.configure_member(uuid,text,uuid) to authenticated;
create function public.configure_member(p_member uuid,p_role text,p_supervisor uuid default null) returns void language sql security invoker set search_path='' as $$select private.configure_member(p_member,p_role,p_supervisor)$$;
revoke all on function public.configure_member(uuid,text,uuid) from public,anon;
grant execute on function public.configure_member(uuid,text,uuid) to authenticated;

-- Save task fields and its participant list atomically, including scope checks.
create function private.check_task_collaborators(t uuid,w uuid,owner uuid,ids uuid[],personal boolean) returns void language plpgsql security definer set search_path='' as $$
declare me public.team_members%rowtype; old_owner uuid; old_ids uuid[]; changed uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first.' using errcode='42501'; end if;
 select * into me from public.team_members where workspace_id=w and user_id=auth.uid() and email=private.current_email();
 select assignee_member_id into old_owner from public.tasks where id=t;
 select coalesce(array_agg(member_id order by member_id),'{}'::uuid[]) into old_ids from public.task_collaborators where task_id=t;
 if cardinality(ids)>19 or (personal and cardinality(ids)>0) then raise exception 'Personal tasks cannot be shared; maximum 20 participants.' using errcode='23514'; end if;
 if old_ids is distinct from ids then
  if not (me.role='Admin' or (me.role='Supervisor' and not personal and (old_owner is null or private.manages_member(w,old_owner)) and private.manages_member(w,owner))) then raise exception 'Only admins or responsible supervisors can change collaborators.' using errcode='42501'; end if;
  if me.role<>'Admin' then
   for changed in select x from (select unnest(ids) x except select unnest(old_ids)) a union select x from (select unnest(old_ids) x except select unnest(ids)) b loop
    if not private.manages_member(w,changed) then raise exception 'A collaborator is outside your assigned team.' using errcode='42501'; end if;
   end loop;
  end if;
 end if;
end $$;
revoke all on function private.check_task_collaborators(uuid,uuid,uuid,uuid[],boolean) from public,anon,authenticated;
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
revoke all on function private.save_team_task(uuid,jsonb,timestamptz,uuid[]) from public,anon;
grant execute on function private.save_team_task(uuid,jsonb,timestamptz,uuid[]) to authenticated;
create function public.save_team_task(p_task uuid,p_values jsonb,p_expected_updated_at timestamptz default null,p_collaborators uuid[] default '{}') returns uuid language sql security invoker set search_path='' as $$select private.save_team_task(p_task,p_values,p_expected_updated_at,p_collaborators)$$;
revoke all on function public.save_team_task(uuid,jsonb,timestamptz,uuid[]) from public,anon;
grant execute on function public.save_team_task(uuid,jsonb,timestamptz,uuid[]) to authenticated;
notify pgrst,'reload schema';
