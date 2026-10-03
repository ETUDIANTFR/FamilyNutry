create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null unique,
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
  updated_at timestamptz not null default now()
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  planned_for date,
  notes text,
  created_by uuid not null references public.profiles (id),
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

create policy "Members can read their own profile and admins can read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "Admins can approve members"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Approved members can read shared products"
  on public.products for select to authenticated
  using ((select public.is_approved_member()));

create policy "Approved members can add shared products"
  on public.products for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));

create policy "Approved members can update shared products"
  on public.products for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()) and updated_by = (select auth.uid()));

create policy "Approved members can remove shared products"
  on public.products for delete to authenticated
  using ((select public.is_approved_member()));

create policy "Approved members can read shared meals"
  on public.meals for select to authenticated
  using ((select public.is_approved_member()));

create policy "Approved members can add shared meals"
  on public.meals for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()));

create policy "Approved members can update shared meals"
  on public.meals for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()));

create policy "Approved members can remove shared meals"
  on public.meals for delete to authenticated
  using ((select public.is_approved_member()));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.meals to authenticated;
grant execute on function public.consume_product(uuid, numeric) to authenticated;

alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.meals;

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
