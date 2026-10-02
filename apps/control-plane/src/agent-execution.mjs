import crypto from 'node:crypto';

export const DEFAULT_EXECUTION_CONFIG = Object.freeze({
  executionMode: 'direct',
  hermes: { connectorId: '', profile: '', timeoutSeconds: 90, maxSteps: 8, fallbackMode: 'disabled', memoryEnabled: true, planningEnabled: true, requireToolApproval: false }
});

const bool = (value, fallback) => value === undefined || value === null || value === '' ? fallback : value === true || String(value).toLowerCase() === 'true';
const int = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; };

export function normalizeExecutionConfig(value = {}) {
  const hermes = value.hermes && typeof value.hermes === 'object' ? value.hermes : value;
  return {
    executionMode: value.executionMode === 'hermes' ? 'hermes' : 'direct',
    hermes: {
      connectorId: String(hermes.connectorId || '').trim().slice(0, 120),
      profile: String(hermes.profile || '').trim().slice(0, 120),
      timeoutSeconds: int(hermes.timeoutSeconds, 90, 5, 600),
      maxSteps: int(hermes.maxSteps, 8, 1, 32),
      fallbackMode: hermes.fallbackMode === 'direct' ? 'direct' : 'disabled',
      memoryEnabled: bool(hermes.memoryEnabled, true),
      planningEnabled: bool(hermes.planningEnabled, true),
      requireToolApproval: bool(hermes.requireToolApproval, false)
    }
  };
}

export function validateMiddlewareResponse(payload, requestId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Hermes middleware returned an invalid response object.'), { code: 'HERMES_INVALID_RESPONSE', retryable: false });
  const rawStatus = String(payload.status ?? payload.state ?? payload.result?.status ?? '').toLowerCase();
  const status = rawStatus === 'completed' || rawStatus === 'complete' || rawStatus === 'success' || rawStatus === 'succeeded' || rawStatus === 'ok' || rawStatus === 'done' ? 'completed' : rawStatus === 'failed' || rawStatus === 'error' ? 'failed' : rawStatus === 'approval_required' || rawStatus === 'approval-required' || rawStatus === 'needs_approval' ? 'approval_required' : null;
  if (!status) throw Object.assign(new Error('Hermes middleware response status must be completed, failed or approval_required.'), { code: 'HERMES_INVALID_RESPONSE', retryable: false });
  if (payload.requestId && String(payload.requestId) !== String(requestId)) throw Object.assign(new Error('Hermes middleware response requestId does not match the platform request.'), { code: 'HERMES_INVALID_RESPONSE', retryable: false });
  const textFromValue = value => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(item => textFromValue(item?.text ?? item?.content ?? item)).filter(Boolean).join('');
    if (value && typeof value === 'object') return textFromValue(value.text ?? value.content ?? value.output_text ?? value.output ?? value.response ?? '');
    return '';
  };
  const content = textFromValue(payload.content ?? payload.reply ?? payload.message ?? payload.output_text ?? payload.output ?? payload.response ?? payload.result ?? payload.result?.content ?? payload.result?.reply ?? payload.result?.message ?? payload.result?.output ?? payload.data ?? payload.data?.content ?? payload.data?.reply ?? payload.data?.output).trim();
  if (content.length > 200_000) throw Object.assign(new Error('Hermes middleware response exceeded the platform response limit.'), { code: 'HERMES_INVALID_RESPONSE', retryable: false });
  if (status === 'completed' && !content) throw Object.assign(new Error('Hermes middleware reported completion but returned no response content.'), { code: 'HERMES_EMPTY_RESPONSE', retryable: true });
  return { requestId, status, content, model: payload.model ? String(payload.model).slice(0, 120) : null, trace: Array.isArray(payload.trace) ? payload.trace.slice(0, 100) : [], toolCalls: Array.isArray(payload.toolCalls) ? payload.toolCalls.slice(0, 100) : [], memoryEvents: Array.isArray(payload.memoryEvents) ? payload.memoryEvents.slice(0, 100) : [], usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : {}, error: payload.error ? String(payload.error).slice(0, 500) : null };
}

export class DirectModelExecutor {
  constructor(handler) { this.handler = handler; }
  async executeAgentRequest(context) { return this.handler(context); }
}

