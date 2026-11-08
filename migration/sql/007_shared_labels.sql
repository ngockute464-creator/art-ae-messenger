-- ART-AE 007: shared labels for messages and project files.
-- Additive, idempotent, no modifications to messages, pins or existing files.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='006_chat_file_deletions')
 THEN RAISE EXCEPTION 'Migration 006 required'; END IF;
END $guard$;
CREATE TABLE IF NOT EXISTS public.artae_labels (
 project_id uuid NOT NULL REFERENCES public.artae_projects(id) ON DELETE CASCADE,
 item_kind text NOT NULL CHECK(item_kind IN ('message','file')),
 item_key text NOT NULL CHECK (length(item_key) BETWEEN 1 AND 500),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name=trim(name)),
 created_by uuid NOT NULL REFERENCES public.artae_users(id),
 created_at bigint NOT NULL,
 PRIMARY KEY(project_id,item_kind,item_key,name)
);
CREATE INDEX IF NOT EXISTS artae_labels_project_idx ON public.artae_labels(project_id);
GRANT SELECT,INSERT,DELETE ON public.artae_labels TO artae_app;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('007_shared_labels') ON CONFLICT(version) DO NOTHING;
COMMIT;
