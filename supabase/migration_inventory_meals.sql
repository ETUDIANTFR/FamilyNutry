alter table public.products
  alter column quantity type numeric(10, 3) using quantity::numeric,
  add column if not exists quantity_unit text not null default 'unité',
  add column if not exists expiration_date date;

create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  planned_for date,
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.meals enable row level security;

drop policy if exists "Approved members can read shared meals" on public.meals;
create policy "Approved members can read shared meals"
  on public.meals for select to authenticated
  using ((select public.is_approved_member()));

drop policy if exists "Approved members can add shared meals" on public.meals;
create policy "Approved members can add shared meals"
  on public.meals for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared meals" on public.meals;
create policy "Approved members can update shared meals"
  on public.meals for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()));

drop policy if exists "Approved members can remove shared meals" on public.meals;
create policy "Approved members can remove shared meals"
  on public.meals for delete to authenticated
  using ((select public.is_approved_member()));

grant select, insert, update, delete on public.meals to authenticated;

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
grant execute on function public.consume_product(uuid, numeric) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.meals;
exception when duplicate_object then
  null;
end;
$$;

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

drop trigger if exists enforce_user_limit_before_signup on auth.users;
create trigger enforce_user_limit_before_signup
  before insert on auth.users
  for each row execute procedure public.enforce_user_limit();

create unique index if not exists profiles_single_admin
  on public.profiles (role)
  where role = 'admin';
