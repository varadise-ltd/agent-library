import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const node = process.execPath;
const startMiddleware = () => spawn(node, ['apps/control-plane/src/hermes-agent-middleware.mjs'], { stdio: 'inherit', env: process.env });
// Node's --watch mode is useful for a bind-mounted development checkout, but
// it is unsafe as the default in the production container: Docker volume
// events and package-manager metadata changes can restart the HTTP process
// while the container is otherwise healthy. The explicit file polling below
// remains available for development, so production runs a stable child.
const watchPlatform = String(process.env.VARADISE_DEV_WATCH || '').trim().toLowerCase() === 'true';
const startPlatform = () => spawn(node, [...(watchPlatform ? ['--watch', '--watch-preserve-output'] : []), 'apps/control-plane/src/server.js'], { stdio: 'inherit', env: process.env });
let middleware = startMiddleware();
let platform = startPlatform();
let stopping = false, restartingMiddleware = false, restartingPlatform = false;
const restartPolicy = Object.freeze({ maxAttempts: 5, windowMs: 60_000, baseDelayMs: 1_000, maxDelayMs: 15_000 });
const restartState = {
  middleware: { attempts: 0, windowStartedAt: Date.now(), timer: null },
  platform: { attempts: 0, windowStartedAt: Date.now(), timer: null }
};
const resetRestartBudgetAfterStableRun = (kind, child) => {
  const state = restartState[kind];
  setTimeout(() => {
    if (stopping || (kind === 'middleware' ? middleware : platform) !== child) return;
    state.attempts = 0;
    state.windowStartedAt = Date.now();
  }, restartPolicy.windowMs).unref?.();
};
const scheduleUnexpectedRestart = (kind, exitCode) => {
  const state = restartState[kind];
  const now = Date.now();
  if (now - state.windowStartedAt >= restartPolicy.windowMs) {
    state.attempts = 0;
    state.windowStartedAt = now;
  }
  if (state.attempts >= restartPolicy.maxAttempts) {
    const message = `${kind} process exited repeatedly (last code ${exitCode ?? 'unknown'}); restart budget exhausted for this minute.`;
    console.error(message);
    if (kind === 'middleware' && process.env.HERMES_AGENT_MIDDLEWARE_REQUIRED === 'true') {
      platform.kill('SIGTERM');
      process.exit(1);
    }
    return;
  }
  state.attempts += 1;
  const delay = Math.min(restartPolicy.maxDelayMs, restartPolicy.baseDelayMs * (2 ** (state.attempts - 1)));
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (stopping) return;
    if (kind === 'middleware') {
      middleware = startMiddleware();
      bindMiddlewareExit(middleware);
      resetRestartBudgetAfterStableRun('middleware', middleware);
    } else {
      platform = startPlatform();
      bindPlatformExit(platform);
      resetRestartBudgetAfterStableRun('platform', platform);
    }
  }, delay);
  state.timer.unref?.();
  console.error(`${kind} process exited (code ${exitCode ?? 'unknown'}); restarting in ${delay} ms (attempt ${state.attempts}/${restartPolicy.maxAttempts}).`);
};
const stop = () => { if (stopping) return; stopping = true; middleware.kill('SIGTERM'); platform.kill('SIGTERM'); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
function bindPlatformExit(child) { child.on('exit', code => {
  if (stopping) return;
  if (restartingPlatform) { restartingPlatform = false; platform = startPlatform(); bindPlatformExit(platform); return; }
  scheduleUnexpectedRestart('platform', code);
}); }
function bindMiddlewareExit(child) { child.on('exit', code => {
  if (stopping) return;
  if (restartingMiddleware) { restartingMiddleware = false; middleware = startMiddleware(); bindMiddlewareExit(middleware); return; }
  scheduleUnexpectedRestart('middleware', code);
}); }
bindPlatformExit(platform);
bindMiddlewareExit(middleware);
resetRestartBudgetAfterStableRun('platform', platform);
resetRestartBudgetAfterStableRun('middleware', middleware);

// Docker Desktop bind mounts do not consistently emit inotify events. Poll
// the runtime source files only in the explicit development mode so a
// production bind mount cannot unexpectedly restart a healthy service.
for (const file of (watchPlatform ? [
  ['apps/control-plane/src/hermes-agent-middleware.mjs', 'middleware'],
  ['apps/control-plane/src/hermes-cli-adapter.mjs', 'middleware'],
  ['apps/control-plane/src/server.js', 'platform'],
  ['apps/control-plane/src/document-pipeline.js', 'platform'],
  ['apps/control-plane/src/agent-execution.mjs', 'platform']
] : []).map(([value, owner]) => ({ path: path.resolve(value), owner }))) {
  fs.watchFile(file.path, { interval: 750 }, (current, previous) => {
    if (stopping || current.mtimeMs === previous.mtimeMs) return;
    if (file.owner === 'middleware') {
      if (restartingMiddleware) return;
      restartingMiddleware = true;
      clearTimeout(restartState.middleware.timer);
      restartState.middleware.timer = null;
      middleware.kill('SIGTERM');
    } else {
      if (restartingPlatform) return;
      restartingPlatform = true;
      clearTimeout(restartState.platform.timer);
      restartState.platform.timer = null;
      platform.kill('SIGTERM');
    }
  });
}
