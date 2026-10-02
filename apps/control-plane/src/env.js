import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnvFile();
const projectSourceRoots = String(process.env.PROJECT_SOURCE_ROOTS || path.resolve(process.cwd(), 'project-sources'))
  .split(';')
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => path.resolve(value));
export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(process.cwd(), process.env.DATA_DIR || 'data'),
  runtimeDir: path.resolve(process.cwd(), process.env.RUNTIME_DIR || 'runtime-data'),
  projectSourceRoots,
  runtimeEnvironment: String(process.env.VARADISE_RUNTIME_ENVIRONMENT || (fs.existsSync('/.dockerenv') ? 'docker' : 'local')).trim().toLowerCase(),
  dataBackend: String(process.env.DATA_BACKEND || (process.env.DATABASE_URL ? 'postgres' : 'json')).trim().toLowerCase(),
  databaseUrl: String(process.env.DATABASE_URL || '').trim(),
  databaseSchema: String(process.env.DATABASE_SCHEMA || 'varadise').trim(),
  databaseSsl: String(process.env.DATABASE_SSL || 'disable').trim().toLowerCase(),
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 10),
  databaseConnectTimeoutMs: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
  pdfFontPath: process.env.VARADISE_PDF_FONT ? path.resolve(process.env.VARADISE_PDF_FONT) : '',
  pdfFontFamily: process.env.VARADISE_PDF_FONT_FAMILY || '',
  libreOfficePath: String(process.env.LIBREOFFICE_PATH || 'soffice').trim(),
  documentConversionTimeoutMs: Number(process.env.DOCUMENT_CONVERSION_TIMEOUT_MS || 120_000),
  hermesNodePath: path.resolve(process.env.HERMES_WHATSAPP_NODE || process.execPath),
  hermesPairScript: path.resolve(process.env.HERMES_WHATSAPP_PAIR_SCRIPT || process.env.HERMES_WHATSAPP_BRIDGE_SCRIPT || 'apps/control-plane/src/whatsapp-pair.mjs'),
  hermesProjectBridgeScript: path.resolve(process.env.HERMES_WHATSAPP_PROJECT_BRIDGE_SCRIPT || 'apps/control-plane/src/project-whatsapp-bridge.mjs'),
  hermesManagedPort: Number(process.env.HERMES_WHATSAPP_MANAGED_PORT || 3001),
  hermesAgentMiddlewarePort: Number(process.env.HERMES_AGENT_MIDDLEWARE_PORT || 3010),
  hermesAgentMiddlewareUrl: String(process.env.HERMES_AGENT_MIDDLEWARE_URL || `http://127.0.0.1:${Number(process.env.HERMES_AGENT_MIDDLEWARE_PORT || 3010)}/execute`).trim(),
  appSecret: process.env.APP_SECRET || 'local-development-secret-change-me',
  adminEmail: process.env.VARADISE_ADMIN_EMAIL || 'admin@varadise.com',
  adminPassword: process.env.VARADISE_ADMIN_PASSWORD || 'change-me-before-sharing'
};
