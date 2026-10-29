-- Extend the existing Teamflow schema without deleting tasks or accounts.
alter table public.tasks add column if not exists due_at timestamptz;
alter table public.tasks add column if not exists due_timezone text not null default 'Asia/Bangkok';
update public.tasks set due_at = (due_date + time '17:00') at time zone due_timezone
where due_date is not null and due_at is null;
alter table public.tasks add constraint tasks_deadline_pair check ((due_date is null) = (due_at is null));

create or replace function private.validate_task_deadline() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.due_timezone) then
    raise exception 'Choose a valid time zone.' using errcode='23514';
  end if;
  if new.due_at is not null and new.due_date is distinct from (new.due_at at time zone new.due_timezone)::date then
    raise exception 'The due date and time zone do not match the deadline.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.validate_task_deadline() from public, anon, authenticated;
create trigger validate_task_deadline before insert or update on public.tasks
for each row execute function private.validate_task_deadline();
grant update(due_at, due_timezone) on public.tasks to authenticated;
create index if not exists tasks_open_deadline_idx on public.tasks(due_at) where status <> 'Done' and due_at is not null;

create table public.task_alert_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  due_at timestamptz not null,
  acknowledged_at timestamptz not null default now(),
  primary key(user_id, task_id, due_at)
);
alter table public.task_alert_receipts enable row level security;
revoke all on public.task_alert_receipts from anon, authenticated;
grant select, insert on public.task_alert_receipts to authenticated;
grant all on public.task_alert_receipts to service_role;
create policy own_alert_receipts_read on public.task_alert_receipts for select to authenticated
using (user_id=(select auth.uid()) and private.can_read_task(task_id));
create policy own_alert_receipts_create on public.task_alert_receipts for insert to authenticated with check (
  user_id=(select auth.uid()) and private.can_read_task(task_id)
  and exists(select 1 from public.tasks t where t.id=task_id and t.due_at=task_alert_receipts.due_at and t.due_at<=now() and t.status<>'Done')
);
create index task_alert_receipts_task_idx on public.task_alert_receipts(task_id);

create function public.get_due_task_alerts(p_workspace uuid) returns table (
  task_id uuid, title text, due_at timestamptz, due_timezone text, owner_name text, owner_email text
) language sql stable security invoker set search_path = '' as $$
  select t.id,t.title,t.due_at,t.due_timezone,m.display_name,m.email
  from public.tasks t
  left join public.team_members m on m.workspace_id=t.workspace_id
    and ((not t.personal and m.id=t.assignee_member_id) or (t.personal and m.user_id=t.creator_id))
  where t.workspace_id=p_workspace and t.status<>'Done' and t.due_at<=now()
    and not exists(select 1 from public.task_alert_receipts r where r.user_id=(select auth.uid()) and r.task_id=t.id and r.due_at=t.due_at)
  order by t.due_at,t.id limit 50
$$;
revoke all on function public.get_due_task_alerts(uuid) from public, anon;
grant execute on function public.get_due_task_alerts(uuid) to authenticated;

create table public.login_activity (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid not null,
  email text not null,
  display_name text not null,
  logged_in_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  country text, region text, city text,
  location_source text,
  location_status text not null default 'pending' check(location_status in ('pending','resolved','unavailable','not_public')),
  unique(workspace_id,session_id)
);
alter table public.login_activity enable row level security;
revoke all on public.login_activity from anon, authenticated;
grant select on public.login_activity to authenticated;
grant all on public.login_activity to service_role;
create policy admin_login_activity_read on public.login_activity for select to authenticated using(private.is_admin(workspace_id));
create index login_activity_workspace_time_idx on public.login_activity(workspace_id,logged_in_at desc);
create index login_activity_user_idx on public.login_activity(user_id);

-- The IP and agent come from Supabase Auth's session row, never browser input.
create function private.capture_login_activity() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s auth.sessions%rowtype; m public.team_members%rowtype; a public.login_activity%rowtype; sid uuid;
begin
  if auth.uid() is null or private.current_email() is null then
    raise exception 'A verified session is required.' using errcode='42501';
  end if;
  sid := nullif(auth.jwt()->>'session_id','')::uuid;
  select * into s from auth.sessions where id=sid and user_id=auth.uid() and (not_after is null or not_after>now());
  if not found then raise exception 'The login session is no longer active.' using errcode='42501'; end if;
  select * into m from public.team_members where user_id=auth.uid() and email=private.current_email() order by created_at limit 1;
  if not found then raise exception 'A workspace invitation is required.' using errcode='42501'; end if;
  insert into public.login_activity(workspace_id,user_id,session_id,email,display_name,logged_in_at,ip_address,user_agent,location_status)
  values(m.workspace_id,auth.uid(),s.id,m.email,m.display_name,s.created_at,s.ip,left(s.user_agent,1024),case when s.ip is null then 'unavailable' else 'pending' end)
  on conflict(workspace_id,session_id) do nothing;
  select * into a from public.login_activity where workspace_id=m.workspace_id and session_id=s.id;
  return jsonb_build_object('id',a.id,'ip_address',host(a.ip_address),'needs_location',a.location_status='pending');
end $$;
revoke all on function private.capture_login_activity() from public, anon;
grant execute on function private.capture_login_activity() to authenticated;
create function public.capture_login_activity() returns jsonb
language sql security invoker set search_path = '' as $$ select private.capture_login_activity() $$;
revoke all on function public.capture_login_activity() from public, anon;
grant execute on function public.capture_login_activity() to authenticated;

-- Record every successful workspace entry even if geolocation is unavailable.
create or replace function public.accept_team_invites() returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  n := private.claim_invitations();
  perform private.capture_login_activity();
  return n;
end $$;
notify pgrst,'reload schema';
