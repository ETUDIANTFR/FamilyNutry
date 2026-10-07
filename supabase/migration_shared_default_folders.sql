begin;

alter table public.storage_folders
  alter column zone_id drop not null;

create temporary table shared_folder_duplicates on commit drop as
select folder.id, canonical.canonical_id
from public.storage_folders as folder
join (
  select distinct on (kind, name)
    kind,
    name,
    id as canonical_id
  from public.storage_folders
  where (kind = 'inventory' and name in ('Frigo', 'Congélateur', 'Étagère'))
     or (kind = 'shopping' and name = 'Consommer')
  order by kind, name, (zone_id is null) desc, created_at, id
) as canonical
  on canonical.kind = folder.kind
  and canonical.name = folder.name
where ((folder.kind = 'inventory' and folder.name in ('Frigo', 'Congélateur', 'Étagère'))
    or (folder.kind = 'shopping' and folder.name = 'Consommer'))
  and folder.id <> canonical.canonical_id;

update public.products as product
set folder_id = duplicates.canonical_id
from shared_folder_duplicates as duplicates
where product.folder_id = duplicates.id;

update public.shopping_list_items as item
set folder_id = duplicates.canonical_id
from shared_folder_duplicates as duplicates
where item.folder_id = duplicates.id;

delete from public.storage_folders as folder
using shared_folder_duplicates as duplicates
where folder.id = duplicates.id;

update public.storage_folders
set zone_id = null
where (kind = 'inventory' and name in ('Frigo', 'Congélateur', 'Étagère'))
   or (kind = 'shopping' and name = 'Consommer');

insert into public.storage_folders (name, kind, icon, color, zone_id)
values
  ('Frigo', 'inventory', '🧊', '#dfeeff', null),
  ('Congélateur', 'inventory', '❄', '#eaf5ff', null),
  ('Étagère', 'inventory', '▤', '#f2e4d4', null),
  ('Consommer', 'shopping', '✓', '#e9e2f5', null)
on conflict do nothing;

create unique index if not exists storage_folders_shared_kind_name_idx
  on public.storage_folders (kind, name)
  where zone_id is null;

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
