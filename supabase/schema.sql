create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.zone_members (
  zone_id uuid not null references public.zones (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (zone_id, user_id)
);

insert into public.zones (name)
values ('Zone 1');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id),
  barcode text not null,
  product_name text not null,
  brand text,
  quantity_label text,
  category text,
  nutriscore text check (nutriscore is null or nutriscore in ('a', 'b', 'c', 'd', 'e')),
  nova_group integer check (nova_group is null or nova_group between 1 and 4),
  image_url text,
  quantity numeric(10, 3) not null default 1 check (quantity > 0),
  quantity_unit text not null default 'unité',
  expiration_date date,
  created_by uuid not null references public.profiles (id),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zone_id, barcode)
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id),
  name text not null check (length(trim(name)) between 1 and 120),
  planned_for date,
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id),
  title text not null check (length(trim(title)) between 1 and 160),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default '#4F7548' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id),
  name text not null check (length(trim(name)) between 1 and 120),
  is_checked boolean not null default false,
  quantity numeric(10, 3) not null default 1 check (quantity > 0),
  expiration_date date,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved' and role = 'admin'
  );
$$;

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
        select 1 from public.zone_members
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
  if new.status <> 'approved' then return new; end if;
  if exists (select 1 from public.zone_members where user_id = new.id) then return new; end if;

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

create trigger assign_default_zone_after_approval
  after insert or update of status on public.profiles
  for each row
  when (new.status = 'approved')
  execute procedure public.assign_default_zone_to_approved_member();

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

create trigger sync_profile_last_sign_in
  after update of last_sign_in_at on auth.users
  for each row
  when (new.last_sign_in_at is distinct from old.last_sign_in_at)
  execute procedure public.sync_profile_last_sign_in();

update public.profiles as profile
set last_sign_in_at = auth_user.last_sign_in_at
from auth.users as auth_user
where profile.id = auth_user.id
  and auth_user.last_sign_in_at is not null;

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
notify pgrst, 'reload schema';

create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.consume_product(p_product_id uuid, p_amount numeric)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_quantity numeric;
begin
  if p_amount <= 0 then
    raise exception 'La quantité consommée doit être supérieure à zéro.';
  end if;

  select quantity into current_quantity
  from public.products
  where id = p_product_id
  for update;

  if current_quantity is null or p_amount > current_quantity then
    raise exception 'Stock insuffisant ou produit inaccessible.';
  end if;

  if p_amount = current_quantity then
    delete from public.products where id = p_product_id;
  else
    update public.products
    set quantity = current_quantity - p_amount, updated_by = (select auth.uid())
    where id = p_product_id;
  end if;
end;
$$;

create trigger set_product_updated_at
  before update on public.products
  for each row execute procedure public.set_product_updated_at();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.meals enable row level security;
alter table public.calendar_events enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.zones enable row level security;
alter table public.zone_members enable row level security;

create policy "Members can read their own profile and admins can read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "Admins can approve members"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Approved members can read shared products"
  on public.products for select to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can add shared products"
  on public.products for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));

create policy "Approved members can update shared products"
  on public.products for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)) and updated_by = (select auth.uid()));

create policy "Approved members can remove shared products"
  on public.products for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can read shared meals"
  on public.meals for select to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can add shared meals"
  on public.meals for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

create policy "Approved members can update shared meals"
  on public.meals for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

create policy "Approved members can remove shared meals"
  on public.meals for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can read shared calendar events"
  on public.calendar_events for select to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can add shared calendar events"
  on public.calendar_events for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

create policy "Approved members can update shared calendar events"
  on public.calendar_events for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

create policy "Approved members can remove shared calendar events"
  on public.calendar_events for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can read shared shopping items"
  on public.shopping_list_items for select to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Approved members can add shared shopping items"
  on public.shopping_list_items for insert to authenticated
  with check ((select public.has_zone_access(zone_id)) and created_by = (select auth.uid()));

create policy "Approved members can update shared shopping items"
  on public.shopping_list_items for update to authenticated
  using ((select public.has_zone_access(zone_id)))
  with check ((select public.has_zone_access(zone_id)));

create policy "Approved members can remove shared shopping items"
  on public.shopping_list_items for delete to authenticated
  using ((select public.has_zone_access(zone_id)));

create policy "Members can read accessible zones"
  on public.zones for select to authenticated
  using ((select public.has_zone_access(id)));

create policy "Admins can create zones"
  on public.zones for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins can update zones"
  on public.zones for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins can remove zones"
  on public.zones for delete to authenticated
  using ((select public.is_admin()));

create policy "Members can read their zone memberships"
  on public.zone_members for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Admins can grant zone access"
  on public.zone_members for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins can revoke zone access"
  on public.zone_members for delete to authenticated
  using ((select public.is_admin()));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.meals to authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, update, delete on public.shopping_list_items to authenticated;
grant select, insert, update, delete on public.zones to authenticated;
grant select, insert, delete on public.zone_members to authenticated;
grant execute on function public.consume_product(uuid, numeric) to authenticated;
grant execute on function public.has_zone_access(uuid) to authenticated;

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.meals;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.shopping_list_items;
alter publication supabase_realtime add table public.zones;
alter publication supabase_realtime add table public.zone_members;

create or replace function public.enforce_user_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('nutriscan-user-limit'));
  if (select count(*) from auth.users) >= 10 then
    raise exception 'Le groupe NutriScan a atteint sa limite de 10 comptes.';
  end if;
  return new;
end;
$$;

create trigger enforce_user_limit_before_signup
  before insert on auth.users
  for each row execute procedure public.enforce_user_limit();

create unique index profiles_single_admin
  on public.profiles (role)
  where role = 'admin';
