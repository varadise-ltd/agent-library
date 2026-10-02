import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { seed } from './seed-library.js';
import { lexicalRetrievalScore, localRetrievalVector, RETRIEVAL_VECTOR_DIMENSIONS } from './retrieval-index.js';

const { Pool } = pg;
const replaceErrors = new Set(['EACCES', 'EEXIST', 'EPERM']);
const removeIfPresent = file => { try { fs.unlinkSync(file); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; } };
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value);

function normalizeData(value) {
  const defaults = seed();
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const [key, fallback] of Object.entries(defaults)) {
    if (Array.isArray(fallback) && !Array.isArray(data[key])) data[key] = [];
    else if (!Array.isArray(fallback) && (data[key] === null || typeof data[key] !== 'object' || Array.isArray(data[key]))) data[key] = clone(fallback);
  }
  return data;
}

function persistJson(file, data) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temp = `${file}.${token}.tmp`;
  const backup = `${file}.${token}.bak`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.renameSync(temp, file);
    return;
  } catch (cause) {
    if (!replaceErrors.has(cause.code)) { removeIfPresent(temp); throw cause; }
  }
  let backedUp = false;
  try {
    if (fs.existsSync(file)) { fs.copyFileSync(file, backup); backedUp = true; }
    fs.copyFileSync(temp, file);
    removeIfPresent(temp);
    if (backedUp) removeIfPresent(backup);
  } catch (cause) {
    try { if (backedUp && fs.existsSync(backup)) fs.copyFileSync(backup, file); } catch { /* preserve the original fallback error */ }
    removeIfPresent(temp);
    removeIfPresent(backup);
    throw cause;
  }
}

