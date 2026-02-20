-- Add optional branch label/condition text to graph connections.
alter table if exists public.connections
  add column if not exists label text not null default '';
