import { config } from '../apps/control-plane/src/env.js';
import { PostgresStore } from '../apps/control-plane/src/store.js';

if (!config.databaseUrl) throw new Error('Set DATABASE_URL before running the PostgreSQL migration.');
const ssl = config.databaseSsl === 'disable' ? false : { rejectUnauthorized: config.databaseSsl === 'verify-full' };
const store = await PostgresStore.open({ dataDir: config.dataDir, connectionString: config.databaseUrl, schema: config.databaseSchema, ssl, poolMax: config.databasePoolMax, connectionTimeoutMillis: config.databaseConnectTimeoutMs });
try {
  await store.flush();
  const collections = Object.fromEntries(Object.entries(store.data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
  console.log(JSON.stringify({ ok: true, persistence: store.health(), collections }, null, 2));
} finally { await store.close(); }
