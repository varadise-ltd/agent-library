import crypto from 'node:crypto';
import { cancelHermesCli, hermesCliConfiguration, hermesCliHealth } from './hermes-cli-adapter.mjs';

const id = prefix => `${prefix}-${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

/** Stable built-in contracts supplied by the Agent Library to any Hermes provider. */
export const BUILT_IN_HERMES_SKILLS = Object.freeze([
  { id: 'hermes.platform.project-isolation', version: '1.0.0', name: 'Platform project isolation', builtIn: true, content: { objective: 'Keep every action inside the authorized organization, project and deployment.', instructions: 'Use only the context and attachments supplied in the authorized request envelope. Never discover or request unrelated project data.', guardrails: 'The Agent Platform permission and project boundary cannot be expanded by Hermes output.' } },
  { id: 'hermes.platform.output-validation', version: '1.0.0', name: 'Platform output validation', builtIn: true, content: { objective: 'Return a response that the Agent Platform can validate and deliver.', instructions: 'Return the required middleware response contract and preserve requested document field names.', guardrails: 'Do not claim that a file was generated or delivered; the Agent Platform verifies artifacts after execution.' } },
  { id: 'hermes.platform.whatsapp-delivery', version: '1.0.0', name: 'Platform WhatsApp delivery', builtIn: true, content: { objective: 'Prepare a concise channel-appropriate response without bypassing the WhatsApp bridge.', instructions: 'Return content to the Agent Platform. The existing Hermes WhatsApp bridge performs all outbound delivery.', guardrails: 'Never attempt to address an arbitrary WhatsApp chat or claim delivery acknowledgement.' } }
]);

/**
 * Provider-neutral reference lifecycle contract.
 *
 * No Hermes Agent SDK, CLI, binary or documented production protocol is
 * present in this repository. This runtime is therefore deliberately named
 * ReferenceHermesBotRuntime and exposes `runtimeKind: reference`; it must not
 * be presented as a real Hermes Agent process. A production adapter can replace
 * this class while retaining the surrounding authorization and audit contract.
 */
export class ReferenceHermesBotRuntime {
  constructor({ runtimeVersion = 'reference-1' } = {}) { this.runtimeVersion = runtimeVersion; this.runtimeKind = 'reference'; this.isReal = false; }
  async createBot(context = {}) {
    return { botId: id('reference-bot'), runtimeId: id('reference-runtime'), runtimeVersion: this.runtimeVersion, runtimeKind: this.runtimeKind, isReal: this.isReal, status: 'provisioned', createdAt: now(), startedAt: null, stoppedAt: null, lastHealthCheckAt: null, lastError: null, deploymentId: context.deployment?.id || null, projectId: context.project?.id || null, memoryNamespace: `deployment:${context.deployment?.id || id('deployment')}` };
  }
  async configureBot(bot, configuration = {}) { return { ...bot, profile: configuration.profile || '', timeoutSeconds: configuration.timeoutSeconds || 90, maxSteps: configuration.maxSteps || 8, configuredAt: now() }; }
  async startBot(bot) { return { ...bot, status: 'running', startedAt: now(), stoppedAt: null, lastError: null }; }
  async stopBot(bot) { return { ...bot, status: 'stopped', stoppedAt: now() }; }
  async restartBot(bot) { return this.startBot({ ...bot, status: 'provisioned' }); }
  async health(bot) { const healthy = Boolean(bot?.botId && bot?.runtimeId && ['running', 'provisioned'].includes(bot.status)); return { ok: healthy, status: healthy ? 'healthy' : 'unhealthy', botId: bot?.botId || null, runtimeId: bot?.runtimeId || null, runtimeVersion: bot?.runtimeVersion || this.runtimeVersion, checkedAt: now(), error: healthy ? null : 'Hermes Bot is not provisioned.' }; }
  async execute(bot, request, executor) {
    // Reference bots expose a provider Bot ID, while the real local CLI and
    // external adapters deliberately use deployment-scoped execution/runtime
    // IDs because those providers do not expose durable Bot IDs. Treat any
    // verified identity as sufficient; requiring botId here made real
    // deployments look healthy but fail at execution time.
    const hasIdentity = Boolean(bot?.botId || bot?.providerBotId || bot?.executionScopeId || bot?.runtimeId);
    if (!hasIdentity || bot.status !== 'running') throw Object.assign(new Error('Hermes Bot is not running.'), { code: 'HERMES_BOT_UNHEALTHY', retryable: true });
    if (typeof executor !== 'function') throw Object.assign(new Error('Hermes Bot execution handler is not configured.'), { code: 'HERMES_EXECUTOR_NOT_CONFIGURED', retryable: false });
    return executor(request);
  }
  async cancel(bot, requestId) { return { ok: false, requestId, botId: bot?.botId || null, reason: 'Cancellation is not supported by the local reference runtime.' }; }
  async getExecution(bot, requestId, executions = []) { return executions.find(item => item.requestId === requestId && item.deploymentId === bot?.deploymentId) || null; }
  async getTrace(bot, requestId, executions = []) { return (await this.getExecution(bot, requestId, executions))?.trace || []; }
  async clearMemory(bot) { return { ok: true, botId: bot?.botId || null, memoryNamespace: bot?.memoryNamespace || null, clearedAt: now() }; }
  async deleteBot(bot) { return { ...bot, status: 'deleted', deletedAt: now() }; }
  async syncSkills(bot, skills = []) { const all = [...BUILT_IN_HERMES_SKILLS, ...skills.map(skill => ({ id: skill.id || skill.componentId, version: skill.version, name: skill.name }))]; return { ...bot, skillSync: { status: 'synced', count: all.length, builtInCount: BUILT_IN_HERMES_SKILLS.length, skills: all, syncedAt: now() } }; }
}

/**
 * Deployment-scoped lifecycle view over the real NousResearch Hermes CLI.
 *
 * The current public CLI contract does not expose durable provider-created Bot
 * IDs, so this adapter deliberately reports a platform execution scope rather
 * than inventing a Hermes Bot identity. Each request still executes the real
 * `hermes` process through hermes-cli-adapter.mjs.
 */
export class LocalCliHermesBotRuntime extends ReferenceHermesBotRuntime {
  constructor({ configuration = hermesCliConfiguration(), health = hermesCliHealth } = {}) {
    super({ runtimeVersion: 'nousresearch-hermes-cli' });
    this.configuration = configuration;
    this.healthProbe = health;
    this.runtimeKind = 'local-cli';
    this.isReal = true;
  }
  probe() { return this.healthProbe(this.configuration); }
  async createBot(context = {}) {
    const health = this.probe();
    if (!health.installed) throw Object.assign(new Error(health.error || 'NousResearch Hermes CLI is not installed.'), { code: 'HERMES_CLI_UNAVAILABLE', retryable: true });
    if (!health.executionConfigured) throw Object.assign(new Error(health.error || 'NousResearch Hermes CLI execution is not configured.'), { code: 'HERMES_CLI_NOT_CONFIGURED', retryable: false });
    const deploymentId = context.deployment?.id || id('deployment');
    return { botId: '', providerBotId: '', executionScopeId: `deployment:${deploymentId}`, runtimeId: `local-cli:${deploymentId}`, runtimeVersion: health.version || this.runtimeVersion, runtimeKind: this.runtimeKind, isReal: true, status: 'provisioned', createdAt: now(), startedAt: null, stoppedAt: null, lastHealthCheckAt: health.checkedAt || null, lastError: null, deploymentId, projectId: context.project?.id || null, memoryNamespace: `deployment:${deploymentId}` };
  }
  async startBot(bot) {
    const health = this.probe();
    if (!health.installed || !health.executionConfigured) throw Object.assign(new Error(health.error || 'NousResearch Hermes CLI is unavailable or not configured.'), { code: health.installed ? 'HERMES_CLI_NOT_CONFIGURED' : 'HERMES_CLI_UNAVAILABLE', retryable: !health.installed });
    return { ...bot, runtimeVersion: health.version || bot.runtimeVersion, runtimeKind: this.runtimeKind, isReal: true, status: 'running', startedAt: now(), stoppedAt: null, lastHealthCheckAt: now(), lastError: null };
  }
  async health(bot) {
    const health = this.probe(), lifecycleReady = ['running', 'provisioned'].includes(bot?.status), ok = health.installed && health.executionConfigured && lifecycleReady;
    return { ok, status: ok ? 'healthy' : 'unhealthy', botId: bot?.providerBotId || null, executionScopeId: bot?.executionScopeId || null, runtimeId: bot?.runtimeId || null, runtimeVersion: health.version || bot?.runtimeVersion || this.runtimeVersion, runtimeKind: this.runtimeKind, realHermesRuntime: health.installed === true, checkedAt: now(), error: ok ? null : health.error || (!lifecycleReady ? 'This deployment Hermes execution scope is stopped.' : 'NousResearch Hermes CLI is unavailable.') };
  }
  async cancel(bot, requestId) { return { ...cancelHermesCli(requestId), executionScopeId: bot?.executionScopeId || null }; }
  async clearMemory(bot) { return { ok: false, supported: false, executionScopeId: bot?.executionScopeId || null, reason: 'The installed Hermes CLI has not exposed a verified deployment-scoped memory-clear command.' }; }
}

export class ExternalHermesBotRuntime extends ReferenceHermesBotRuntime {
  constructor() { super({ runtimeVersion: 'external-provider' }); this.runtimeKind = 'external'; this.isReal = true; }
  async createBot(context = {}) {
    const deploymentId = context.deployment?.id || id('deployment');
    return { botId: '', providerBotId: '', executionScopeId: `deployment:${deploymentId}`, runtimeId: `external:${deploymentId}`, runtimeVersion: this.runtimeVersion, runtimeKind: this.runtimeKind, isReal: true, status: 'provisioned', createdAt: now(), startedAt: null, stoppedAt: null, lastHealthCheckAt: null, lastError: null, deploymentId, projectId: context.project?.id || null, memoryNamespace: `deployment:${deploymentId}` };
  }
  async health(bot) {
    const hasIdentity = Boolean(bot?.providerBotId || bot?.executionScopeId || bot?.runtimeId);
    const lifecycleReady = ['running', 'provisioned'].includes(bot?.status);
    const ok = hasIdentity && lifecycleReady;
    return { ok, status: ok ? 'healthy' : 'unhealthy', botId: bot?.providerBotId || null, executionScopeId: bot?.executionScopeId || null, runtimeId: bot?.runtimeId || null, runtimeVersion: bot?.runtimeVersion || this.runtimeVersion, runtimeKind: this.runtimeKind, realHermesRuntime: true, checkedAt: now(), error: ok ? null : !hasIdentity ? 'The external Hermes deployment has no execution scope.' : 'The external Hermes execution scope is stopped.' };
  }
}

// Backward-compatible export for existing integrations/tests. New code should
// use the explicit ReferenceHermesBotRuntime name.
export const LocalHermesBotRuntime = ReferenceHermesBotRuntime;
const configuredRuntimeKind = String(process.env.HERMES_AGENT_MIDDLEWARE_RUNTIME_KIND || 'reference').trim().toLowerCase();
export const hermesBotRuntime = configuredRuntimeKind === 'local-cli' ? new LocalCliHermesBotRuntime() : configuredRuntimeKind === 'external' ? new ExternalHermesBotRuntime() : new ReferenceHermesBotRuntime();

export function normalizeHermesBot(bot = {}) {
  return { botId: String(bot.botId || ''), providerBotId: String(bot.providerBotId || bot.botId || ''), executionScopeId: String(bot.executionScopeId || ''), runtimeId: String(bot.runtimeId || ''), runtimeVersion: String(bot.runtimeVersion || 'reference-1'), runtimeKind: String(bot.runtimeKind || 'reference'), isReal: bot.isReal === true, status: String(bot.status || 'provisioned'), profile: String(bot.profile || ''), timeoutSeconds: Number(bot.timeoutSeconds || 90), maxSteps: Number(bot.maxSteps || 8), memoryNamespace: String(bot.memoryNamespace || ''), createdAt: bot.createdAt || null, startedAt: bot.startedAt || null, stoppedAt: bot.stoppedAt || null, lastHealthCheckAt: bot.lastHealthCheckAt || null, lastError: bot.lastError || null, skillSync: bot.skillSync || null };
}
