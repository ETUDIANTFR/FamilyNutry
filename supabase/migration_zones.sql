create table if not exists public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.zone_members (
  zone_id uuid not null references public.zones (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (zone_id, user_id)
);

insert into public.zones (name)
values ('Zone 1')
on conflict (name) do nothing;

alter table public.products add column if not exists zone_id uuid references public.zones (id);
alter table public.meals add column if not exists zone_id uuid references public.zones (id);
alter table public.calendar_events add column if not exists zone_id uuid references public.zones (id);
alter table public.calendar_events add column if not exists color text not null default '#4F7548';
alter table public.shopping_list_items add column if not exists zone_id uuid references public.zones (id);

update public.products
set zone_id = (select id from public.zones where name = 'Zone 1')
where zone_id is null;

update public.meals
set zone_id = (select id from public.zones where name = 'Zone 1')
where zone_id is null;

update public.calendar_events
set zone_id = (select id from public.zones where name = 'Zone 1')
where zone_id is null;

update public.shopping_list_items
set zone_id = (select id from public.zones where name = 'Zone 1')
where zone_id is null;

alter table public.products alter column zone_id set not null;
alter table public.meals alter column zone_id set not null;
alter table public.calendar_events alter column zone_id set not null;
alter table public.shopping_list_items alter column zone_id set not null;

alter table public.calendar_events
  drop constraint if exists calendar_events_color_check;
alter table public.calendar_events
  add constraint calendar_events_color_check
  check (color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.products drop constraint if exists products_barcode_key;
create unique index if not exists products_zone_barcode_key
  on public.products (zone_id, barcode);

insert into public.zone_members (zone_id, user_id)
select zones.id, profiles.id
from public.zones
cross join public.profiles
where zones.name = 'Zone 1'
  and profiles.status = 'approved'
on conflict do nothing;

create or replace function public.has_zone_access(p_zone_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_admin())
    or (
      (select public.is_approved_member())
      and exists (
        select 1
        from public.zone_members
        where zone_id = p_zone_id and user_id = (select auth.uid())
      )
    );
$$;

create or replace function public.assign_default_zone_to_approved_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_zone_id uuid;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if exists (select 1 from public.zone_members where user_id = new.id) then
    return new;
  end if;

  select id into default_zone_id from public.zones where name = 'Zone 1';
  if default_zone_id is null then
    raise exception 'La Zone 1 par défaut est introuvable.';
  end if;

  insert into public.zone_members (zone_id, user_id)
  values (default_zone_id, new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists assign_default_zone_after_approval on public.profiles;
create trigger assign_default_zone_after_approval
  after insert or update of status on public.profiles
  for each row
  when (new.status = 'approved')
  execute procedure public.assign_default_zone_to_approved_member();

alter table public.zones enable row level security;
alter table public.zone_members enable row level security;

drop policy if exists "Members can read their own profile and admins can read all" on public.profiles;
create policy "Members can read their own profile and admins can read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins can approve members" on public.profiles;
create policy "Admins can approve members"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Approved members can read shared products" on public.products;
create policy "Approved members can read shared products"
  on public.products for select to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can add shared products" on public.products;
create policy "Approved members can add shared products"
  on public.products for insert to authenticated
  with check (
    (select public.has_zone_access(zone_id))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

drop policy if exists "Approved members can update shared products" on public.products;
create policy "Approved members can update shared products"
  on public.products for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)) and updated_by = (select auth.uid()));

drop policy if exists "Approved members can remove shared products" on public.products;
create policy "Approved members can remove shared products"
  on public.products for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can read shared meals" on public.meals;
create policy "Approved members can read shared meals"
  on public.meals for select to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can add shared meals" on public.meals;
create policy "Approved members can add shared meals"
  on public.meals for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared meals" on public.meals;
create policy "Approved members can update shared meals"
  on public.meals for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can remove shared meals" on public.meals;
create policy "Approved members can remove shared meals"
  on public.meals for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can read shared calendar events" on public.calendar_events;
create policy "Approved members can read shared calendar events"
  on public.calendar_events for select to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can add shared calendar events" on public.calendar_events;
create policy "Approved members can add shared calendar events"
  on public.calendar_events for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared calendar events" on public.calendar_events;
create policy "Approved members can update shared calendar events"
  on public.calendar_events for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can remove shared calendar events" on public.calendar_events;
create policy "Approved members can remove shared calendar events"
  on public.calendar_events for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can read shared shopping items" on public.shopping_list_items;
create policy "Approved members can read shared shopping items"
  on public.shopping_list_items for select to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can add shared shopping items" on public.shopping_list_items;
create policy "Approved members can add shared shopping items"
  on public.shopping_list_items for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared shopping items" on public.shopping_list_items;
create policy "Approved members can update shared shopping items"
  on public.shopping_list_items for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

drop policy if exists "Approved members can remove shared shopping items" on public.shopping_list_items;
create policy "Approved members can remove shared shopping items"
  on public.shopping_list_items for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

drop policy if exists "Members can read accessible zones" on public.zones;
create policy "Members can read accessible zones"
  on public.zones for select to authenticated
  using ((select public.has_zone_access(id)));

drop policy if exists "Admins can create zones" on public.zones;
create policy "Admins can create zones"
  on public.zones for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update zones" on public.zones;
create policy "Admins can update zones"
  on public.zones for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can remove zones" on public.zones;
create policy "Admins can remove zones"
  on public.zones for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Members can read their zone memberships" on public.zone_members;
create policy "Members can read their zone memberships"
  on public.zone_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins can grant zone access" on public.zone_members;
create policy "Admins can grant zone access"
  on public.zone_members for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can revoke zone access" on public.zone_members;
create policy "Admins can revoke zone access"
  on public.zone_members for delete to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.zones to authenticated;
grant select, insert, delete on public.zone_members to authenticated;
grant execute on function public.has_zone_access(uuid) to authenticated;

notify pgrst, 'reload schema';

do $$
begin
  alter publication supabase_realtime add table public.zones;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.zone_members;
exception when duplicate_object then
  null;
end;
$$;
