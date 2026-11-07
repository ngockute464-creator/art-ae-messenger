-- ART-AE stage 1: per-user, per-message read receipts.
-- Apply to local artae database AS postgres, not as the limited runtime role.
\set ON_ERROR_STOP on
BEGIN;
DO $check$
BEGIN
 IF current_database() <> 'artae' THEN
  RAISE EXCEPTION 'Refusing migration outside local artae';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.artae_schema_migrations WHERE version='002_office_lease') THEN
  RAISE EXCEPTION 'Unexpected schema migration history';
 END IF;
END
$check$;
CREATE TABLE IF NOT EXISTS public.artae_read_baselines (
 user_id uuid PRIMARY KEY REFERENCES public.artae_users(id) ON DELETE CASCADE,
 before_created_at bigint NOT NULL CHECK (before_created_at >= 0)
);
CREATE TABLE IF NOT EXISTS public.artae_message_reads (
 user_id uuid NOT NULL REFERENCES public.artae_users(id) ON DELETE CASCADE,
 message_id uuid NOT NULL REFERENCES public.artae_messages(id) ON DELETE CASCADE,
 read_at bigint NOT NULL CHECK (read_at >= 0),
 PRIMARY KEY(user_id,message_id)
);
CREATE INDEX IF NOT EXISTS artae_message_reads_message_idx
 ON public.artae_message_reads(message_id);
GRANT SELECT,INSERT ON public.artae_read_baselines,public.artae_message_reads TO artae_app;
-- Existing messages start as read for users already present at cutover.
-- Never overwrite an established baseline on repeated migration.
INSERT INTO public.artae_read_baselines(user_id,before_created_at)
 SELECT u.id,COALESCE((SELECT MAX(created_at) FROM public.artae_messages),0)
 FROM public.artae_users u ON CONFLICT(user_id) DO NOTHING;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('003_message_reads') ON CONFLICT(version) DO NOTHING;
COMMIT;
