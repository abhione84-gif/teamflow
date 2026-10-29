-- Prevent signed-in clients from backdating tasks and distorting monthly reports.
create or replace function private.stamp_task() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at=now();
  if tg_op='INSERT' and auth.uid() is not null then new.created_at=now();end if;
  if new.status='Done' then
    if tg_op='INSERT' then new.completed_at=now();
    elsif old.status<>'Done' then new.completed_at=now();
    else new.completed_at=old.completed_at;end if;
  else new.completed_at=null;end if;
  return new;
end $$;
