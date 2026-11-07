-- Disposable PostgreSQL 17 fixture. No real files are deleted.
INSERT INTO public.artae_chat_file_deletions
(message_id,project_id,file_id,file_name,created_at,next_try_at)
VALUES('55555555-5555-4555-8555-555555555555',
'33333333-3333-4333-8333-333333333333',
'99999999-9999-4999-8999-999999999999',
'test.png',1000,1000)
ON CONFLICT DO NOTHING;
INSERT INTO public.artae_chat_file_deletions
(message_id,project_id,file_id,file_name,created_at,next_try_at)
VALUES('55555555-5555-4555-8555-555555555555',
'33333333-3333-4333-8333-333333333333',
'99999999-9999-4999-8999-999999999999',
'test.png',1000,1000)
ON CONFLICT DO NOTHING;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.artae_chat_file_deletions)<>1
 THEN RAISE EXCEPTION 'Cleanup outbox duplicate'; END IF;
 IF NOT has_table_privilege('artae_app','public.artae_chat_file_deletions','SELECT')
 OR NOT has_table_privilege('artae_app','public.artae_chat_file_deletions','INSERT')
 OR NOT has_table_privilege('artae_app','public.artae_chat_file_deletions','UPDATE')
 THEN RAISE EXCEPTION 'Runtime cleanup privileges missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.artae_schema_migrations WHERE version='006_chat_file_deletions')
 THEN RAISE EXCEPTION 'Migration 006 missing'; END IF;
END $test$;
