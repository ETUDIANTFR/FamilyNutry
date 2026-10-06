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

create table if not exists public.storage_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  kind text not null check (kind in ('inventory', 'shopping')),
  icon text not null default 'folder',
  color text not null default '#dfe9d8',
  zone_id uuid not null references public.zones (id) on delete cascade,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create unique index if not exists storage_folders_zone_kind_name_idx
  on public.storage_folders (zone_id, kind, name);

alter table public.storage_folders enable row level security;

alter table public.shopping_list_items
  add column if not exists image_url text,
  add column if not exists nutriscore text,
  add column if not exists folder_id uuid references public.storage_folders (id) on delete set null;

alter table public.products
  add column if not exists folder_id uuid references public.storage_folders (id) on delete set null;

alter table public.shopping_list_items
  alter column zone_id set not null;

create index if not exists storage_folders_zone_kind_idx
  on public.storage_folders (zone_id, kind, name);

create index if not exists shopping_list_items_folder_idx
  on public.shopping_list_items (folder_id);

create index if not exists products_folder_idx
  on public.products (folder_id);

drop policy if exists "Approved members can read shared folders" on public.storage_folders;
create policy "Approved members can read shared folders"
  on public.storage_folders for select to authenticated
  using ((select public.is_approved_member()));

drop policy if exists "Approved members can create shared folders" on public.storage_folders;
create policy "Approved members can create shared folders"
  on public.storage_folders for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared folders" on public.storage_folders;
create policy "Approved members can update shared folders"
  on public.storage_folders for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()));

drop policy if exists "Approved members can remove shared folders" on public.storage_folders;
create policy "Approved members can remove shared folders"
  on public.storage_folders for delete to authenticated
  using ((select public.is_approved_member()));

grant select, insert, update, delete on public.storage_folders to authenticated;

with default_folder as (
  select z.id as zone_id, z.name,
         case z.name when 'Nature' then 'shopping' else 'inventory' end as kind
  from public.zones z
  where z.name in ('Frigo', 'Congélateur', 'Étagère', 'Nature')
)
insert into public.storage_folders (name, kind, icon, color, zone_id, created_by)
select
  df.name,
  df.kind,
  case df.name
    when 'Frigo' then '🧊'
    when 'Congélateur' then '❄'
    when 'Étagère' then '▤'
    else '🛒'
  end,
  case df.name
    when 'Frigo' then '#dfeeff'
    when 'Congélateur' then '#eaf5ff'
    when 'Étagère' then '#f2e4d4'
    else '#e3f1dc'
  end,
  df.zone_id,
  (select auth.uid())
from default_folder df
on conflict (zone_id, kind, name) do nothing;

revoke all on function public.revoke_member(uuid) from public;
grant execute on function public.revoke_member(uuid) to authenticated;
notify pgrst, 'reload schema';
