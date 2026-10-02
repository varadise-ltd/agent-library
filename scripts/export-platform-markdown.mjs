import fs from 'node:fs';
import path from 'node:path';
import { generatePlatformMarkdown, PLATFORM_EXPORT_ROOT } from '../apps/control-plane/src/platform-markdown-export.mjs';

const help = `Export the platform's starter specification as Markdown.

Usage:
  node scripts/export-platform-markdown.mjs --output <file|-> [options]

Options:
  --output <file|->       Write a new file, or use - for standard output.
  --repository-root <dir> Read public asset metadata from this source tree.
  --generated-at <ISO>    Set the generation timestamp (default: current time).
  --input <json>          Read options JSON containing only repositoryRoot and
                         generatedAt. Command-line options take precedence.
  --help, -h             Show this help.

Paths are resolved from the current working directory. Existing output files
are never overwritten. The default repository root is this script's project.
The exporter uses the built-in starter catalog. It does not read .env, connect
to a database, or export live projects, credentials, sessions, or user data.
--input is an options file, not a database or application-state snapshot.
`;

function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(help);
    return;
  }
  const flags = new Map();
  const allowed = new Set(['--output', '--repository-root', '--generated-at', '--input']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (flags.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    flags.set(flag, value);
  }
  if (!flags.has('--output')) throw new Error('Specify --output <file|->. Use --help for usage.');

  let options = {};
  if (flags.has('--input')) {
    const input = fs.readFileSync(path.resolve(flags.get('--input')), 'utf8');
    try { options = JSON.parse(input); }
    catch { throw new Error('Input must be valid JSON.'); }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Input must be a JSON object containing exporter options.');
    }
    if (Object.keys(options).some(key => !['repositoryRoot', 'generatedAt'].includes(key))) {
      throw new Error('Input supports only repositoryRoot and generatedAt; application data is not accepted.');
    }
  }
  const root = flags.get('--repository-root') ?? options.repositoryRoot ?? PLATFORM_EXPORT_ROOT;
  const timestamp = flags.get('--generated-at') ?? options.generatedAt ?? new Date().toISOString();
  if (typeof root !== 'string' || !root.trim()) throw new Error('repositoryRoot must be a directory path.');
  const repositoryRoot = path.resolve(root);
  if (!fs.statSync(repositoryRoot).isDirectory()) throw new Error('repositoryRoot must be a directory.');
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error('generatedAt must be an ISO 8601 date-time with a timezone.');
  }
  const markdown = generatePlatformMarkdown({ repositoryRoot, generatedAt: new Date(timestamp).toISOString() });
  const output = flags.get('--output');
  if (output === '-') process.stdout.write(markdown);
  else fs.writeFileSync(path.resolve(output), markdown, { encoding: 'utf8', flag: 'wx' });
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Markdown export failed: ${error.message}\n`);
  process.exitCode = 1;
}
