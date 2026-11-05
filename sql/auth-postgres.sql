-- ART-AE migration stage 1: portable account and session tables.
create table if not exists public.artae_users (
  id uuid primary key,
  name text not null,
  role text not null check(role in ('admin','member')),
  key_hash text not null unique check(key_hash ~ '^[0-9a-f]{64}$'),
  generation integer not null default 1 check(generation > 0),
  disabled boolean not null default false
);
create table if not exists public.artae_sessions (
  sid text primary key check(sid ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.artae_users(id) on delete cascade,
  generation integer not null,
  last_seen bigint not null,
  created_at bigint not null
);
create index if not exists artae_sessions_user_idx on public.artae_sessions(user_id);
alter table public.artae_users enable row level security;
alter table public.artae_sessions enable row level security;
revoke all on public.artae_users from anon, authenticated;
revoke all on public.artae_sessions from anon, authenticated;
