-- PROPOSAL ONLY; NEVER AUTO-APPLY.
-- Requires successful preflight, backup, and approval.
-- CONCURRENTLY must run outside transaction; reserves soft-deleted names/paths.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS artae_projects_name_ci_uniq
 ON public.artae_projects (lower(name));
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS artae_projects_folder_ci_uniq
 ON public.artae_projects (lower(folder_path)) WHERE folder_path IS NOT NULL;
