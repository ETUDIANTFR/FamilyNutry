alter table public.profiles
  add column if not exists last_sign_in_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'approved', 'revoked'));

update public.profiles as profile
set last_sign_in_at = auth_user.last_sign_in_at
from auth.users as auth_user
where profile.id = auth_user.id
  and auth_user.last_sign_in_at is not null;

create or replace function public.sync_profile_last_sign_in()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set last_sign_in_at = new.last_sign_in_at
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_profile_last_sign_in on auth.users;
create trigger sync_profile_last_sign_in
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute procedure public.sync_profile_last_sign_in();

create or replace function public.revoke_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'Seul un administrateur peut révoquer un accès.';
  end if;

  update public.profiles
  set status = 'revoked'
  where id = p_user_id
    and id <> (select auth.uid())
    and role = 'member'
    and status = 'approved';

  if not found then
    raise exception 'Ce compte ne peut pas être révoqué.';
  end if;
end;
$$;

revoke all on function public.revoke_member(uuid) from public;
grant execute on function public.revoke_member(uuid) to authenticated;
