alter table public.zones
  add column if not exists color text not null default '#376D48';

alter table public.zones
  drop constraint if exists zones_color_check;

alter table public.zones
  add constraint zones_color_check
  check (color ~ '^#[0-9A-Fa-f]{6}$');