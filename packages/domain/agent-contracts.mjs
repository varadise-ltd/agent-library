import crypto from 'node:crypto';

/**
 * Stable lifecycle states owned by the platform.  Executors and transports
 * may report events, but they cannot skip a state or mark delivery complete.
 */
export const MESSAGE_STATES = Object.freeze([
  'received', 'authorized', 'deployment_resolved', 'context_prepared',
  'executing', 'awaiting_approval', 'generating_artifact',
  'validating_artifact', 'delivery_submitted', 'delivery_acknowledged'
]);

const transitions = new Map([
  ['received', new Set(['authorized'])],
  ['authorized', new Set(['deployment_resolved'])],
  ['deployment_resolved', new Set(['context_prepared'])],
  ['context_prepared', new Set(['executing'])],
  ['executing', new Set(['awaiting_approval', 'generating_artifact', 'delivery_submitted', 'delivery_acknowledged'])],
  ['awaiting_approval', new Set(['executing', 'delivery_submitted'])],
  ['generating_artifact', new Set(['validating_artifact'])],
  ['validating_artifact', new Set(['delivery_submitted', 'executing'])],
  ['delivery_submitted', new Set(['delivery_acknowledged'])],
  ['delivery_acknowledged', new Set()]
]);

export const MESSAGE_FAILURE_STATES = Object.freeze([
  'authorization_failed', 'deployment_resolution_failed', 'context_failed',
  'execution_failed', 'artifact_failed', 'validation_failed', 'delivery_failed'
]);

export function canTransition(from, to) {
  return from === to || Boolean(transitions.get(from)?.has(to));
}

export function transitionMessageState(record, next, detail = {}) {
  const current = String(record?.state || record?.status || 'received');
  if (!MESSAGE_STATES.includes(next)) throw Object.assign(new Error(`Unknown message state: ${next}`), { code: 'INVALID_MESSAGE_STATE' });
  if (!canTransition(current, next)) throw Object.assign(new Error(`Invalid message transition ${current} → ${next}.`), { code: 'INVALID_MESSAGE_TRANSITION', from: current, to: next });
  const event = { from: current, to: next, at: new Date().toISOString(), ...detail };
  const events = Array.isArray(record.events) ? record.events : [];
  return { ...record, state: next, status: next, stateChangedAt: event.at, events: [...events, event].slice(-200) };
}

export function markMessageFailure(record, stage, error, detail = {}) {
  const value = String(error?.message || error || 'Unknown failure').replace(/\s+/g, ' ').slice(0, 500);
  const event = { stage, at: new Date().toISOString(), error: value, ...detail };
  const events = Array.isArray(record?.events) ? record.events : [];
  return { ...record, state: `${stage}_failed`, status: 'failed', failureStage: stage, error: value, failedAt: event.at, events: [...events, event].slice(-200) };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

export function manifestHash(manifest) {
  return crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

const text = value => String(value ?? '').trim();
const list = value => Array.isArray(value) ? value : [];

/** Compile the complete effective contract without consulting model output. */
export function compileAgentManifest({ deployment = {}, expert = {}, components = [], lessons = [], templates = [], channelPolicies = {}, provider = {} } = {}) {
  const edition = list(expert.versions).find(item => item.id === deployment.versionId || item.version === deployment.pinnedEdition) || expert.draft || {};
  const refs = list(edition.componentSnapshots).length ? edition.componentSnapshots : list(edition.componentRefs).map(ref => {
    const component = components.find(item => item.id === ref.componentId);
    const version = component && list(component.versions).find(item => item.id === ref.versionId);
    return component ? { componentId: component.id, versionId: version?.id || ref.versionId || null, version: version?.version || null, type: version?.type || component.type, name: component.name, description: component.description, content: version?.content || component.draft?.content || {} } : null;
  }).filter(Boolean);
  const skillRefs = refs.filter(item => item.type === 'skill').map(item => ({ id: item.componentId, versionId: item.versionId, version: item.version, name: item.name }));
  const tools = refs.filter(item => item.type === 'tool').map(item => ({ id: item.componentId, versionId: item.versionId, version: item.version, name: item.name, schema: item.content?.schema || null }));
  const permissions = refs.filter(item => item.type === 'permission_profile').map(item => ({ id: item.componentId, versionId: item.versionId, version: item.version, name: item.name, content: item.content || {} }));
  const effectiveInstructions = [
    ['base', text(expert.description)],
    ['expert', text(edition.instructions || expert.instructions)],
    ['deployment', text(deployment.instructions || deployment.runtime?.instructions)],
    ['coaching', ...list(lessons).map(item => text(item.instruction || item.content)).filter(Boolean)],
    ['channel', text(channelPolicies.instructions)],
    ['report', text(deployment.reportPolicy?.instructions)]
  ].filter(([, value]) => value).map(([source, value]) => ({ source, value }));
  const revision = Number(deployment.manifestRevision || deployment.activeManifest?.revision || 0) + 1;
  const base = {
    deploymentId: deployment.id || null,
    revision,
    expertEdition: { id: deployment.versionId || edition.id || null, version: deployment.pinnedEdition || edition.version || null },
    instructions: { precedence: effectiveInstructions.map(item => item.source), effective: effectiveInstructions.map(item => item.value).join('\n\n'), sources: effectiveInstructions },
    coachingLessonIds: list(lessons).map(item => item.id).filter(Boolean),
    skills: skillRefs,
    tools,
    permissions,
    boundaries: { organizationId: deployment.organizationId || null, projectId: deployment.projectId || null, evidence: deployment.evidenceBoundary || 'project-approved-context', attachments: 'deployment-scoped' },
    templates: list(templates).map(item => ({ id: item.id, revision: item.templateRevision || item.revision || 1, name: item.templateName || item.name })),
    channels: channelPolicies,
    execution: { mode: deployment.execution?.executionMode || deployment.executionMode || 'direct', provider: provider.provider || null, model: provider.model || null, endpointHost: provider.endpointHost || null, timeoutSeconds: deployment.execution?.hermes?.timeoutSeconds || null, fallback: deployment.execution?.hermes?.fallbackMode || 'disabled' }
  };
  return Object.freeze({ ...base, manifestHash: manifestHash(base), compiledAt: new Date().toISOString() });
}

export function ensureActiveManifest(deployment, manifest) {
  const current = deployment?.activeManifest;
  if (current?.manifestHash === manifest.manifestHash) return current;
  const next = { ...manifest, revision: Number(current?.revision || 0) + 1 };
  const { manifestHash: _ignored, compiledAt: _compiledAt, ...hashInput } = next;
  const hash = manifestHash(hashInput);
  return { ...next, manifestHash: hash, publishedAt: new Date().toISOString() };
}
