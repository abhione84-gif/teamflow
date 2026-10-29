alter table public.team_members add column managed_by_member_id uuid;
alter table public.team_members add constraint member_manager_workspace_fk foreign key(workspace_id,managed_by_member_id) references public.team_members(workspace_id,id);
alter table public.team_members add constraint member_manager_not_self check(managed_by_member_id is distinct from id);
create index team_members_manager_idx on public.team_members(workspace_id,managed_by_member_id);
update public.team_members m set managed_by_member_id=s.supervisor_id from public.supervisor_assignments s where s.workspace_id=m.workspace_id and s.member_id=m.id;
-- The column is readable, but cannot be changed directly by browser clients.
create function private.can_manage_member(w uuid,target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.team_members me join public.team_members m on m.workspace_id=me.workspace_id
 where me.workspace_id=w and m.id=target and me.user_id=auth.uid() and me.email=private.current_email() and (
  me.role='Admin' or (me.role='Supervisor' and m.id<>me.id and m.role<>'Admin' and (
   (m.role='Member' and exists(select 1 from public.supervisor_assignments s where s.workspace_id=w and s.supervisor_id=me.id and s.member_id=m.id))
   or (m.role='Supervisor' and m.managed_by_member_id=me.id)
  ))))
$$;
revoke all on function private.can_manage_member(uuid,uuid) from public,anon;
grant execute on function private.can_manage_member(uuid,uuid) to authenticated;
create or replace function private.can_view_member(w uuid,m uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.is_member(w) and (private.manages_member(w,m) or private.can_manage_member(w,m) or exists(
 select 1 from public.tasks t where t.workspace_id=w and not t.personal and private.can_read_task(t.id)
 and (t.assignee_member_id=m or exists(select 1 from public.task_collaborators c where c.task_id=t.id and c.member_id=m))))
$$;
create or replace function private.configure_member(p_member uuid,p_role text,p_supervisor uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.team_members%rowtype;me public.team_members%rowtype;boss public.team_members%rowtype;manager uuid;
begin
 select * into m from public.team_members where id=p_member;
 if not found then raise exception 'Member access denied.' using errcode='42501';end if;
 perform 1 from public.workspaces where id=m.workspace_id for update;
 select * into m from public.team_members where id=p_member for update;
 select * into me from public.team_members where workspace_id=m.workspace_id and user_id=auth.uid() and email=private.current_email();
 if not found or not private.can_manage_member(m.workspace_id,m.id) then raise exception 'Manage only members assigned to you.' using errcode='42501';end if;
 if p_role not in ('Admin','Supervisor','Member') then raise exception 'Invalid role.' using errcode='23514';end if;
 manager:=m.managed_by_member_id;
 if me.role='Supervisor' then
  if p_role='Admin' or m.role='Admin' or m.id=me.id then raise exception 'Only admins can manage Admin accounts.' using errcode='42501';end if;
  manager:=me.id;p_supervisor:=case when p_role='Member' then me.id else null end;
 elsif m.role='Admin' and p_role<>'Admin' and (m.user_id=auth.uid() or (select count(*) from public.team_members where workspace_id=m.workspace_id and role='Admin')<2 or exists(select 1 from private.admin_setup where m.email=any(allowed_emails))) then
  raise exception 'This admin account must remain an admin.' using errcode='42501';
 end if;
 if p_supervisor is not null then
  select * into boss from public.team_members where id=p_supervisor and workspace_id=m.workspace_id and role='Supervisor';
  if not found or p_role<>'Member' or p_supervisor=p_member then raise exception 'Choose an eligible supervisor.' using errcode='23514';end if;
 end if;
 if p_role='Member' then manager:=p_supervisor;elsif p_role='Admin' then manager:=null;end if;
 update public.team_members set role=p_role,managed_by_member_id=manager where id=m.id;
 delete from public.supervisor_assignments where workspace_id=m.workspace_id and (member_id=m.id or (supervisor_id=m.id and p_role<>'Supervisor'));
 if p_supervisor is not null then insert into public.supervisor_assignments(workspace_id,supervisor_id,member_id) values(m.workspace_id,p_supervisor,m.id);end if;
end $$;
notify pgrst,'reload schema';
