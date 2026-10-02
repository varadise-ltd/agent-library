import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { hashPassword, verifyPassword, encrypt, decrypt, normalizeEmail, isValidEmail, passwordIssue } from '../src/security.js';
import { PostgresStore, Store } from '../src/store.js';
import { seed } from '../src/seed-library.js';

test('password hashing and authenticated encryption never retain plaintext', () => {
  const hash = hashPassword('a-long-local-password');
  assert.equal(verifyPassword('a-long-local-password', hash), true);
  assert.equal(verifyPassword('other-password', hash), false);
  const encrypted = encrypt({ token: 'private-value' }, 'test application secret');
  assert.equal(JSON.stringify(encrypted).includes('private-value'), false);
  assert.deepEqual(decrypt(encrypted, 'test application secret'), { token: 'private-value' });
});

test('account validation normalizes email and enforces strong passwords', () => {
  assert.equal(normalizeEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('user@localhost'), false);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(passwordIssue('short'), 'Use at least 8 characters.');
  assert.equal(passwordIssue('alllowercase123'), 'Include an uppercase letter, a lowercase letter and a number.');
  assert.equal(passwordIssue('Strong123'), '');
});

test('JSON store survives an atomic local save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varadise-store-'));
  const store = new Store(dir);
  store.create('organizations', { id: 'org-test', name: 'Test builder', region: 'Hong Kong' });
  const reloaded = new Store(dir);
  assert.equal(reloaded.find('organizations', 'org-test').name, 'Test builder');
  assert.deepEqual(reloaded.list('users'), []);
});

test('JSON store falls back safely when replacing the target is blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varadise-store-replace-'));
  const store = new Store(dir);
  const renameSync = fs.renameSync;
  let blocked = false;
  fs.renameSync = (source, target) => {
    if (target === store.file) {
      blocked = true;
      const error = new Error('simulated Windows replace denial');
      error.code = 'EPERM';
      throw error;
    }
    return renameSync(source, target);
  };
  try {
    store.create('organizations', { id: 'org-fallback', name: 'Fallback builder', region: 'Hong Kong' });
  } finally {
    fs.renameSync = renameSync;
  }
  assert.equal(blocked, true);
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).organizations.at(-1).id, 'org-fallback');
  assert.deepEqual(fs.readdirSync(dir).filter(name => /\.(tmp|bak)$/.test(name)), []);
});

test('PostgreSQL store imports legacy JSON and persists indexed records transactionally', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varadise-postgres-store-'));
  const legacy = new Store(dir);
  legacy.create('organizations', { id: 'org-legacy', name: 'Legacy builder', region: 'Hong Kong' });
  const memory = newDb({ noAstCoverageCheck: true });
  const adapter = memory.adapters.createPg();
  const postgres = await PostgresStore.open({ dataDir: dir, pool: new adapter.Pool(), advisoryLocks: false, createIndexes: false });
  assert.equal(postgres.backend, 'postgres');
  assert.equal(postgres.find('organizations', 'org-legacy').name, 'Legacy builder');
  postgres.create('organizations', { id: 'org-postgres', name: 'Database builder', region: 'Singapore' });
  await postgres.flush();
  assert.equal(postgres.health().status, 'ready');
  assert.ok(postgres.health().revision >= 2);
  await postgres.close();

  const reloaded = await PostgresStore.open({ dataDir: dir, pool: new adapter.Pool(), advisoryLocks: false, createIndexes: false });
  assert.equal(reloaded.find('organizations', 'org-postgres').name, 'Database builder');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'store.json'), 'utf8')).organizations.some(item => item.id === 'org-postgres'), false);
  const count = await reloaded.pool.query('SELECT count(*)::integer AS count FROM varadise.platform_records WHERE collection = $1', ['organizations']);
  assert.equal(Number(count.rows[0].count), 2);
  await reloaded.close();
});

test('seed library contains all required construction starters', () => {
  assert.deepEqual(seed().experts.map(expert => expert.name), ['Sally', 'Promax', 'Dora', 'Rafi', 'Quinn', 'Costy']);
  assert.ok(seed().components.find(component => component.type === 'heartbeat'));
});
