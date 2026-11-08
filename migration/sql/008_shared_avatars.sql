-- ART-AE 008: shared user avatars, independent of message history.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'artae' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='007_shared_labels') THEN
  RAISE EXCEPTION 'Migration 007 required'; END IF;
END $guard$;
ALTER TABLE public.artae_users ADD COLUMN IF NOT EXISTS avatar text;
DO $constraint$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='artae_users_avatar_safe_chk'
  AND conrelid='public.artae_users'::regclass) THEN
  ALTER TABLE public.artae_users ADD CONSTRAINT artae_users_avatar_safe_chk
  CHECK(avatar IS NULL OR (length(avatar)<=80000 AND avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$'));
 END IF;
END $constraint$;
GRANT SELECT,UPDATE(avatar) ON public.artae_users TO artae_app;
INSERT INTO public.artae_schema_migrations(version) VALUES('008_shared_avatars') ON CONFLICT(version) DO NOTHING;
COMMIT;
