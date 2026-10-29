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
