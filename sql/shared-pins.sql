-- Run ONCE in the existing Supabase project's SQL Editor before enabling shared pins.
-- This creates only a new table and does not modify existing users, sessions, projects, conversations or messages.
create table if not exists public.artae_pins (
 id uuid primary key,
 project_id uuid not null references public.artae_projects(id),
 scope text not null check (scope in ('project','convo')),
 scope_id uuid not null,
 item_kind text not null check (item_kind in ('message','file')),
 item_key text not null check (length(item_key) between 1 and 500),
 note text not null default '',
 created_at bigint not null,
 unique(project_id,scope,scope_id,item_kind,item_key),
 check (length(note)<=300)
);
create index if not exists artae_pins_project_index on public.artae_pins(project_id,created_at desc);
alter table public.artae_pins enable row level security;
revoke all on public.artae_pins from anon, authenticated;
-- Access only through Netlify Functions using the server-side Supabase secret key.
