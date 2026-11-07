-- ART-AE M1: one-time role split for the new clean database.
-- Run AS OS/SQL postgres against database artae only.
-- Preconditions: current DB owner/table owner = artae_app;
--                runtime not yet deployed; 001 and 002 applied.
-- This is host provisioning, not a repeatable schema migration.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'artae' THEN
  RAISE EXCEPTION 'Refusing to change roles outside artae database';
 END IF;
 IF (SELECT count(*) FROM public.artae_schema_migrations) <> 2 OR
    NOT EXISTS (SELECT 1 FROM public.artae_schema_migrations WHERE version='001_clean_schema') OR
    NOT EXISTS (SELECT 1 FROM public.artae_schema_migrations WHERE version='002_office_lease') THEN
  RAISE EXCEPTION 'Unexpected migration state';
 END IF;
 IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'artae_app' THEN
  RAISE EXCEPTION 'Unexpected current owner';
 END IF;
 IF (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid='public.artae_users'::regclass) <> 'artae_app' THEN
  RAISE EXCEPTION 'Unexpected table owner';
 END IF;
 IF EXISTS (SELECT 1 FROM public.artae_users) THEN
  RAISE EXCEPTION 'Role split must precede app initialization';
 END IF;
END
$guard$;
ALTER ROLE artae_app RENAME TO artae_owner;
ALTER ROLE artae_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE artae_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE artae TO artae_app;
GRANT USAGE ON SCHEMA public TO artae_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
 public.artae_users,
 public.artae_sessions,
 public.artae_projects,
 public.artae_conversations,
 public.artae_messages,
 public.artae_pins,
 public.artae_office_locks
 TO artae_app;
GRANT SELECT ON public.artae_schema_migrations TO artae_app;
GRANT EXECUTE ON FUNCTION public.artae_office_lease(text,uuid,text,uuid,uuid,text) TO artae_app;
COMMIT;
-- Verify runtime can read but cannot change schema.
\echo ==== ART-AE APP ROLE CHECK ====
SET ROLE artae_app;
SELECT current_user, current_database(),
 has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema_objects,
 has_table_privilege(current_user, 'public.artae_users', 'SELECT') AS can_read_users,
 has_table_privilege(current_user, 'public.artae_users', 'UPDATE') AS can_update_users,
 has_table_privilege(current_user, 'public.artae_schema_migrations', 'UPDATE') AS can_modify_migrations;
SELECT count(*) AS user_count FROM public.artae_users;
RESET ROLE;
