-- ART-AE baseline core schema, reconstructed from read-only PostgreSQL catalogs.
-- FRESH EMPTY DATABASE ONLY. Never auto-apply on the existing art-ae instance.
-- Apply before auth-postgres.sql, shared-pins.sql and realtime.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS public.artae_projects (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 folder_path text,
 avatar text,
 created_by uuid,
 created_at bigint NOT NULL,
 updated_at bigint,
 deleted_at bigint
);
CREATE TABLE IF NOT EXISTS public.artae_conversations (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES public.artae_projects(id),
 name text NOT NULL,
 avatar text,
 created_at bigint NOT NULL,
 updated_at bigint,
 deleted_at bigint
);
CREATE TABLE IF NOT EXISTS public.artae_messages (
 id uuid PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES public.artae_conversations(id),
 author_id uuid NOT NULL,
 author_name text NOT NULL,
 body text NOT NULL,
 created_at bigint NOT NULL,
 edited_at bigint,
 deleted_at bigint
);
CREATE INDEX IF NOT EXISTS artae_conversations_project_idx ON public.artae_conversations(project_id);
CREATE INDEX IF NOT EXISTS artae_messages_conversation_idx ON public.artae_messages(conversation_id,created_at,id);
ALTER TABLE public.artae_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artae_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artae_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.artae_projects,public.artae_conversations,public.artae_messages FROM anon,authenticated;
COMMIT;
