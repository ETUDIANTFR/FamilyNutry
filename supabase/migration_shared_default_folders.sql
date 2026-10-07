begin;

alter table public.storage_folders
  alter column zone_id drop not null;

do $$
declare
  shared_folder record;
  canonical_id uuid;
begin
  for shared_folder in
    select kind, name
    from public.storage_folders
    where (kind = 'inventory' and name in ('Frigo', 'Congélateur', 'Étagère'))
       or (kind = 'shopping' and name = 'Consommer')
    group by kind, name
  loop
    select id
    into canonical_id
    from public.storage_folders
    where kind = shared_folder.kind
      and name = shared_folder.name
    order by (zone_id is null) desc, created_at, id
    limit 1;

    update public.products
    set folder_id = canonical_id
    where folder_id in (
      select id
      from public.storage_folders
      where kind = shared_folder.kind
        and name = shared_folder.name
        and id <> canonical_id
    );

    update public.shopping_list_items
    set folder_id = canonical_id
    where folder_id in (
      select id
      from public.storage_folders
      where kind = shared_folder.kind
        and name = shared_folder.name
        and id <> canonical_id
    );

    delete from public.storage_folders
    where kind = shared_folder.kind
      and name = shared_folder.name
      and id <> canonical_id;

    update public.storage_folders
    set zone_id = null
    where id = canonical_id;
  end loop;
end;
$$;

create unique index if not exists storage_folders_shared_kind_name_idx
  on public.storage_folders (kind, name)
  where zone_id is null;

insert into public.storage_folders (name, kind, icon, color, zone_id)
values
  ('Frigo', 'inventory', '🧊', '#dfeeff', null),
  ('Congélateur', 'inventory', '❄', '#eaf5ff', null),
  ('Étagère', 'inventory', '▤', '#f2e4d4', null),
  ('Consommer', 'shopping', '✓', '#e9e2f5', null)
on conflict (kind, name) where zone_id is null do nothing;

alter table public.storage_folders
  drop constraint if exists storage_folders_shared_names_check;
alter table public.storage_folders
  add constraint storage_folders_shared_names_check
  check (
    zone_id is not null
    or (kind = 'inventory' and name in ('Frigo', 'Congélateur', 'Étagère'))
    or (kind = 'shopping' and name = 'Consommer')
  );

drop policy if exists "Approved members can read shared folders" on public.storage_folders;
create policy "Approved members can read shared folders"
  on public.storage_folders for select to authenticated
  using (
    (select public.is_approved_member())
    and (zone_id is null or (select public.has_zone_access(zone_id)))
  );

drop policy if exists "Approved members can create shared folders" on public.storage_folders;
create policy "Approved members can create shared folders"
  on public.storage_folders for insert to authenticated
  with check (
    (select public.is_approved_member())
    and created_by = (select auth.uid())
    and (
      (zone_id is null and (
        (kind = 'inventory' and name in ('Frigo', 'Congélateur', 'Étagère'))
        or (kind = 'shopping' and name = 'Consommer')
      ))
      or (zone_id is not null and (select public.has_zone_access(zone_id)))
    )
  );

drop policy if exists "Approved members can update shared folders" on public.storage_folders;
create policy "Approved members can update shared folders"
  on public.storage_folders for update to authenticated
  using (zone_id is not null and (select public.has_zone_access(zone_id)))
  with check (
    zone_id is not null
    and (select public.has_zone_access(zone_id))
  );

drop policy if exists "Approved members can remove shared folders" on public.storage_folders;
create policy "Approved members can remove shared folders"
  on public.storage_folders for delete to authenticated
  using (zone_id is not null and (select public.has_zone_access(zone_id)));

commit;

notify pgrst, 'reload schema';