export class HermesMiddlewareExecutor {
  constructor({ connector, fetchImpl = globalThis.fetch } = {}) { this.connector = connector; this.fetchImpl = fetchImpl; }
  async executeAgentRequest(context) {
    if (!this.connector?.endpoint) throw Object.assign(new Error('Hermes middleware connector is not configured.'), { code: 'HERMES_NOT_CONFIGURED', retryable: false });
    const requestId = context.requestId || crypto.randomUUID();
    const controller = new AbortController();
    const timeoutSeconds = int(context.constraints?.timeoutSeconds, 90, 5, 600);
    const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (this.connector.apiKey) headers.Authorization = `Bearer ${this.connector.apiKey}`;
      const modelProvider = this.connector.modelProvider || {};
      if (modelProvider.apiKey) headers['X-Varadise-Hermes-Model-Key'] = String(modelProvider.apiKey);
      const requestBody = {
        ...context,
        requestId,
        ...(modelProvider.modelName || modelProvider.serviceUrl ? { modelProvider: { modelName: String(modelProvider.modelName || '').slice(0, 160), serviceUrl: String(modelProvider.serviceUrl || '').slice(0, 500), ...(modelProvider.timeoutSeconds ? { timeoutSeconds: int(modelProvider.timeoutSeconds, 180, 30, 600) } : {}) } } : {})
      };
      let response;
      try { response = await this.fetchImpl(this.connector.endpoint.replace(/\/$/, ''), { method: 'POST', headers, body: JSON.stringify(requestBody), signal: controller.signal }); }
      catch (cause) { throw Object.assign(new Error(cause?.name === 'AbortError' ? `Hermes middleware timed out after ${timeoutSeconds} seconds.` : 'Hermes middleware service could not be reached.'), { code: cause?.name === 'AbortError' ? 'HERMES_TIMEOUT' : 'HERMES_UNAVAILABLE', retryable: true }); }
      let payload = {}; try { payload = await response.json(); } catch { /* handled below */ }
      if (!response.ok) { const detail = String(payload?.error || payload?.message || payload?.detail || '').trim().slice(0, 300); throw Object.assign(new Error(`Hermes middleware returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`), { code: String(payload?.code || 'HERMES_HTTP_ERROR').slice(0, 80), retryable: response.status >= 500 || response.status === 408 || response.status === 429, status: response.status, middlewareStatus: response.status, middlewareError: detail || null }); }
      return validateMiddlewareResponse(payload, requestId);
    } finally { clearTimeout(timeout); }
  }
}

export function buildHermesRequest({ requestId, project, deployment, expert, instructions, content, channel, history, projectContext, groupContext, attachments, skills, allowedTools, permissions, profile, capabilities, temporaryGuidance, outputFormat, templateId, modelProvider }) {
  return { requestId, project: { id: project?.id || null, name: project?.name || null }, deployment: { id: deployment?.id || null, name: deployment?.name || null }, agent: { id: expert?.id || null, name: expert?.name || null, specialty: expert?.specialty || null, instructions: String(instructions || '').slice(0, 20_000) }, profile: profile || '', ...(modelProvider?.modelName || modelProvider?.serviceUrl ? { modelProvider: { modelName: String(modelProvider.modelName || '').slice(0, 160), serviceUrl: String(modelProvider.serviceUrl || '').slice(0, 500), ...(modelProvider.timeoutSeconds ? { timeoutSeconds: int(modelProvider.timeoutSeconds, 180, 30, 600) } : {}) } } : {}), request: { content: String(content || '').slice(0, 20_000), channel: channel === 'whatsapp' ? 'whatsapp' : 'agent-chat', outputFormat: outputFormat || '', templateId: templateId || null, conversationHistory: Array.isArray(history) ? history.slice(-20) : [], projectContext: String(projectContext || '').slice(0, 40_000), groupContext: String(groupContext || '').slice(0, 20_000), attachments: Array.isArray(attachments) ? attachments.slice(0, 20) : [] }, skills: Array.isArray(skills) ? skills.slice(0, 40) : [], capabilities: { memory: Boolean(capabilities?.memory), planning: Boolean(capabilities?.planning), maximumSteps: int(capabilities?.maximumSteps, 8, 1, 32) }, constraints: { allowedTools: Array.isArray(allowedTools) ? allowedTools.slice(0, 50) : [], permissions: permissions || {}, timeoutSeconds: int(capabilities?.timeoutSeconds, 90, 5, 600), requireToolApproval: Boolean(capabilities?.requireToolApproval) }, temporaryGuidance: temporaryGuidance ? String(temporaryGuidance).slice(0, 8_000) : undefined };
}
