-- Erase deleted message text from the live database, preserving tombstones.
-- Does not touch old backups/WAL or Yandex Disk physical attachments.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='004_web_push')
 THEN RAISE EXCEPTION 'Migration 004 required'; END IF;
END $guard$;
UPDATE public.artae_messages SET body='' WHERE deleted_at IS NOT NULL AND body<>'';
DO $constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.artae_messages'::regclass
 AND conname='artae_deleted_message_has_no_body') THEN
  ALTER TABLE public.artae_messages ADD CONSTRAINT artae_deleted_message_has_no_body
   CHECK (deleted_at IS NULL OR body='') NOT VALID;
 END IF;
END $constraint$;
ALTER TABLE public.artae_messages VALIDATE CONSTRAINT artae_deleted_message_has_no_body;
INSERT INTO public.artae_schema_migrations(version)
 VALUES('005_erase_deleted_text') ON CONFLICT(version) DO NOTHING;
COMMIT;
