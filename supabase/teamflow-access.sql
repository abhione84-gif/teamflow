-- Tighten the existing Teamflow database to invitation-only, per-person access.
-- No task rows or existing users are deleted by this change.
alter table private.admin_setup add column if not exists allowed_emails text[] not null default '{}';
update private.admin_setup
set email = 'abhilash@cartafella.com', display_name = 'Abhilash',
    allowed_emails = array['abhilash@cartafella.com', 'abhione84@gmail.com']
where singleton and workspace_id is null;

create or replace function private.is_member(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members m where m.workspace_id = w
    and m.user_id = auth.uid() and m.email = private.current_email()
  )
$$;
create or replace function private.is_admin(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members m where m.workspace_id = w
    and m.user_id = auth.uid() and m.email = private.current_email() and m.role = 'Admin'
  )
$$;
create or replace function private.can_access_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.projects pr where pr.id = p and private.is_member(pr.workspace_id)
    and (private.is_admin(pr.workspace_id) or exists (
      select 1 from public.project_members pm join public.team_members m
      on m.id = pm.member_id and m.workspace_id = pm.workspace_id
      where pm.project_id = pr.id and m.user_id = auth.uid()
    ))
  )
$$;
create or replace function private.can_read_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.tasks ts where ts.id = t and private.is_member(ts.workspace_id)
    and (private.is_admin(ts.workspace_id)
      or (ts.personal and ts.creator_id = auth.uid())
      or (not ts.personal and exists (
        select 1 from public.team_members m where m.id = ts.assignee_member_id
        and m.workspace_id = ts.workspace_id and m.user_id = auth.uid()
      )))
  )
$$;
create or replace function private.can_edit_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.can_read_task(t)
$$;

drop policy if exists task_read on public.tasks;
create policy task_read on public.tasks for select to authenticated
using (private.can_read_task(id));
drop policy if exists task_create on public.tasks;
create policy task_create on public.tasks for insert to authenticated with check (
  creator_id = (select auth.uid()) and private.is_member(workspace_id)
  and (
    (personal and project_id is null and assignee_member_id is null)
    or (not personal and private.can_access_project(project_id) and (
      private.is_admin(workspace_id) or exists (
        select 1 from public.team_members m where m.id = assignee_member_id
        and m.workspace_id = tasks.workspace_id and m.user_id = (select auth.uid())
      )
    ))
  )
);
drop policy if exists task_update on public.tasks;
create policy task_update on public.tasks for update to authenticated
using (private.can_edit_task(id)) with check (private.can_edit_task(id));
drop policy if exists task_delete on public.tasks;
create policy task_delete on public.tasks for delete to authenticated using (private.is_admin(workspace_id));
drop policy if exists member_read on public.team_members;
create policy member_read on public.team_members for select to authenticated
using (private.is_admin(workspace_id) or (user_id = (select auth.uid()) and private.is_member(workspace_id)));
drop policy if exists project_member_read on public.project_members;
create policy project_member_read on public.project_members for select to authenticated
using (private.is_admin(workspace_id) or exists (
  select 1 from public.team_members m where m.id = member_id and m.workspace_id = project_members.workspace_id
  and m.user_id = (select auth.uid()) and private.is_member(m.workspace_id)
));

create or replace function private.protect_task_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if new.workspace_id is distinct from old.workspace_id
     or new.creator_id is distinct from old.creator_id
     or new.personal is distinct from old.personal then
    raise exception 'Task identity cannot be changed.' using errcode = '42501';
  end if;
  if not private.is_admin(old.workspace_id) and (
    new.assignee_member_id is distinct from old.assignee_member_id
    or new.project_id is distinct from old.project_id
  ) then
    raise exception 'Only an admin can change a task assignment.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.protect_task_assignment() from public, anon, authenticated;
drop trigger if exists protect_task_assignment on public.tasks;
create trigger protect_task_assignment before update on public.tasks
for each row execute function private.protect_task_assignment();

create or replace function private.initialize_admin() returns uuid
language plpgsql security definer set search_path = '' as $$
declare cfg private.admin_setup%rowtype; w uuid; e text; m uuid; p uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  e := private.current_email();
  select * into cfg from private.admin_setup where singleton for update;
  if not found or e is null or not (e = any(cfg.allowed_emails)) then
    raise exception 'Admin setup is reserved for a configured, verified email.' using errcode = '42501';
  end if;
  w := cfg.workspace_id;
  if w is null then
    insert into public.workspaces(name, owner_id) values ('Abhi''s workspace', auth.uid()) returning id into w;
    update private.admin_setup set workspace_id = w, claimed_by = auth.uid() where singleton;
  end if;
  select id into m from public.team_members where workspace_id = w and email = e;
  if m is null then
    insert into public.team_members(workspace_id, email, display_name, role, user_id)
    values (w, e, 'Abhilash', 'Admin', auth.uid()) returning id into m;
  else
    if exists (select 1 from public.team_members where id = m and user_id is not null and user_id <> auth.uid()) then
      raise exception 'This admin membership is already linked.' using errcode = '42501';
    end if;
    update public.team_members set user_id = auth.uid(), role = 'Admin' where id = m;
  end if;
  select id into p from public.projects where workspace_id = w and name = 'General' order by created_at limit 1;
  if p is null then
    insert into public.projects(workspace_id, name, color, created_by)
    values (w, 'General', '#7350d6', auth.uid()) returning id into p;
  end if;
  insert into public.project_members(workspace_id, project_id, member_id) values (w, p, m) on conflict do nothing;
  return w;
end $$;

-- Role and membership changes are made by the authenticated admin Edge Function.
revoke insert on public.team_members from authenticated;
revoke insert on public.workspaces from authenticated;
revoke execute on function public.create_team(text, text) from public, anon, authenticated;
revoke all on private.admin_setup from public, anon, authenticated;
grant select, insert, delete on public.tasks to authenticated;
grant update(title, description, status, priority, due_date, followup_date, checklist, assignee_member_id, project_id) on public.tasks to authenticated;
grant execute on function public.initialize_admin() to authenticated;
grant execute on function public.accept_team_invites() to authenticated;
notify pgrst, 'reload schema';
