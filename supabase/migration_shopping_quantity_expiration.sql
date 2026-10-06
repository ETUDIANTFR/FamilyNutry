alter table public.shopping_list_items
  add column if not exists quantity numeric(10, 3) not null default 1 check (quantity > 0),
  add column if not exists expiration_date date;

notify pgrst, 'reload schema';
