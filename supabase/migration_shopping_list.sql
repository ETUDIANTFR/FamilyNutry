alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'approved', 'revoked'));

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

create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  is_checked boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.shopping_list_items enable row level security;

drop policy if exists "Approved members can read shared shopping items" on public.shopping_list_items;
create policy "Approved members can read shared shopping items"
  on public.shopping_list_items for select to authenticated
  using ((select public.is_approved_member()));

drop policy if exists "Approved members can add shared shopping items" on public.shopping_list_items;
create policy "Approved members can add shared shopping items"
  on public.shopping_list_items for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared shopping items" on public.shopping_list_items;
create policy "Approved members can update shared shopping items"
  on public.shopping_list_items for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()));

drop policy if exists "Approved members can remove shared shopping items" on public.shopping_list_items;
create policy "Approved members can remove shared shopping items"
  on public.shopping_list_items for delete to authenticated
  using ((select public.is_approved_member()));

grant select, insert, update, delete on public.shopping_list_items to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.shopping_list_items;
exception when duplicate_object then
  null;
end;
$$;

notify pgrst, 'reload schema';
