-- ART-AE 006: durable outbox for permanent removal of private chat uploads.
-- Existing message bodies and Yandex Disk files are NOT changed by migration.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='004_web_push')
 THEN RAISE EXCEPTION 'Migration 004 required'; END IF;
END $guard$;
CREATE TABLE IF NOT EXISTS public.artae_chat_file_deletions (
 message_id uuid NOT NULL REFERENCES public.artae_messages(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES public.artae_projects(id),
 file_id uuid NOT NULL,
 file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 120),
 created_at bigint NOT NULL,
 next_try_at bigint NOT NULL,
 lease_until bigint NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0,
 finished_at bigint,
 last_error text,
 PRIMARY KEY(message_id,file_id)
);
CREATE INDEX IF NOT EXISTS artae_chat_file_deletions_due_idx
 ON public.artae_chat_file_deletions(next_try_at)
 WHERE finished_at IS NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.artae_chat_file_deletions TO artae_app;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('006_chat_file_deletions') ON CONFLICT(version) DO NOTHING;
COMMIT;
