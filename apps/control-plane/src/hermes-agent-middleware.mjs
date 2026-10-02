import http from 'node:http';
import { cancelHermesCli, executeHermesCli, hermesCliConfiguration, hermesCliHealth } from './hermes-cli-adapter.mjs';

const port = Number(process.env.HERMES_AGENT_MIDDLEWARE_PORT || 3010);
const host = String(process.env.HERMES_AGENT_MIDDLEWARE_HOST || '0.0.0.0').trim();
const upstream = String(process.env.HERMES_AGENT_MIDDLEWARE_UPSTREAM || '').trim().replace(/\/$/, '');
const adapterSecret = String(process.env.HERMES_AGENT_MIDDLEWARE_SECRET || '').trim();
const requestedRuntimeKind = String(process.env.HERMES_AGENT_MIDDLEWARE_RUNTIME_KIND || 'reference').trim().toLowerCase();
const runtimeKind = ['local-cli', 'external', 'reference'].includes(requestedRuntimeKind) ? requestedRuntimeKind : 'reference';
const cliConfiguration = hermesCliConfiguration();
const upstreamSecret = String(process.env.HERMES_AGENT_MIDDLEWARE_UPSTREAM_SECRET || '').trim();
const configuredRequestBytes = Number(process.env.HERMES_AGENT_MIDDLEWARE_MAX_REQUEST_BYTES);
// Image-bearing WhatsApp requests can legitimately contain several megabytes
// of authorized attachment data. Keep the limit bounded so a malformed client
// cannot consume unbounded memory, while leaving enough room for the platform's
// configured image limits (6 x 8 MB plus JSON/base64 overhead).
const maxRequestBytes = Number.isFinite(configuredRequestBytes) && configuredRequestBytes > 0
  ? Math.min(Math.max(Math.floor(configuredRequestBytes), 1_048_576), 256 * 1024 * 1024)
  : 64 * 1024 * 1024;
