-- ART-AE 009: record the editor of shared messages without changing authorship.
-- Additive, idempotent; no message body history is retained.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='008_shared_avatars') THEN
  RAISE EXCEPTION 'Migration 008 required'; END IF;
END $guard$;
ALTER TABLE public.artae_messages
 ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.artae_users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS edited_by_name text;
GRANT SELECT, UPDATE(edited_by,edited_by_name) ON public.artae_messages TO artae_app;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('009_shared_message_edits') ON CONFLICT(version) DO NOTHING;
COMMIT;
