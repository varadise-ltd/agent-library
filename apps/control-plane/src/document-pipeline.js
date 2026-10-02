import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const normalized = value => String(value || '').toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ').trim();
const genericTemplateTerms = new Set(['template', 'document', 'report', 'form', 'safety', '範本', '模板', '文件', '報告', '报告', '表格', '表單']);
const templateTerms = template => [...new Set(normalized(`${template.templateName || template.description || ''} ${template.name}`).split(' ').filter(term => term.length >= 4 && !genericTemplateTerms.has(term)))];
const templateNegated = (request, key) => key && (request.includes(`not ${key}`) || request.includes(`not the ${key}`) || request.includes(`do not use ${key}`) || request.includes(`dont use ${key}`) || request.includes(`不要用 ${key}`) || request.includes(`唔好用 ${key}`));

function namedTemplate(templates, content) {
  const request = normalized(content);
  if (!request) return null;
  const keyed = templates.find(template => {
    const key = normalized(template.templateName || template.description || '');
    return key.length >= 2 && (request === key || request.includes(key)) && !templateNegated(request, key);
  });
  if (keyed) return keyed;
  const exact = templates.find(template => {
    const name = normalized(template.name);
    return name.length >= 5 && request.includes(name) && !templateNegated(request, name);
  });
  if (exact) return exact;
  const distinctive = templates.map(template => {
    const terms = templateTerms(template);
    const uniqueTerms = terms.filter(term => !templates.some(other => other !== template && templateTerms(other).includes(term)));
    return { template, matched: uniqueTerms.filter(term => request.includes(term) && !templateNegated(request, term)) };
  }).filter(candidate => candidate.matched.length).sort((left, right) => right.matched.length - left.matched.length || Math.max(...right.matched.map(term => term.length)) - Math.max(...left.matched.map(term => term.length)));
  if (distinctive.length && (!distinctive[1] || distinctive[0].matched.length > distinctive[1].matched.length)) return distinctive[0].template;
  if (distinctive.length === 1) return distinctive[0].template;
  const described = templates.map(template => {
    const terms = templateTerms(template);
    const matched = [...new Set(terms)].filter(term => request.includes(term) && !templateNegated(request, term));
    return { template, score: matched.length, coverage: terms.length ? matched.length / new Set(terms).size : 0 };
  }).filter(candidate => candidate.score >= 2 && candidate.coverage >= 0.45).sort((left, right) => right.score - left.score || right.coverage - left.coverage);
  if (!described.length) return null;
  if (described[1] && described[0].score === described[1].score && described[0].coverage === described[1].coverage) return null;
  return described[0].template;
}

export function documentTemplateSelection(templates, requestedFormat, content = '', explicitTemplateId = '', recentUserMessages = []) {
  const available = Array.isArray(templates) ? templates.filter(template => ['docx', 'pdf'].includes(template.templateFormat)) : [];
  const explicit = explicitTemplateId && available.find(template => template.id === explicitTemplateId);
  if (explicit) return { template: explicit, source: 'explicit' };
  if (explicitTemplateId) return { template: null, source: 'invalid-explicit', issue: 'The selected document template is no longer available.' };
  const mentioned = namedTemplate(available, content);
  if (mentioned && (mentioned.templateFormat === requestedFormat || requestedFormat === 'pdf' && mentioned.templateFormat === 'docx')) return { template: mentioned, source: 'current-message' };
  const matching = available.filter(template => template.templateFormat === requestedFormat);
  if (requestedFormat === 'pdf') {
    const docx = available.filter(template => template.templateFormat === 'docx');
    const candidates = docx.length ? docx : matching;
    if (candidates.length) return { template: null, source: 'confirmation-required', candidates, issue: 'Please confirm which report template to use before I generate the PDF.' };
    return { template: null, source: 'none' };
  }
  if (matching.length) return { template: null, source: 'confirmation-required', candidates: matching, issue: `Please confirm which ${String(requestedFormat).toUpperCase()} report template to use before I generate the document.` };
  return { template: null, source: 'none' };
}

export function normalizedPendingTemplateWorkflow(templates, workflow) {
  if (!workflow || typeof workflow !== 'object') return workflow;
  const availableIds = new Set((Array.isArray(templates) ? templates : [])
    .filter(template => template && template.documentType === 'template' && ['docx', 'pdf'].includes(template.templateFormat))
    .map(template => template.id));
  const candidateTemplateIds = [...new Set((Array.isArray(workflow.candidateTemplateIds) ? workflow.candidateTemplateIds : [])
    .map(String)
    .filter(id => availableIds.has(id)))];
  const confirmedTemplateId = availableIds.has(String(workflow.confirmedTemplateId || '')) ? String(workflow.confirmedTemplateId) : null;
  return { ...workflow, candidateTemplateIds, confirmedTemplateId };
}

export function selectDocumentTemplate(templates, requestedFormat, content = '', explicitTemplateId = '', recentUserMessages = []) {
  return documentTemplateSelection(templates, requestedFormat, content, explicitTemplateId, recentUserMessages).template;
}

