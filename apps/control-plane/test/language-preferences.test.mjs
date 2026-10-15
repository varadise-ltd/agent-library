import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Arabic login preference and administrator translation overrides persist through the API', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varadise-ar-data-'));
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varadise-ar-runtime-'));
  Object.assign(process.env, { DATA_BACKEND: 'json', DATA_DIR: dataDir, RUNTIME_DIR: runtimeDir, VARADISE_ADMIN_EMAIL: 'arabic@example.com', VARADISE_ADMIN_PASSWORD: 'ArabicTest123' });
  const { server } = await import('../src/server.js');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body && JSON.stringify(body) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    return { status: response.status, body: await response.json() };
  };
  const login = await request('/api/auth/login', 'POST', { email: 'arabic@example.com', password: 'ArabicTest123', preferredLanguage: 'ar' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.preferredLanguage, 'ar');
  assert.equal((await request('/api/auth/session')).body.user.preferredLanguage, 'ar');
  assert.equal((await request('/api/auth/preferences', 'PUT', { preferredLanguage: 'en' })).status, 200);
  assert.equal((await request('/api/auth/preferences', 'PUT', { preferredLanguage: 'ar' })).body.user.preferredLanguage, 'ar');
  assert.equal((await request('/api/auth/preferences', 'PUT', { preferredLanguage: 'unsupported' })).status, 400);
  const override = await request('/api/settings/translations/ar', 'PUT', { source: 'Projects', translation: 'المشروعات' });
  assert.equal(override.status, 200);
  assert.equal(override.body.overrides.Projects, 'المشروعات');
  assert.equal((await request('/api/platform')).body.translationOverrides.ar.Projects, 'المشروعات');
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
  assert.equal(saved.users[0].preferredLanguage, 'ar');
  assert.equal(saved.settings.translationOverrides.ar.Projects, 'المشروعات');
  assert.equal((await request('/api/settings/translations/ar', 'PUT', { source: 'Projects', translation: '' })).body.overrides.Projects, undefined);
  assert.equal((await request('/api/auth/preferences', 'PUT', { preferredLanguage: 'zh-Hant' })).status, 200);
  assert.equal((await request('/api/auth/preferences', 'PUT', { preferredLanguage: 'zh-Hans' })).status, 200);
});
