const now = () => new Date().toISOString();
const id = (prefix, name) => `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const component = (type, name, description, content) => ({ id: id('cmp', name), type, name, description, tags: ['construction starter'], status: 'active', createdAt: now(), updatedAt: now(), draft: { revision: 1, nextVersion: '1.0.1', content }, versions: [{ id: `${id('cmp', name)}-v1`, version: '1.0.0', status: 'published', publishedAt: now(), content }] });

export const reportControlComponents = [
  component('skill', 'Controlled template report generation', 'Generate evidence-led reports through a confirmed template and exact field contract.', {
    objective: 'Produce a complete report in the exact end-user-confirmed document template without changing fixed layout content.',
    triggers: 'Requests to create, generate, complete, export or attach a DOCX or PDF report.',
    inputs: 'Confirmed template, active element definitions, current user request, permitted conversation context, approved project evidence and deterministic project metadata.',
    instructions: '1. Confirm the template when more than one compatible layout exists.\n2. Extract attributable facts into the exact active template fields.\n3. Use every relevant fact for narrative fields such as Description, Root Cause, Corrective Action and Preventive Action.\n4. Preserve templateLabel values exactly.\n5. Leave unsupported facts blank or use the configured missing-value rule.\n6. Return structured field JSON only; the platform renders and validates the file.',
    evidence: 'Use only the current project, its approved files, the current request and retained project conversation. Identify reported or preliminary information and never invent missing findings, approvals or signatures.',
    output: 'Exact template fields, tables and unknownFields in the platform structured report contract.',
    guardrails: 'Never alter fixed labels, fill protected left-hand cells, append generic prose outside the template, mix projects, invent evidence or claim attachment before platform completion.',
    escalation: 'Stop issuance when a required field is missing, a project mismatch is unresolved, or a safety, statutory, engineering, approval or privacy decision requires a responsible professional.',
    exampleInput: 'Generate the confirmed Investigation Report Template in DOCX using today’s verified incident information.',
    exampleOutput: 'Structured exact-label fields with detailed Section B content, missing facts identified and no layout commentary.'
  }),
  component('tool', 'Structured report evidence extractor', 'Normalize report facts and preserve their evidence status before document filling.', {
    objective: 'Convert permitted request, conversation and project evidence into a field-addressable evidence record.',
    triggers: 'Before any template-based DOCX or PDF generation.',
    inputs: 'User request, retained conversation, approved project excerpts, images and deterministic metadata.',
    instructions: 'Extract dates, times, locations, people or roles, event chronology, outcomes, causes, actions, recommendations, references and unknown facts. Keep reported, verified, inferred and missing facts distinct.',
    evidence: 'Retain the originating source category and never elevate WhatsApp claims to independently verified evidence.',
    output: 'A structured evidence map keyed by exact template field plus unknownFields.',
    guardrails: 'Do not search outside permitted project boundaries or infer approvals, signatures, causes or personal data.',
    escalation: 'Flag project mismatch, contradictory evidence, missing required fields and high-risk unresolved facts.',
    exampleInput: 'Extract the evidence needed for Section B.',
    exampleOutput: 'Description, Root Cause, Corrective Action and Preventive Action evidence with source status.'
  }),
  component('tool', 'Deterministic template field mapper', 'Map exact structured values to configured DOCX cells or PDF regions.', {
    objective: 'Place each generated value only in its owner-approved template target.',
    triggers: 'After structured evidence generation and before document rendering.',
    inputs: 'Active template definition, exact-label field values, deterministic source paths and configured layout regions.',
    instructions: 'Resolve deterministic metadata first, then exact templateLabel matches, then conservative owner-label matches. Protect fixed cells and use only value regions or safe narrative cells.',
    evidence: 'Mapping does not create facts; it places only supplied or deterministic values.',
    output: 'A field mapping record containing element id, template label, value status, source type and render target.',
    guardrails: 'Never write into protected regions, left-hand label cells, signatures without authorization, or outside the original template layout.',
    escalation: 'Reject generation when no active field matches or a required target is unavailable.',
    exampleInput: 'Map Organization Name and the four Section B narratives.',
    exampleOutput: 'Organization metadata plus four exact Section B target mappings.'
  }),
  component('tool', 'Report output validator', 'Block incomplete or incorrectly mapped reports before delivery.', {
    objective: 'Verify the selected template, field coverage, required values, narrative detail and protected layout rules before attachment.',
    triggers: 'Immediately before DOCX/PDF rendering and WhatsApp or Agent Chat delivery.',
    inputs: 'Confirmed template revision, structured evidence, mapping record, image targets and generated artifact metadata.',
    instructions: 'Check template identity, exact-label mappings, required fields, detailed narrative coverage, deterministic organization/project values, protected labels, image placement, signature rules, unknown fields and render pipeline.',
    evidence: 'Validation reports observed field state and must not fabricate a pass.',
    output: 'Pass, passed-with-warnings or failed with checks, field-level issues and verification timestamp.',
    guardrails: 'A failed validation must prevent attachment. Warnings remain visible on the generated document record.',
    escalation: 'Require administrator correction when a required field, target region or template definition is missing.',
    exampleInput: 'Validate the completed Investigation Report before WhatsApp delivery.',
    exampleOutput: 'Passed with exact field count, missing optional fields and narrative-detail warnings.'
  })
];

const components = [
  component('persona', 'Construction project professional', 'Professional, evidence-led and calm under site pressure.', { tone: 'Professional and clear', rules: 'Cite approved sources, identify uncertainty, never invent project facts.' }),
  component('permission_profile', 'Autonomous project permissions', 'Project-scoped actions with careful escalation.', { posture: 'Autonomous', capabilities: ['Read approved project context', 'Prepare drafts', 'Escalate urgent risks'] }),
  component('folder_blueprint', 'Project background and locked notes', 'A shared project background plus private agent notes.', { shared: ['background', 'approved-documents'], private: ['locked-notes'] }),
  component('tool', 'Project-document search', 'Search approved project documents only.', { scope: 'Project approved documents', connector: 'None required' }),
  component('cron_job', 'Weekly project digest', 'A weekly summary of risks, progress and decisions.', { frequency: 'Weekly', action: 'Prepare project digest' }),
  component('heartbeat', '15-minute runtime health', 'Checks the running agent and WhatsApp session.', { interval: '15 minutes', check: 'Runtime and pairing health' }),
  ...reportControlComponents,
  ...[['RFI coordination', 'Draft, track and clarify construction questions.'], ['Document control', 'Find current approved records and revisions.'], ['HSE safety', 'Support site observations and urgently escalate hazards.'], ['Progress planning', 'Track daily progress, blockers and look-ahead plans.'], ['Quality inspection', 'Track inspections, defects and corrective action.'], ['Commercial support', 'Summarise variations, quantities and commercial matters.']].map(([name, description]) => component('skill', name, description, { workflow: description, escalation: 'Escalate unclear or high-risk decisions.' }))
];

const experts = [
  ['Sally', 'HSE / safety lead', 'Site observations, toolbox talks, safety guidance, and urgent hazard escalation', 'HSE safety', '🦺', '#f6c85f'],
  ['Promax', 'Progress planner', 'Daily progress, blockers, and look-ahead planning', 'Progress planning', '📐', '#8fb9ff'],
  ['Dora', 'Document controller', 'Current revisions, approved records, and document reference support', 'Document control', '🗂️', '#b9a4ff'],
  ['Rafi', 'RFI coordinator', 'Construction question/RFI drafting, tracking, and decision support', 'RFI coordination', '📋', '#72d6bb'],
  ['Quinn', 'Quality inspector', 'Inspections, defects, and corrective-action tracking', 'Quality inspection', '🔎', '#ff9c8a'],
  ['Costy', 'Commercial assistant', 'Variations, quantities, and commercial summary support', 'Commercial support', '📊', '#ef9ac0']
].map(([name, specialty, description, skill, icon, color]) => {
  const refs = ['Construction project professional', skill, 'Project-document search', 'Autonomous project permissions', 'Project background and locked notes', 'Weekly project digest', '15-minute runtime health'].map(name => {
    const c = components.find(item => item.name === name); return { componentId: c.id, versionId: c.versions[0].id };
  });
  const stableId = id('exp', name);
  const draft = { revision: 1, nextVersion: '1.0.1', description, tags: ['construction starter', specialty], componentRefs: refs, instructions: `Support the project as ${name}. Use approved context, state uncertainty and escalate urgent safety risks.`, router: { mode: 'project' }, folderBlueprint: { shared: ['background', 'approved-documents'], private: ['locked-notes'] } };
  return { id: stableId, name, specialty, icon, color, description, tags: draft.tags, status: 'active', createdAt: now(), updatedAt: now(), draft, versions: [{ id: `${stableId}-v1`, version: '1.0.0', status: 'published', publishedAt: now(), ...structuredClone(draft) }] };
});

export const seed = () => ({ users: [], components, experts, organizations: [], projects: [], deployments: [], groups: [], connectors: [], documents: [], documentFolders: [], exports: [], chatMessages: [], whatsappSessions: [], whatsappInboundMessages: [], whatsappGroupContextMessages: [], componentRuns: [], agentExecutions: [], agentManifests: [], messageEvents: [], runSteps: [], toolCalls: [], approvals: [], artifacts: [], artifactValidationResults: [], deliveries: [], coachingProposals: [], behaviourLessons: [], connectorConfigs: [], auditEvents: [], audit: [{ id: 'audit-seed', at: now(), actor: 'Varadise', action: 'Library seeded', subject: 'Six construction specialists', context: 'Local pilot initialised' }], settings: { modelName: 'GPT-5', vision: true, imageCreation: true, webResearch: true, serviceUrl: '', apiKey: '', hermesMiddleware: { connectorId: '', name: '', endpoint: '', profile: '', timeoutSeconds: 90, enabled: false, apiKeyEncrypted: '', model: { modelName: '', serviceUrl: '', timeoutSeconds: 180, apiKeyEncrypted: '' } } } });