export function parseStructuredTemplateContent(value) {
  const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!source) return null;

  // Providers occasionally add a short preface, a trailing explanation, or
  // wrap the JSON in a markdown fence despite the template contract. Find a
  // complete JSON object instead of silently downgrading the response to
  // free-form prose (which cannot be mapped back to template fields).
  const candidates = [];
  if (source.startsWith('{')) candidates.push(source);
  for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') { quoted = true; continue; }
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) { candidates.push(source.slice(start, index + 1)); break; }
        if (depth < 0) break;
      }
    }
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* Try the next balanced object. */ }
  }
  return null;
}

export function structuredTemplateContent(value) {
  const parsed = parseStructuredTemplateContent(value);
  if (!parsed) return String(value || '');
  const lines = [];
  if (parsed.title) lines.push(`# ${String(parsed.title).trim()}`, '');
  for (const [label, fieldValue] of Object.entries(parsed.fields || {})) {
    const rendered = Array.isArray(fieldValue) ? fieldValue.join(', ') : fieldValue;
    lines.push(`**${label}:** ${rendered === null || rendered === undefined || rendered === '' ? 'Not provided' : String(rendered)}`);
  }
  for (const [tableName, rows] of Object.entries(parsed.tables || {})) {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') continue;
    const headers = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
    if (!headers.length) continue;
    lines.push('', `## ${tableName}`, `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const row of rows) lines.push(`| ${headers.map(header => String(row?.[header] ?? 'Not provided').replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  const sections = Array.isArray(parsed.sections) ? parsed.sections : Object.entries(parsed.sections || {}).map(([title, content]) => ({ title, content }));
  for (const section of sections) {
    if (!section || typeof section !== 'object' || !section.title) continue;
    lines.push('', `## ${section.title}`, String(section.content || 'Not provided'));
  }
  if (Array.isArray(parsed.unknownFields) && parsed.unknownFields.length) lines.push('', '## Information not provided', ...parsed.unknownFields.map(field => `- ${field}`));
  return lines.join('\n').trim() || String(value || '');
}

const converterCandidates = configured => {
  const value = String(configured || 'soffice').trim() || 'soffice';
  const candidates = [value];
  if (/^(?:soffice|libreoffice)(?:\.exe)?$/i.test(value)) {
    candidates.push(
      '/usr/bin/soffice',
      '/usr/local/bin/soffice',
      '/snap/bin/libreoffice',
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
    );
  }
  return [...new Set(candidates)];
};

function executableAvailable(candidate) {
  if (path.isAbsolute(candidate)) return fs.existsSync(candidate);
  try { return spawnSync(candidate, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5_000 }).status === 0; }
  catch { return false; }
}

export function resolveDocumentConverterExecutable(configured = 'soffice') {
  return converterCandidates(configured).find(executableAvailable) || String(configured || 'soffice').trim() || 'soffice';
}

export function documentConverterHealth(configured = 'soffice') {
  const executable = resolveDocumentConverterExecutable(configured);
  return { configured: String(configured || 'soffice').trim() || 'soffice', executable, available: executableAvailable(executable) };
}

export async function convertDocxToPdf(docxBytes, { executable = 'soffice', runtimeDir, timeoutMs = 120_000 } = {}) {
  const jobsRoot = path.resolve(runtimeDir || process.cwd(), 'document-jobs');
  fs.mkdirSync(jobsRoot, { recursive: true, mode: 0o700 });
  const jobDir = fs.mkdtempSync(path.join(jobsRoot, 'docx-pdf-'));
  const inputPath = path.join(jobDir, 'completed-template.docx');
  const outputPath = path.join(jobDir, 'completed-template.pdf');
  const profilePath = path.join(jobDir, 'libreoffice-profile').replace(/\\/g, '/');
  fs.writeFileSync(inputPath, docxBytes, { mode: 0o600 });
  try {
    const result = await new Promise((resolve, reject) => {
      const resolvedExecutable = resolveDocumentConverterExecutable(executable);
      const child = spawn(resolvedExecutable, ['--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard', `-env:UserInstallation=file:///${profilePath.replace(/^\//, '')}`, '--convert-to', 'pdf:writer_pdf_Export', '--outdir', jobDir, inputPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', settled = false;
      const finish = (error, code = null) => { if (settled) return; settled = true; clearTimeout(timeout); error ? reject(error) : resolve({ code, stdout, stderr }); };
      const timeout = setTimeout(() => { child.kill(); finish(Object.assign(new Error('DOCX-to-PDF conversion timed out.'), { status: 504, troubleshooting: { category: 'conversion-timeout' } })); }, timeoutMs);
      child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-2000); });
      child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2000); });
      child.once('error', cause => finish(Object.assign(new Error(`LibreOffice could not start: ${cause.message}`), { status: 503, troubleshooting: { category: 'conversion-runtime' } })));
      child.once('close', code => finish(null, code));
    });
    if (result.code !== 0 || !fs.existsSync(outputPath)) throw Object.assign(new Error(`LibreOffice could not convert the completed DOCX template${result.stderr.trim() ? `: ${result.stderr.trim().slice(-240)}` : '.'}`), { status: 422, troubleshooting: { category: 'conversion' } });
    const output = fs.readFileSync(outputPath);
    if (output.subarray(0, 4).toString() !== '%PDF') throw Object.assign(new Error('LibreOffice returned an invalid PDF file.'), { status: 422, troubleshooting: { category: 'conversion' } });
    return output;
  } finally { fs.rmSync(jobDir, { recursive: true, force: true }); }
}
