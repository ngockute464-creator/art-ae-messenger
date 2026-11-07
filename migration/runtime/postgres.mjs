// ART-AE local PostgreSQL connection. No Supabase and no database credentials in source.
// Run under the artae_app Unix account. PostgreSQL uses local socket peer authentication.
import pg from 'pg';

const pool = new pg.Pool({
  host: '/var/run/postgresql',
  port: 5432,
  user: 'artae_app',
  database: 'artae',
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  query_timeout: 10000,
  application_name: 'artae-next'
});

export async function query(sql, params = []) {
  return pool.query(sql, params);
}

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn((sql, params = []) => client.query(sql, params));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function assertLocalDatabase() {
  const {rows: [r]} = await query('SELECT current_user AS user_name, current_database() AS db_name');
  if (r.user_name !== 'artae_app' || r.db_name !== 'artae') {
    throw Error('Refusing unexpected PostgreSQL connection');
  }
  return r;
}

export async function closePool() {
  await pool.end();
}