export class Store {
  constructor(dataDir) {
    this.backend = 'json';
    this.file = path.join(dataDir, 'store.json');
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.data = normalizeData(fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : seed());
    this.save();
  }
  save() { persistJson(this.file, this.data); }
  async flush() {}
  async close() {}
  health() { return { backend: 'json', status: 'ready', file: this.file }; }
  async databaseInspection({ collection = '', limit = 25 } = {}) {
    const collections = Object.entries(this.data).filter(([, value]) => Array.isArray(value)).map(([name, rows]) => ({ name, rows: rows.length }));
    const selected = collections.some(item => item.name === collection) ? collection : collections[0]?.name || '';
    return { backend: 'json', schema: null, revision: null, vectorEnabled: false, tables: [{ name: 'store.json', rows: collections.reduce((sum, item) => sum + item.rows, 0), bytes: fs.existsSync(this.file) ? fs.statSync(this.file).size : 0 }], collections, records: this.list(selected).slice(0, limit).map((data, position) => ({ collection: selected, recordId: String(data.id || position), position, data, updatedAt: data.updatedAt || null })), chunks: [], selectedCollection: selected };
  }
  list(collection) { return this.data[collection] || []; }
  find(collection, id) { return this.list(collection).find(item => item.id === id); }
  create(collection, value) { this.data[collection].push(value); this.save(); return value; }
  audit(action, subject, context = '', actor = 'Administrator') { this.data.audit.unshift({ id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`, at: new Date().toISOString(), actor, action, subject, context }); this.save(); }
  async documentIndexRevision(documentId) { return this.list('documentChunks').find(item => item.documentId === documentId)?.revision || null; }
  async replaceDocumentChunks(document, revision, chunks) { this.data.documentChunks ||= []; this.data.documentChunks = this.data.documentChunks.filter(item => item.documentId !== document.id); this.data.documentChunks.push(...chunks.map((content, position) => ({ id: `${document.id}:${position}`, documentId: document.id, projectId: document.projectId, deploymentId: document.deploymentId || null, visibility: document.visibility, revision, position, content }))); this.save(); }
  async deleteDocumentChunks(documentId) { this.data.documentChunks ||= []; this.data.documentChunks = this.data.documentChunks.filter(item => item.documentId !== documentId); this.save(); }
  async persistManifest(manifest) { this.data.agentManifests ||= []; const item = { id: `${manifest.deploymentId}:${manifest.revision}`, deploymentId: manifest.deploymentId, revision: manifest.revision, hash: manifest.manifestHash, manifest, publishedAt: manifest.publishedAt || new Date().toISOString() }; this.data.agentManifests = [item, ...this.data.agentManifests.filter(row => row.id !== item.id)].slice(0, 1000); this.save(); return item; }
  async searchDocumentChunks({ projectId, deploymentId, documentIds = [], query, limit = 10 }) { const requested = new Set(documentIds); return this.list('documentChunks').filter(item => item.projectId === projectId && (item.visibility === 'shared' || item.deploymentId === deploymentId)).map(item => ({ ...item, score: lexicalRetrievalScore(query, item.content) + (requested.has(item.documentId) ? 4 : 0) })).sort((left, right) => right.score - left.score).slice(0, limit); }
}

export class PostgresStore {
  static async open(options) {
    const store = new PostgresStore(options);
    try {
      await store.initialize();
      return store;
    } catch (cause) {
      await store.releaseProcessLock();
      await store.pool.end().catch(() => {});
      throw cause;
    }
  }

  constructor({ dataDir, connectionString, ssl = false, poolMax = 10, connectionTimeoutMillis = 10_000, schema = 'varadise', pool = null, advisoryLocks = true, createIndexes = true, vectorEnabled = !pool }) {
    if (!connectionString && !pool) throw new Error('DATABASE_URL is required when DATA_BACKEND=postgres.');
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('DATABASE_SCHEMA must contain letters, numbers and underscores only.');
    this.backend = 'postgres';
    this.file = path.join(dataDir, 'store.json');
    this.schema = schema;
    this.qualified = name => `"${schema}"."${name}"`;
    this.pool = pool || new Pool({ connectionString, ssl, max: poolMax, connectionTimeoutMillis, idleTimeoutMillis: 30_000, application_name: 'varadise-agent-platform' });
    this.advisoryLocks = advisoryLocks;
    this.createIndexes = createIndexes;
    this.vectorEnabled = vectorEnabled;
    this.pool.on('error', cause => { this.status = 'degraded'; this.lastError = cause; console.error('PostgreSQL pool error:', cause.message); });
    this.data = normalizeData(seed());
    this.persistedData = clone(this.data);
    this.revision = 0;
    this.pending = Promise.resolve();
    this.pendingWrites = 0;
    this.status = 'starting';
    this.lastError = null;
    this.importedLegacyJson = false;
    this.processLockClient = null;
    this.processLockKey = `varadise-agent-platform-process:${schema}`;
  }

  async initialize() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      if (this.vectorEnabled) await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('schema_migrations')} (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('platform_state')} (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), revision bigint NOT NULL DEFAULT 0, scalars jsonb NOT NULL DEFAULT '{}'::jsonb, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())`);
      await client.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('platform_records')} (collection text NOT NULL, record_id text NOT NULL, position integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collection, record_id))`);
      if (this.vectorEnabled) await client.query(`CREATE TABLE IF NOT EXISTS ${this.qualified('document_chunks')} (document_id text NOT NULL, revision text NOT NULL, project_id text NOT NULL, deployment_id text, visibility text NOT NULL, position integer NOT NULL, content text NOT NULL, search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED, embedding vector(${RETRIEVAL_VECTOR_DIMENSIONS}) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (document_id, position))`);
      if (this.createIndexes) {
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_order_idx ON ${this.qualified('platform_records')} (collection, position)`);
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_project_idx ON ${this.qualified('platform_records')} (collection, (data->>'projectId'))`);
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_deployment_idx ON ${this.qualified('platform_records')} (collection, (data->>'deploymentId'))`);
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_group_idx ON ${this.qualified('platform_records')} (collection, (data->>'groupId'))`);
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_created_idx ON ${this.qualified('platform_records')} (collection, (data->>'createdAt'))`);
        await client.query(`CREATE INDEX IF NOT EXISTS platform_records_data_gin_idx ON ${this.qualified('platform_records')} USING gin (data jsonb_path_ops)`);
        if (this.vectorEnabled) {
          await client.query(`CREATE INDEX IF NOT EXISTS document_chunks_scope_idx ON ${this.qualified('document_chunks')} (project_id, visibility, deployment_id)`);
          await client.query(`CREATE INDEX IF NOT EXISTS document_chunks_search_idx ON ${this.qualified('document_chunks')} USING gin (search_vector)`);
          await client.query(`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON ${this.qualified('document_chunks')} USING hnsw (embedding vector_cosine_ops)`);
        }
      }
      await client.query(`INSERT INTO ${this.qualified('schema_migrations')} (version) VALUES (1) ON CONFLICT (version) DO NOTHING`);
      // V2 keeps the legacy JSONB record store for compatibility while adding
      // typed relational identities for the operationally critical entities.
      // These tables are additive and intentionally do not delete or rewrite
      // existing platform_records rows.
      const relational = {
        organizations: 'id text PRIMARY KEY, name text NOT NULL, data jsonb NOT NULL DEFAULT \'{}\'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()',
        projects: 'id text PRIMARY KEY, organization_id text, name text NOT NULL, data jsonb NOT NULL DEFAULT \'{}\'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()',
        deployments: 'id text PRIMARY KEY, project_id text, organization_id text, state text NOT NULL DEFAULT \'provisioned\', active_manifest_revision integer, active_manifest_hash text, data jsonb NOT NULL DEFAULT \'{}\'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()',
        agent_manifests: 'deployment_id text NOT NULL, revision integer NOT NULL, manifest_hash text NOT NULL, manifest jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (deployment_id, revision)',
        messages: 'id text PRIMARY KEY, project_id text, deployment_id text, state text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()',
        agent_runs: 'id text PRIMARY KEY, request_id text, project_id text, deployment_id text, manifest_revision integer, manifest_hash text, status text NOT NULL, data jsonb NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz',
        artifacts: 'id text PRIMARY KEY, project_id text, deployment_id text, template_id text, template_revision integer, format text, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()',
        deliveries: 'id text PRIMARY KEY, message_id text, channel text NOT NULL, state text NOT NULL, outbound_message_id text, acknowledgement jsonb, data jsonb NOT NULL DEFAULT \'{}\'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()',
        audit_events: 'id text PRIMARY KEY, organization_id text, project_id text, deployment_id text, action text NOT NULL, actor text, data jsonb NOT NULL DEFAULT \'{}\'::jsonb, created_at timestamptz NOT NULL DEFAULT now()'
      };
      for (const [table, definition] of Object.entries(relational)) await client.query(`CREATE TABLE IF NOT EXISTS ${this.qualified(table)} (${definition})`);
      await client.query(`CREATE INDEX IF NOT EXISTS agent_manifests_hash_idx ON ${this.qualified('agent_manifests')} (manifest_hash)`);
      await client.query(`CREATE INDEX IF NOT EXISTS agent_runs_deployment_idx ON ${this.qualified('agent_runs')} (deployment_id, started_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS messages_scope_idx ON ${this.qualified('messages')} (project_id, deployment_id, created_at DESC)`);
      await client.query(`INSERT INTO ${this.qualified('schema_migrations')} (version) VALUES (2) ON CONFLICT (version) DO NOTHING`);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally { client.release(); }

    if (this.advisoryLocks) {
      const lockClient = await this.pool.connect();
      try {
        const lock = await lockClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [this.processLockKey]);
        if (!lock.rows[0]?.acquired) throw Object.assign(new Error(`Another Agent Platform process is already using PostgreSQL schema ${this.schema}. Stop the other process before starting this one.`), { code: 'VARADISE_STORE_ALREADY_OPEN' });
        this.processLockClient = lockClient;
      } catch (cause) {
        lockClient.release();
        throw cause;
      }
    }

    const state = await this.pool.query(`SELECT revision, scalars, metadata FROM ${this.qualified('platform_state')} WHERE singleton = true`);
    if (!state.rowCount) {
      const legacy = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : seed();
      this.data = normalizeData(legacy);
      await this.replaceSnapshot(this.data, { importedFrom: fs.existsSync(this.file) ? this.file : null });
      this.importedLegacyJson = fs.existsSync(this.file);
    } else {
      const records = await this.pool.query(`SELECT collection, data FROM ${this.qualified('platform_records')} ORDER BY collection, position`);
      const loaded = { ...(state.rows[0].scalars || {}) };
      for (const row of records.rows) { if (!Array.isArray(loaded[row.collection])) loaded[row.collection] = []; loaded[row.collection].push(row.data); }
      this.data = normalizeData(loaded);
      this.persistedData = clone(this.data);
      this.revision = Number(state.rows[0].revision);
      this.importedLegacyJson = Boolean(state.rows[0].metadata?.importedFrom);
    }
    this.status = 'ready';
    return this;
  }

  splitSnapshot(snapshot) {
    const collections = {};
    const scalars = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (Array.isArray(value)) collections[key] = value;
      else scalars[key] = value;
    }
    return { collections, scalars };
  }

  async insertRows(client, collection, rows) {
    const chunkSize = 250;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const parameters = [];
      const values = chunk.map((record, index) => {
        const base = index * 4;
        parameters.push(collection, String(record.id), offset + index, json(record));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, now())`;
      });
      await client.query(`INSERT INTO ${this.qualified('platform_records')} (collection, record_id, position, data, updated_at) VALUES ${values.join(', ')} ON CONFLICT (collection, record_id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data, updated_at = now()`, parameters);
    }
  }

  async replaceSnapshot(snapshot, metadata = {}) {
    const client = await this.pool.connect();
    try {
      const { collections, scalars } = this.splitSnapshot(snapshot);
      await client.query('BEGIN');
      if (this.advisoryLocks) await client.query(`SELECT pg_advisory_xact_lock(hashtext('varadise-agent-platform-store'))`);
      await client.query(`DELETE FROM ${this.qualified('platform_records')}`);
      for (const [collection, rows] of Object.entries(collections)) await this.insertRows(client, collection, rows);
      const nextRevision = 1;
      await client.query(`INSERT INTO ${this.qualified('platform_state')} (singleton, revision, scalars, metadata, updated_at) VALUES (true, $1, $2::jsonb, $3::jsonb, now()) ON CONFLICT (singleton) DO UPDATE SET revision = EXCLUDED.revision, scalars = EXCLUDED.scalars, metadata = EXCLUDED.metadata, updated_at = now()`, [nextRevision, json(scalars), json({ ...metadata, importedAt: new Date().toISOString() })]);
      await client.query('COMMIT');
      this.revision = nextRevision;
      this.persistedData = clone(snapshot);
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally { client.release(); }
  }

  async persistSnapshot(snapshot) {
    const client = await this.pool.connect();
    try {
      const { collections, scalars } = this.splitSnapshot(snapshot);
      const previous = this.splitSnapshot(this.persistedData);
      await client.query('BEGIN');
      if (this.advisoryLocks) await client.query(`SELECT pg_advisory_xact_lock(hashtext('varadise-agent-platform-store'))`);
      const locked = await client.query(`SELECT revision FROM ${this.qualified('platform_state')} WHERE singleton = true FOR UPDATE`);
      const databaseRevision = Number(locked.rows[0]?.revision || 0);
      if (databaseRevision !== this.revision) throw Object.assign(new Error(`PostgreSQL store revision changed from ${this.revision} to ${databaseRevision}; refusing to overwrite concurrent changes.`), { code: 'VARADISE_STORE_CONFLICT' });

      const collectionNames = new Set([...Object.keys(previous.collections), ...Object.keys(collections)]);
      for (const collection of collectionNames) {
        const before = new Map((previous.collections[collection] || []).map((record, position) => [String(record.id), { position, serialized: json(record) }]));
        const current = collections[collection] || [];
        const currentIds = new Set(current.map(record => String(record.id)));
        const removed = [...before.keys()].filter(id => !currentIds.has(id));
        if (removed.length) await client.query(`DELETE FROM ${this.qualified('platform_records')} WHERE collection = $1 AND record_id = ANY($2::text[])`, [collection, removed]);
        const changed = current.filter((record, position) => { const old = before.get(String(record.id)); return !old || old.position !== position || old.serialized !== json(record); });
        if (changed.length) {
          const positions = new Map(current.map((record, position) => [String(record.id), position]));
          const chunkSize = 250;
          for (let offset = 0; offset < changed.length; offset += chunkSize) {
            const chunk = changed.slice(offset, offset + chunkSize), parameters = [];
            const values = chunk.map((record, index) => { const base = index * 4; parameters.push(collection, String(record.id), positions.get(String(record.id)), json(record)); return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, now())`; });
            await client.query(`INSERT INTO ${this.qualified('platform_records')} (collection, record_id, position, data, updated_at) VALUES ${values.join(', ')} ON CONFLICT (collection, record_id) DO UPDATE SET position = EXCLUDED.position, data = EXCLUDED.data, updated_at = now()`, parameters);
          }
        }
      }
      const nextRevision = this.revision + 1;
      await client.query(`UPDATE ${this.qualified('platform_state')} SET revision = $1, scalars = $2::jsonb, updated_at = now() WHERE singleton = true`, [nextRevision, json(scalars)]);
      await client.query('COMMIT');
      this.revision = nextRevision;
      this.persistedData = clone(snapshot);
      this.status = 'ready';
      this.lastError = null;
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally { client.release(); }
  }

  save() {
    const snapshot = clone(this.data);
    this.pendingWrites += 1;
    const task = this.pending.then(() => this.persistSnapshot(snapshot));
    this.pending = task.catch(cause => { this.status = 'degraded'; this.lastError = cause; console.error('PostgreSQL persistence failed:', cause.message); }).finally(() => { this.pendingWrites -= 1; });
    return task;
  }

  async flush() {
    await this.pending;
    if (this.lastError) throw this.lastError;
  }
  async releaseProcessLock() {
    if (!this.processLockClient) return;
    const client = this.processLockClient;
    this.processLockClient = null;
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [this.processLockKey]); }
    finally { client.release(); }
  }
  async close() {
    try { await this.flush(); }
    finally {
      await this.releaseProcessLock();
      await this.pool.end();
    }
  }
  health() { return { backend: 'postgres', status: this.status, schema: this.schema, revision: this.revision, pendingWrites: this.pendingWrites, importedLegacyJson: this.importedLegacyJson, error: this.lastError?.message || null }; }
  async databaseInspection({ collection = '', limit = 25 } = {}) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
    const [collectionResult, tableResult, extensionResult] = await Promise.all([
      this.pool.query(`SELECT collection AS name, count(*)::integer AS rows FROM ${this.qualified('platform_records')} GROUP BY collection ORDER BY collection`),
      this.pool.query(`SELECT c.relname AS name, c.reltuples::bigint AS estimated_rows, pg_total_relation_size(c.oid)::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`, [this.schema]),
      this.pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
    ]);
    const collections = collectionResult.rows.map(row => ({ name: row.name, rows: Number(row.rows) }));
    const selected = collections.some(item => item.name === collection) ? collection : collections[0]?.name || '';
    const records = selected ? await this.pool.query(`SELECT collection, record_id AS "recordId", position, data, updated_at AS "updatedAt" FROM ${this.qualified('platform_records')} WHERE collection = $1 ORDER BY position LIMIT $2`, [selected, safeLimit]) : { rows: [] };
    let chunks = { rows: [] };
    if (this.vectorEnabled) chunks = await this.pool.query(`SELECT document_id AS "documentId", project_id AS "projectId", deployment_id AS "deploymentId", visibility, count(*)::integer AS "chunkCount", sum(length(content))::integer AS characters, max(updated_at) AS "updatedAt", left(min(content), 240) AS preview FROM ${this.qualified('document_chunks')} GROUP BY document_id, project_id, deployment_id, visibility ORDER BY max(updated_at) DESC LIMIT 50`);
    return { backend: 'postgres', schema: this.schema, revision: this.revision, vectorEnabled: this.vectorEnabled, vectorVersion: extensionResult.rows[0]?.extversion || null, tables: tableResult.rows.map(row => ({ name: row.name, rows: Number(row.estimated_rows), bytes: Number(row.bytes) })), collections, records: records.rows, chunks: chunks.rows.map(row => ({ ...row, chunkCount: Number(row.chunkCount), characters: Number(row.characters) })), selectedCollection: selected };
  }
  list(collection) { return this.data[collection] || []; }
  find(collection, id) { return this.list(collection).find(item => item.id === id); }
  create(collection, value) { this.data[collection].push(value); this.save(); return value; }
  audit(action, subject, context = '', actor = 'Administrator') { this.data.audit.unshift({ id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`, at: new Date().toISOString(), actor, action, subject, context }); this.save(); }
  async documentIndexRevision(documentId) { const result = await this.pool.query(`SELECT revision FROM ${this.qualified('document_chunks')} WHERE document_id = $1 LIMIT 1`, [documentId]); return result.rows[0]?.revision || null; }
  async replaceDocumentChunks(document, revision, chunks) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${this.qualified('document_chunks')} WHERE document_id = $1`, [document.id]);
      for (let position = 0; position < chunks.length; position += 1) {
        const content = chunks[position], embedding = `[${localRetrievalVector(content).join(',')}]`;
        await client.query(`INSERT INTO ${this.qualified('document_chunks')} (document_id, revision, project_id, deployment_id, visibility, position, content, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)`, [document.id, revision, document.projectId, document.deploymentId || null, document.visibility, position, content, embedding]);
      }
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK'); throw cause; }
    finally { client.release(); }
  }
  async deleteDocumentChunks(documentId) { await this.pool.query(`DELETE FROM ${this.qualified('document_chunks')} WHERE document_id = $1`, [documentId]); }
  async persistManifest(manifest) {
    const item = { id: `${manifest.deploymentId}:${manifest.revision}`, deploymentId: manifest.deploymentId, revision: manifest.revision, hash: manifest.manifestHash, manifest, publishedAt: manifest.publishedAt || new Date().toISOString() };
    this.data.agentManifests ||= [];
    this.data.agentManifests = [item, ...this.data.agentManifests.filter(row => row.id !== item.id)].slice(0, 1000);
    await this.pool.query(`INSERT INTO ${this.qualified('agent_manifests')} (deployment_id, revision, manifest_hash, manifest, published_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (deployment_id, revision) DO NOTHING`, [manifest.deploymentId, manifest.revision, manifest.manifestHash, json(manifest), item.publishedAt]);
    await this.save();
    return item;
  }
  async searchDocumentChunks({ projectId, deploymentId, documentIds = [], query, limit = 10 }) {
    const embedding = `[${localRetrievalVector(query).join(',')}]`;
    const result = await this.pool.query(`SELECT document_id AS "documentId", revision, project_id AS "projectId", deployment_id AS "deploymentId", visibility, position, content, (0.62 * (1 - (embedding <=> $5::vector)) + 0.30 * ts_rank_cd(search_vector, plainto_tsquery('simple', $4)) + CASE WHEN document_id = ANY($3::text[]) THEN 0.8 ELSE 0 END) AS score FROM ${this.qualified('document_chunks')} WHERE project_id = $1 AND (visibility = 'shared' OR deployment_id = $2) ORDER BY score DESC, position ASC LIMIT $6`, [projectId, deploymentId || '', documentIds, String(query || ''), embedding, limit]);
    return result.rows.map(row => ({ ...row, score: Number(row.score || 0) }));
  }
}

export async function openStore(options) {
  const backend = String(options.backend || 'json').toLowerCase();
  if (backend === 'postgres') return PostgresStore.open(options);
  if (backend !== 'json') throw new Error(`Unsupported DATA_BACKEND: ${backend}. Use postgres or json.`);
  return new Store(options.dataDir);
}
