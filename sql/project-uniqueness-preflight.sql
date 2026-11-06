-- READ ONLY. All three counts must be zero before any uniqueness migration.
SELECT
 (SELECT count(*) FROM (SELECT lower(name) FROM public.artae_projects GROUP BY lower(name) HAVING count(*)>1) d) AS duplicate_names,
 (SELECT count(*) FROM (SELECT lower(folder_path) FROM public.artae_projects WHERE folder_path IS NOT NULL GROUP BY lower(folder_path) HAVING count(*)>1) d) AS duplicate_paths,
 (SELECT count(*) FROM public.artae_projects WHERE folder_path IS NULL) AS missing_paths;
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN ('artae_projects','artae_conversations','artae_messages')
ORDER BY tablename,indexname;
