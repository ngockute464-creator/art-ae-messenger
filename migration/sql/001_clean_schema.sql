-- ART-AE M1. EMPTY ISOLATED TEST DATABASE ONLY.
-- Never apply to the existing production database or Supabase.
-- Source: M0 schema audit 2026-11-07.
-- Differences from source: SID/generation CHECK, one-admin index, migration ledger.
BEGIN;
CREATE TABLE public.artae_users (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','member')),
 key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
 generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
 disabled boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX artae_users_single_admin_idx
 ON public.artae_users (role) WHERE role = 'admin';
CREATE TABLE public.artae_sessions (
 sid text PRIMARY KEY CHECK (sid ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES public.artae_users(id) ON DELETE CASCADE,
 generation integer NOT NULL,
 last_seen bigint NOT NULL,
 created_at bigint NOT NULL
);
CREATE INDEX artae_sessions_user_idx ON public.artae_sessions(user_id);
CREATE TABLE public.artae_projects (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 folder_path text,
 avatar text,
 created_by uuid,
 created_at bigint NOT NULL,
 updated_at bigint,
 deleted_at bigint
);
CREATE TABLE public.artae_conversations (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES public.artae_projects(id),
 name text NOT NULL,
 avatar text,
 created_at bigint NOT NULL,
 updated_at bigint,
 deleted_at bigint
);
CREATE INDEX artae_conversations_project_idx
 ON public.artae_conversations(project_id);
CREATE TABLE public.artae_messages (
 id uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES public.artae_conversations(id),
 author_id uuid NOT NULL,
 author_name text NOT NULL,
 body text NOT NULL,
 created_at bigint NOT NULL,
 edited_at bigint,
 deleted_at bigint
);
CREATE INDEX artae_messages_conversation_idx
 ON public.artae_messages(conversation_id,created_at,id);
CREATE TABLE public.artae_pins (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES public.artae_projects(id),
 scope text NOT NULL CHECK (scope IN ('project','convo')),
 scope_id uuid NOT NULL,
 item_kind text NOT NULL CHECK (item_kind IN ('message','file')),
 item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 500),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
 created_at bigint NOT NULL,
 UNIQUE(project_id,scope,scope_id,item_kind,item_key)
);
CREATE INDEX artae_pins_project_index
 ON public.artae_pins(project_id,created_at DESC);
CREATE TABLE public.artae_office_locks (
 project_id uuid NOT NULL REFERENCES public.artae_projects(id) ON DELETE CASCADE,
 file_path text NOT NULL CHECK (char_length(file_path) BETWEEN 1 AND 500),
 token uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 owner_name text NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY (project_id,file_path)
);
CREATE INDEX artae_office_locks_expires
 ON public.artae_office_locks(expires_at);
CREATE TABLE public.artae_schema_migrations (
 version text PRIMARY KEY,
 applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.artae_schema_migrations(version) VALUES('001_clean_schema');
COMMIT;