const cleanError = cause => String(cause?.message || cause || 'Unknown error').replace(/\s+/g, ' ').trim().slice(0, 300);
const modelProviderFrom = (request, envelope = {}) => ({
  modelName: String(envelope.modelProvider?.modelName || '').trim().slice(0, 160),
  serviceUrl: String(envelope.modelProvider?.serviceUrl || '').trim().slice(0, 500),
  timeoutSeconds: Number(envelope.modelProvider?.timeoutSeconds || 180),
  apiKey: String(request.headers['x-varadise-hermes-model-key'] || '').trim()
});
const providerCandidates = provider => {
  const base = String(provider.serviceUrl || '').replace(/\/$/, ''), model = String(provider.modelName || '').trim(), strippedModel = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
  const bases = [...new Set([base, base && !/\/v\d+$/i.test(base) ? `${base}/v1` : ''].filter(Boolean))], models = [...new Set([model, strippedModel].filter(Boolean))];
  return bases.flatMap(serviceUrl => models.map(modelName => ({ ...provider, serviceUrl, modelName }))).slice(0, 4);
};
const providerErrorDetail = payload => String(payload?.error?.message || payload?.error || payload?.message || payload?.detail || '').replace(/\s+/g, ' ').trim().slice(0, 300);
async function verifiedProviderCandidate(provider) {
  if (!provider.apiKey || !provider.modelName || !provider.serviceUrl) return { provider: null, errors: ['Hermes model connector is incomplete.'] };
  const errors = [];
  for (const candidate of providerCandidates(provider)) {
    const endpoint = `${candidate.serviceUrl.replace(/\/$/, '')}/chat/completions`;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${candidate.apiKey}` }, body: JSON.stringify({ model: candidate.modelName, messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(Math.min(20_000, Math.max(5_000, Number(candidate.timeoutSeconds || 180) * 1000))) });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return { provider: candidate, errors };
      errors.push(`${new URL(endpoint).pathname}: HTTP ${response.status}${providerErrorDetail(payload) ? ` · ${providerErrorDetail(payload)}` : ''}`);
    } catch (cause) { errors.push(`${new URL(endpoint).pathname}: ${cleanError(cause)}`); }
  }
  return { provider: null, errors };
}
async function executeLocalHermes(envelope, provider) {
  const timeoutMs = Number(envelope.constraints?.timeoutSeconds || 90) * 1000;
  let payload = await executeHermesCli(envelope, { configuration: cliConfiguration, timeoutMs, provider });
  if (payload.status !== 'approval_required') return payload;
  const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
  const approvalAvailable = envelope.constraints?.requireToolApproval === true && Array.isArray(envelope.constraints?.allowedTools) && envelope.constraints.allowedTools.length > 0;
  if (approvalAvailable && toolCalls.length) return payload;
  const recoveryStep = toolCalls.length ? 'unavailable-tool-approval-recovery' : 'empty-tool-approval-recovery';
  const recoveryEnvelope = {
    ...envelope,
    constraints: { ...(envelope.constraints || {}), allowedTools: [], requireToolApproval: false },
    temporaryGuidance: `${String(envelope.temporaryGuidance || '').trim()}\nLOCAL_HERMES_APPROVAL_RECOVERY: The preceding attempt requested tool approval when no resumable approval was available for this run. The Agent Platform has already supplied all authorized project and template context. Do not use or request any tool. Answer the user's message from the supplied context and return status completed.`.trim()
  };
  payload = await executeHermesCli(recoveryEnvelope, { configuration: cliConfiguration, timeoutMs, provider });
  if (payload.status === 'approval_required') return { ...payload, status: 'failed', content: '', error: 'Hermes repeated a tool-approval request during a no-tool recovery run.', trace: [{ step: recoveryStep, status: 'failed', policy: 'no-tools' }, ...(Array.isArray(payload.trace) ? payload.trace : [])] };
  payload.trace = [{ step: recoveryStep, status: 'completed', policy: 'no-tools' }, ...(Array.isArray(payload.trace) ? payload.trace : [])];
  return payload;
}
let lastCliExecution = null;
const readBody = request => new Promise((resolve, reject) => {
  let value = '', bytes = 0, settled = false;
  const fail = cause => { if (settled) return; settled = true; reject(cause); };
  request.setEncoding('utf8');
  request.on('data', chunk => {
    if (settled) return;
    const chunkBytes = Buffer.byteLength(chunk, 'utf8');
    bytes += chunkBytes;
    if (bytes > maxRequestBytes) {
      const cause = new Error(`Request exceeds the Hermes middleware limit of ${maxRequestBytes} bytes.`);
      cause.code = 'HERMES_REQUEST_TOO_LARGE';
      fail(cause);
      // Drain the request so the connection can be reused cleanly. The caller
      // returns a controlled 413 response from its endpoint catch block.
      request.resume();
      return;
    }
    value += chunk;
  });
  request.on('end', () => { if (!settled) { settled = true; resolve(value); } });
  request.on('error', fail);
});
const requestErrorStatus = (cause, fallback = 502) => cause?.code === 'HERMES_REQUEST_TOO_LARGE' ? 413 : fallback;
const json = (response, status, value) => { const payload = JSON.stringify(value); response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' }); response.end(payload); };
const authorized = request => !adapterSecret || request.headers.authorization === `Bearer ${adapterSecret}`;
const upstreamTarget = pathname => {
  if (!upstream) return '';
  if (pathname === '/execute' && (upstream.endsWith('/execute') || upstream.endsWith('/api/internal/hermes-middleware'))) return upstream;
  return `${upstream.replace(/\/(?:execute|health)$/i, '')}${pathname}`;
};
async function proxy(pathname, request, response, body = '') {
  if (!upstream) return json(response, 503, { status: 'failed', content: '', error: 'No external Hermes middleware provider is configured.', code: 'HERMES_EXTERNAL_NOT_CONFIGURED' });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }; if (upstreamSecret) headers.Authorization = `Bearer ${upstreamSecret}`;
  const result = await fetch(upstreamTarget(pathname), { method: request.method, headers, body: request.method === 'GET' ? undefined : body, signal: AbortSignal.timeout(90_000) });
  const raw = await result.text(); response.writeHead(result.status, { 'Content-Type': result.headers.get('content-type') || 'application/json', 'Content-Length': Buffer.byteLength(raw), 'Cache-Control': 'no-store' }); response.end(raw);
}
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method === 'GET' && pathname === '/health') {
    const cliHealth = hermesCliHealth(cliConfiguration), cliIntegrated = runtimeKind === 'local-cli' && cliHealth.installed && cliHealth.executionConfigured;
    let externalHealth = null, externalIntegrated = false;
    if (runtimeKind === 'external' && upstream) {
      try { const headers = { Accept: 'application/json' }; if (upstreamSecret) headers.Authorization = `Bearer ${upstreamSecret}`; const probe = await fetch(upstreamTarget('/health'), { headers, signal: AbortSignal.timeout(10_000) }); externalHealth = await probe.json().catch(() => ({})); externalIntegrated = probe.ok && externalHealth.executionIntegrated !== false && externalHealth.status !== 'failed' && externalHealth.status !== 'degraded'; if (!externalIntegrated) externalHealth = { ...externalHealth, httpStatus: probe.status }; }
      catch (cause) { externalHealth = { status: 'unavailable', error: cleanError(cause) }; }
    }
    const integrated = cliIntegrated || externalIntegrated;
    // A provider health endpoint proves reachability/integration only. It must
    // not be presented as proof that an actual Hermes execution completed.
    const executionVerified = runtimeKind === 'local-cli' ? lastCliExecution?.status === 'completed' : externalHealth?.executionVerified === true;
    return json(response, integrated ? 200 : 503, { status: integrated ? 'ready' : 'degraded', service: 'hermes-agent-middleware', adapterVersion: 5, runtimeKind, realHermesRuntime: integrated, executionIntegrated: integrated, executionVerified, lastExecution: lastCliExecution, hermesCli: { vendor: process.env.HERMES_AGENT_VENDOR || null, ...cliHealth, executionIntegrated: cliIntegrated }, externalHealth, capabilities: { cancellation: runtimeKind === 'local-cli' || externalIntegrated, trace: true, memoryInspection: externalIntegrated, memoryClear: externalIntegrated, toolApproval: externalIntegrated, platformMediatedApproval: runtimeKind === 'local-cli', emptyApprovalRecovery: runtimeKind === 'local-cli' }, limits: { maxRequestBytes }, adapterReady: true, upstreamConfigured: Boolean(upstream), upstream: upstream || null, host, port });
  }
  if (request.method === 'POST' && pathname === '/cancel') {
    if (!authorized(request)) return json(response, 401, { error: 'Hermes middleware authentication failed.' });
    try { const raw = await readBody(request); if (runtimeKind === 'external') return await proxy(pathname, request, response, raw); const envelope = JSON.parse(raw || '{}'); const result = runtimeKind === 'local-cli' ? cancelHermesCli(envelope.requestId) : { ok: false, requestId: String(envelope.requestId || ''), reason: 'Cancellation is unavailable in reference mode.' }; return json(response, result.ok ? 200 : 409, result); }
    catch (cause) {
      const timedOut = cause?.name === 'AbortError' || /timeout/i.test(String(cause?.message || ''));
      return json(response, requestErrorStatus(cause, timedOut ? 504 : 502), { error: String(cause.message || cause).slice(0, 300), code: cause?.code || (timedOut ? 'HERMES_UPSTREAM_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE') });
    }
  }
  if (['/approval', '/memory', '/memory/clear'].includes(pathname)) {
    if (!authorized(request)) return json(response, 401, { error: 'Hermes middleware authentication failed.' });
    if (runtimeKind !== 'external') return json(response, 501, { ok: false, supported: false, error: `The ${runtimeKind} runtime does not expose a verified ${pathname.slice(1)} operation.` });
    try { return await proxy(pathname, request, response, request.method === 'GET' ? '' : await readBody(request)); } catch (cause) { return json(response, requestErrorStatus(cause), { error: String(cause.message || cause).slice(0, 300), code: cause?.code || 'HERMES_UPSTREAM_UNAVAILABLE' }); }
  }
  if (request.method !== 'POST' || pathname !== '/execute') return json(response, 404, { error: 'Not found.' });
  if (!authorized(request)) return json(response, 401, { error: 'Hermes middleware authentication failed.' });
  try {
    const raw = await readBody(request), envelope = JSON.parse(raw || '{}');
    if (!envelope.requestId) return json(response, 400, { status: 'failed', error: 'requestId is required.' });
    if (runtimeKind === 'local-cli') {
      const startedAt = Date.now();
      try {
        const provider = modelProviderFrom(request, envelope);
        try {
          const payload = await executeLocalHermes(envelope, provider);
          lastCliExecution = { requestId: envelope.requestId, status: payload.status || 'failed', completedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, configuredModel: provider.modelName || null, providerHost: provider.serviceUrl ? new URL(provider.serviceUrl).host : null };
          return json(response, 200, { ...payload, requestId: payload.requestId || envelope.requestId });
        } catch (initialCause) {
          if (initialCause?.code !== 'HERMES_CLI_FAILED') throw initialCause;
          const resolution = await verifiedProviderCandidate(provider), resolved = resolution.provider;
          if (!resolved || resolved.modelName === provider.modelName && resolved.serviceUrl === provider.serviceUrl) throw Object.assign(initialCause, { message: `${cleanError(initialCause)} Model connector diagnostic: ${resolution.errors.join(' | ').slice(0, 900)}` });
          let payload;
          try { payload = await executeLocalHermes(envelope, resolved); }
          catch (retryCause) { throw Object.assign(retryCause, { message: `${cleanError(retryCause)} Verified provider compatibility retry: ${provider.modelName || '(empty)'} @ ${provider.serviceUrl || '(empty)'} -> ${resolved.modelName} @ ${resolved.serviceUrl}` }); }
          payload.trace = [{ step: 'hermes-model-provider-compatibility', status: 'completed', configuredModel: provider.modelName, resolvedModel: resolved.modelName, configuredEndpoint: provider.serviceUrl, resolvedEndpoint: resolved.serviceUrl }, ...(Array.isArray(payload.trace) ? payload.trace : [])];
          lastCliExecution = { requestId: envelope.requestId, status: payload.status || 'failed', completedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, configuredModel: provider.modelName || null, resolvedModel: resolved.modelName, providerHost: new URL(resolved.serviceUrl).host, compatibilityRetry: true };
          return json(response, 200, { ...payload, requestId: payload.requestId || envelope.requestId });
        }
      } catch (cause) { lastCliExecution = { requestId: envelope.requestId, status: 'failed', completedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, code: cause?.code || null, error: cleanError(cause) }; throw cause; }
    }
    if (runtimeKind !== 'external') return json(response, 503, { requestId: envelope.requestId, status: 'failed', content: '', error: 'Reference Hermes mode does not execute agent requests. Select local-cli or configure an external provider.', code: 'HERMES_REFERENCE_ONLY' });
    if (!upstream) return json(response, 503, { requestId: envelope.requestId, status: 'failed', content: '', error: 'No external Hermes middleware provider is configured.', code: 'HERMES_EXTERNAL_NOT_CONFIGURED' });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }; if (upstreamSecret) headers.Authorization = `Bearer ${upstreamSecret}`;
    const result = await fetch(upstreamTarget('/execute'), { method: 'POST', headers, body: JSON.stringify(envelope), signal: AbortSignal.timeout(Number(envelope.constraints?.timeoutSeconds || 90) * 1000) });
    const upstreamRaw = await result.text();
    let payload = {};
    try { payload = upstreamRaw ? JSON.parse(upstreamRaw) : {}; } catch { payload = {}; }
    if (!result.ok) {
      const detail = String(payload?.error || payload?.message || payload?.detail || upstreamRaw || `Upstream returned HTTP ${result.status}`).replace(/\s+/g, ' ').trim().slice(0, 500);
      return json(response, result.status, { requestId: payload.requestId || envelope.requestId, status: 'failed', content: '', error: detail, code: String(payload?.code || `HERMES_UPSTREAM_HTTP_${result.status}`).slice(0, 100), middlewareStatus: result.status });
    }
    return json(response, result.status, { ...payload, requestId: payload.requestId || envelope.requestId });
  } catch (cause) {
    const timedOut = cause?.name === 'AbortError' || /timeout/i.test(String(cause?.message || ''));
    const status = requestErrorStatus(cause, timedOut || cause?.code === 'HERMES_CLI_TIMEOUT' ? 504 : cause?.retryable === false ? 422 : 502);
    return json(response, status, { status: 'failed', error: (timedOut ? 'Hermes middleware upstream timed out.' : String(cause.message || cause)).slice(0, 500), code: cause?.code || (timedOut ? 'HERMES_UPSTREAM_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE') });
  }
});
server.on('error', cause => {
  // Surface bind/configuration failures as a concise supervisor event rather
  // than an unhandled EventEmitter exception. The supervisor can then apply
  // its bounded restart policy and keep the control-plane child independent.
  console.error(`Hermes agent middleware failed to bind ${host}:${port}: ${cause.code || cause.message}`);
  process.exitCode = 1;
  process.exit(1);
});
server.listen(port, host, () => console.log(`Hermes agent middleware listening on ${host}:${port}`));
const shutdown = () => server.close(() => process.exit(0)); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
