-- กินอะไร"ดี" — schema for Supabase (run once in the SQL editor).
-- Read-only for everyone (anon key); writes only from the dashboard or the service-role seed script.

create table if not exists ingredients (
  name text primary key,
  status text not null,
  reason text not null default '',
  substitute text not null default '',
  source text not null default ''
);

create table if not exists protein_map (
  option text primary key,
  maps_to text not null default '',
  status text not null default '',
  reason text not null default ''
);

create table if not exists brands (
  id bigint generated always as identity primary key,
  category text not null,
  brand text not null,
  variant text not null default '',
  note text not null default '',
  confirmed boolean not null default false
);

create table if not exists menus (
  name text primary key,
  region text not null default '',
  options jsonb not null default '[]',
  slot int not null default -1,
  rows jsonb not null default '[]',
  image jsonb
);

alter table ingredients enable row level security;
alter table protein_map enable row level security;
alter table brands enable row level security;
alter table menus enable row level security;

drop policy if exists "public read" on ingredients;
drop policy if exists "public read" on protein_map;
drop policy if exists "public read" on brands;
drop policy if exists "public read" on menus;
create policy "public read" on ingredients for select using (true);
create policy "public read" on protein_map for select using (true);
create policy "public read" on brands for select using (true);
create policy "public read" on menus for select using (true);
