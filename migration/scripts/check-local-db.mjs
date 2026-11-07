// ART-AE migration M2: read-only smoke test of the permanent local database.
// Uses local Unix socket + peer authentication; no Supabase, passwords or writes.
import pg from 'pg';

const client = new pg.Client({
  host: '/var/run/postgresql',
  port: 5432,
  user: 'artae_app',
  database: 'artae',
  connectionTimeoutMillis: 5000,
  query_timeout: 5000
});

try {
  await client.connect();
  const {rows: [r]} = await client.query(`
    SELECT
      current_user AS db_user,
      current_database() AS db_name,
      (SELECT count(*)::int FROM public.artae_schema_migrations) AS migrations,
      (SELECT count(*)::int FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'artae_%') AS tables,
      (SELECT count(*)::int FROM public.artae_users) AS users,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables,
      has_table_privilege(current_user, 'public.artae_users', 'SELECT') AS can_read_users
  `);
  if (r.db_user !== 'artae_app' || r.db_name !== 'artae' ||
      r.migrations !== 2 || r.tables !== 8 ||
      r.users !== 0 || r.can_create_tables !== false ||
      r.can_read_users !== true) {
    throw new Error('Unexpected local database state: ' + JSON.stringify(r));
  }
  console.log('LOCAL_POSTGRES_OK', JSON.stringify(r));
} catch (error) {
  console.error('LOCAL_POSTGRES_ERROR', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
