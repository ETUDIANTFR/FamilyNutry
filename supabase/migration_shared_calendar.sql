create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint calendar_events_valid_range check (ends_at > starts_at)
);

alter table public.calendar_events enable row level security;

drop policy if exists "Approved members can read shared calendar events" on public.calendar_events;
create policy "Approved members can read shared calendar events"
  on public.calendar_events for select to authenticated
  using ((select public.is_approved_member()));

drop policy if exists "Approved members can add shared calendar events" on public.calendar_events;
create policy "Approved members can add shared calendar events"
  on public.calendar_events for insert to authenticated
  with check ((select public.is_approved_member()) and created_by = (select auth.uid()));

drop policy if exists "Approved members can update shared calendar events" on public.calendar_events;
create policy "Approved members can update shared calendar events"
  on public.calendar_events for update to authenticated
  using ((select public.is_approved_member()))
  with check ((select public.is_approved_member()));

drop policy if exists "Approved members can remove shared calendar events" on public.calendar_events;
create policy "Approved members can remove shared calendar events"
  on public.calendar_events for delete to authenticated
  using ((select public.is_approved_member()));

grant select, insert, update, delete on public.calendar_events to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.calendar_events;
exception when duplicate_object then
  null;
end;
$$;
