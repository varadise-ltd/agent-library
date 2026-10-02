# Varadise Agent Platform — Complete Replication Guide

Version: 1.0<br>
Reference implementation date: 7 August 2026<br>
Target runtime: Node.js 18 or newer<br>
Reference URL: http://localhost:3000

## 1. Purpose and fidelity contract

This document is the single build specification for reproducing the Varadise Agent Platform contained in this repository. A conforming implementation must reproduce the same:

- information architecture, screens, visual language, and responsive behavior;
- authentication, user administration, roles, permissions, project and agent scopes;
- expert and component draft/version workflows;
- project, deployment, file, connector, audit, and model-setting workflows;
- per-user, per-project, per-agent chat history and document grounding;
- streamed multi-file uploads, named-agent visibility, deletion, visibility changes, and downloads;
- real OpenAI-compatible model calls when configured, with explicit local simulation only when no model is configured;
- generated DOCX, PDF, and image artifacts stored back into Project Files;
- persistence layout, security rules, API contracts, seed data, tests, and error behavior.

“100% replication” here means behavioral and visual parity with the checked-in reference implementation. In the reference:

- model chat is real when an OpenAI-compatible endpoint is configured;
- WhatsApp project connection, group validation, and outbound messaging use one isolated loopback-only Hermes session and bridge per paired project;
- connector testing is a clearly labelled simulation;
- deployment start/stop/provisioning is local control-plane state and runtime manifests, not a Docker or Hermes deployment.

A clone that reports model, connector, or deployment simulations as live connections is not conforming. WhatsApp must report unavailable unless Hermes health is genuinely connected.

## 2. Product definition

Varadise is a coordinator-first construction intelligence Agent Platform. Administrators assemble versioned construction experts from reusable components, deploy exact expert editions to protected projects, give users scoped access, upload approved or expert-private project documents, and talk to each deployed specialist through a grounded web chat.

The six starter specialists are:

| Expert | Role | Core responsibility |
|---|---|---|
| Sally | HSE / safety lead | Site observations, toolbox talks, safety guidance, and urgent hazard escalation |
| Promax | Progress planner | Daily progress, blockers, and look-ahead planning |
| Dora | Document controller | Current revisions, approved records, and document reference support |
| Rafi | RFI coordinator | Construction question and RFI drafting, tracking, and decision support |
| Quinn | Quality inspector | Inspections, defects, and corrective-action tracking |
| Costy | Commercial assistant | Variations, quantities, and commercial summary support |

Every expert card includes a distinct illustrated Chinese construction-worker portrait, specialist label, edition, description, tags, active placement count, profile action, and deployment action.

## 3. Technology and dependency lock

Use a single Node.js application with no frontend build step. The server uses Node core HTTP APIs and serves a static HTML/CSS/JavaScript client.

Create this package manifest:

~~~json
{
  "name": "varadise-agent-platform",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node apps/control-plane/src/server.js",
    "test": "node --test apps/control-plane/test/*.test.js"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "busboy": "1.6.0",
    "docx": "9.5.1",
    "pdf-parse": "1.1.1",
    "pdfkit": "0.17.2",
    "pg": "8.16.3",
    "qrcode": "^1.5.4"
  },
  "devDependencies": {
    "pg-mem": "3.0.14"
  }
}
~~~

Dependency responsibilities:

| Package | Responsibility |
|---|---|
| busboy | Stream multipart uploads directly to disk without buffering the whole file |
| docx | Generate Word artifacts from chat |
| pdf-parse | Extract PDF text for agent grounding |
| pdfkit | Generate PDF artifacts from chat |
| pg | PostgreSQL connection pooling and transactional persistence |
| pg-mem | In-memory PostgreSQL compatibility tests; development only |
| qrcode | Render the real linked-device token emitted by Hermes as a browser QR image |

For ESM compatibility, import the PDF parser from **pdf-parse/lib/pdf-parse.js** if the package root import fails.

## 4. Repository layout

Create this exact logical structure:

~~~text
.
├── .env.example
├── .gitignore
├── compose.yaml
├── package.json
├── pnpm-lock.yaml
├── README.md
├── VARADISE_AGENT_PLATFORM_COMPLETE_REPLICATION_GUIDE.md
├── apps/
│   └── control-plane/
│       ├── public/
│       │   ├── index.html
│       │   ├── styles.css
│       │   ├── app.js
│       │   └── assets/
│       │       ├── construction-project-desk.png
│       │       └── experts/
│       │           ├── sally.png
│       │           ├── promax.png
│       │           ├── dora.png
│       │           ├── rafi.png
│       │           ├── quinn.png
│       │           └── costy.png
│       ├── src/
│       │   ├── env.js
│       │   ├── security.js
│       │   ├── seed-library.js
│       │   ├── store.js
│       │   └── server.js
│       └── test/
│           ├── core.test.js
│           └── users.test.js
├── scripts/
│   └── migrate-to-postgres.mjs
├── data/                 # generated; never commit
│   ├── store.json        # legacy import/rollback copy; not active in PostgreSQL mode
│   └── uploads/
└── runtime-data/         # generated; never commit
~~~

Use this ignore file:

~~~gitignore
node_modules/
data/
runtime-data/
.env
.pnpm-store/
~~~

## 5. Configuration

Create **.env.example**:

~~~dotenv
PORT=3000
HOST=127.0.0.1
DATA_DIR=./data
RUNTIME_DIR=./runtime-data
DATA_BACKEND=postgres
POSTGRES_PASSWORD=replace-with-a-long-database-password
DATABASE_URL=postgresql://varadise:replace-with-a-long-database-password@127.0.0.1:5432/varadise
DATABASE_SCHEMA=varadise
DATABASE_SSL=disable
DATABASE_POOL_MAX=10
DATABASE_CONNECT_TIMEOUT_MS=10000
# First port in the per-project Hermes bridge range.
HERMES_WHATSAPP_MANAGED_PORT=3001
APP_SECRET=replace-with-a-long-random-value
VARADISE_ADMIN_EMAIL=admin@varadise.com
VARADISE_ADMIN_PASSWORD=replace-with-a-strong-admin-password
~~~

Rules:

1. Resolve relative data and runtime paths against the repository root.
2. Use PostgreSQL in production. Keep `DATA_BACKEND=json` only as a test or deliberate rollback option.
3. Keep the Compose PostgreSQL port on loopback. For a managed database, use TLS and the provider's required `DATABASE_SSL` mode.
4. Default the web port to 3000 and the host to **127.0.0.1** for local-only access.
5. To serve trusted computers on the LAN, set **HOST=0.0.0.0** in the ignored local **.env** file and allow inbound TCP 3000 only for the Private profile and LocalSubnet. If another local service already owns **127.0.0.1** on the same port, bind **HOST** to the machine’s specific Wi-Fi IPv4 address to avoid ambiguous Windows port routing. Never expose this pilot directly to the public internet.
6. Generate or provide a long random production **APP_SECRET**. Changing it makes previously encrypted API keys and connector credentials unreadable.
7. Seed the first administrator only when the user collection is empty.
8. Treat the example administrator password as bootstrap-only and require it to be changed before sharing or deployment.
9. Configure the model through the Model & Connectors screen, not by committing an API key.

## 6. Application architecture

~~~mermaid
flowchart LR
  B["Browser client<br/>HTML + CSS + JavaScript"] -->|JSON, multipart, cookies| S["Node Agent Platform server"]
  S --> A["Authentication and authorization"]
  S --> J["PostgreSQL transactional store"]
  S --> U["Streamed upload storage"]
  S --> R["Per-project runtime manifests"]
  S --> M["OpenAI-compatible model API"]
  S --> G["DOCX / PDF / SVG generators"]
  J --> D["platform_state + platform_records"]
  U --> F["data/uploads"]
  R --> P["runtime-data/project-id"]
  G --> F
~~~

The browser never receives password hashes, encrypted values, stored inline file content, or physical storage paths. Authorization is enforced on the server even if the frontend hides an action.

## 7. Persistence model

The logical Store contract contains these collections:

~~~json
{
  "users": [],
  "components": [],
  "experts": [],
  "organizations": [],
  "projects": [],
  "deployments": [],
  "groups": [],
  "connectors": [],
  "documents": [],
  "exports": [],
  "chatMessages": [],
  "audit": [],
  "settings": {}
}
~~~

PostgreSQL schema requirements:

- `schema_migrations` records applied schema versions;
- `platform_state` holds one scalar settings document, an optimistic revision, and migration metadata;
- `platform_records` holds one JSONB row per entity, keyed by collection and record ID, with a stable position for ordered lists;
- add B-tree expression indexes for project, deployment, group, creation time, and list order, plus a GIN JSONB index for flexible metadata queries;
- initialize and migrate the schema before accepting HTTP traffic;
- serialize writes through one application queue and commit each snapshot in a transaction on one checked-out PostgreSQL client;
- lock and compare the revision so a stale process cannot overwrite newer state;
- seed missing logical collections without deleting existing content;
- import `data/store.json` only when `platform_state` is empty, then retain the JSON file as a rollback copy without modifying it;
- prepend audit entries so the newest activity appears first;
- expose the existing create, list, find, save, and audit operations to keep route behavior compatible;
- preserve published editions as immutable snapshots.

Uploaded/generated file bytes, WhatsApp credentials, and runtime manifests remain on protected disk storage. Back up PostgreSQL with `pg_dump` and back up `data/uploads` plus `runtime-data` separately. The `/api/health` response must identify the active backend and report revision, pending writes, and persistence errors.

Every entity uses a readable type prefix plus a random UUID, for example **usr-...**, **cmp-...**, **exp-...**, **project-...**, **deploy-...**, and **doc-...**. Store all timestamps as ISO 8601 strings.

## 8. Security contract

### 8.1 Authentication

- Normalize email addresses by trimming and lowercasing.
- Reject malformed email addresses on login, creation, and edit.
- Hash passwords with Node **crypto.scrypt**, a unique random salt, and a timing-safe comparison.
- A password must contain at least eight characters, one uppercase letter, one lowercase letter, and one digit.
- Reject a self-service password change when the new password equals the current password.
- Store sessions only in server memory.
- Set this cookie after login:

~~~text
varadise_session=<random-token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
~~~

- Clear it on logout.
- Invalidate all other sessions when a user changes their own password.
- Invalidate all sessions when an administrator resets another user’s password or disables that user.
- Provide a login-page recovery path for lockout situations, but allow a recovery token to be issued only when the request originates from the host computer’s loopback interface. Make the token single-use, keep it in memory, expire it after 15 minutes, and invalidate all existing sessions when recovery completes. LAN users use the administrator reset in User Control instead.
- Restarting the server signs out every user because sessions are intentionally not persistent.

### 8.2 Secret encryption

Encrypt model API keys and connector credentials with AES-256-GCM. Derive the 32-byte encryption key from **APP_SECRET** using scrypt. Store an authenticated payload containing the initialization vector, authentication tag, and ciphertext. Never return the encrypted field to the browser.

### 8.3 Authorization

Retain the protected **Administrator** role. Administrators have all permissions and all project/agent access. Configurable non-administrator roles have:

~~~text
experts.manage
projects.manage
deployments.manage
files.manage
connectors.manage
agents.chat
activity.view
~~~

Each user record also contains:

- **role**: administrator or custom;
- **roleName**: display label for the configurable role;
- **permissions**: zero or more permission keys;
- **projectIds**: zero or more permitted project IDs;
- **agentIds**: zero or more permitted deployment IDs;
- **status**: active or disabled.

Access is the intersection of permission, project scope, and agent scope. A user with **agents.chat** cannot chat with a deployment outside their permitted projects or deployment IDs.

Administrative invariants:

- keep at least one active administrator;
- an administrator cannot remove their own administrator role;
- an administrator cannot disable their own account;
- only an administrator can list, create, edit, disable, or reset passwords for users;
- safe user responses omit **passwordHash**.

### 8.4 HTTP behavior

Only **GET /api/health** and **POST /api/auth/login** are public. All other API routes require a valid session. Return JSON errors in this form:

~~~json
{
  "error": "Human-readable explanation"
}
~~~

Use 400 for validation, 401 for missing/invalid authentication, 403 for insufficient access, 404 for missing resources/routes, 409 for duplicate or stale-revision conflicts, and 502 for a configured model service failure.

## 9. Domain contracts

### 9.1 User

~~~json
{
  "id": "usr-uuid",
  "name": "Project Reviewer",
  "email": "reviewer@example.com",
  "role": "custom",
  "roleName": "Project Reviewer",
  "permissions": ["agents.chat", "files.manage"],
  "projectIds": ["project-uuid"],
  "agentIds": ["deploy-uuid-a", "deploy-uuid-b"],
  "status": "active",
  "passwordHash": "server-only",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "lastLoginAt": null
}
~~~

### 9.2 Expert

~~~json
{
  "id": "exp-sally",
  "name": "Sally",
  "specialty": "HSE / safety lead",
  "description": "Site observations, toolbox talks, safety guidance, and urgent hazard escalation",
  "portrait": "/assets/experts/sally.png",
  "tags": ["construction starter", "HSE / safety lead"],
  "status": "active",
  "draft": {
    "revision": 1,
    "nextVersion": "1.0.0",
    "description": "...",
    "tags": [],
    "componentRefs": [],
    "instructions": "...",
    "router": {"mode": "project"},
    "folderBlueprint": {
      "shared": ["background", "approved-documents"],
      "private": ["locked-notes"]
    }
  },
  "versions": []
}
~~~

Publishing copies the complete draft into an immutable edition with its own ID, semantic version, status, and publication timestamp. It increments the draft revision and the final numeric segment of **nextVersion**. Deployments pin a published edition and do not follow later drafts automatically.

### 9.3 Component

Supported categories:

~~~text
persona
skill
tool
permission_profile
cron_job
heartbeat
folder_blueprint
~~~

Every component, including all existing seeded components, has an editable detailed draft:

~~~json
{
  "id": "cmp-uuid",
  "type": "skill",
  "name": "Site observation triage",
  "description": "Classifies observations and prepares safe follow-up.",
  "tags": ["safety", "site"],
  "status": "active",
  "draft": {
    "revision": 1,
    "nextVersion": "1.0.0",
    "content": {
      "objective": "The result this component must achieve.",
      "triggers": "When it should run.",
      "inputs": "Required and optional evidence.",
      "instructions": "Ordered operating procedure.",
      "evidence": "How sources must be cited or recorded.",
      "output": "Required output format and fields.",
      "guardrails": "Prohibited behavior and safety boundaries.",
      "escalation": "When and to whom the agent escalates.",
      "exampleInput": "Representative input.",
      "exampleOutput": "Representative conforming result."
    }
  },
  "versions": []
}
~~~

Objective, instructions, output, and guardrails are required when creating a detailed skill and when editing any component detail. Save with the current revision. A stale revision returns 409 and the current server draft. Publishing creates an immutable edition.

At startup, migrate all seeded components that lack detail by adding useful sample draft content. Never modify an already published edition during this migration.

### 9.4 Project and deployment

A project belongs to an organization and has an immutable internal ID, a required globally unique Project No, an editable project name, a region inherited through the organization, a WhatsApp number, and a WhatsApp status. Existing projects without a Project No are migrated to stable values such as **PRJ-0001**. A deployment binds:

- a name;
- a project, or organization export scope;
- an expert;
- an exact published expert version ID;
- the readable pinned edition;
- state: provisioned, running, stopped, or restart_required;
- optional schedule/rhythm settings;
- an isolated runtime descriptor.

Project deployment runtime:

~~~text
runtime-data/<project-id>/
├── whatsapp-session/
├── shared/
│   ├── background/
│   └── approved-documents/
└── agents/
    └── <deployment-id>/
        ├── private/
        └── agent-access.json
~~~

The access manifest records the project, deployment, pinned expert edition, shared paths, and private path. Rebuild or update it when the deployment is provisioned.

### 9.5 Document

~~~json
{
  "id": "doc-uuid",
  "name": "inspection-report.pdf",
  "projectId": "project-uuid",
  "visibility": "shared",
  "deploymentId": null,
  "mimeType": "application/pdf",
  "size": 5242880,
  "storageFile": "server-only-name",
  "createdAt": "ISO timestamp",
  "createdBy": "user@example.com",
  "generated": false,
  "artifactType": null
}
~~~

Visibility values:

- **shared**: all permitted deployments in the project may ground on the file;
- **private**: exactly one named deployment may ground on the file, so **deploymentId** is required.

The browser-safe representation omits **storageFile**, inline **content**, and **contentBase64**.

### 9.6 Chat message

~~~json
{
  "id": "msg-uuid",
  "userId": "usr-uuid",
  "projectId": "project-uuid",
  "deploymentId": "deploy-uuid",
  "role": "user",
  "content": "Review the attached method statement.",
  "attachmentIds": ["doc-uuid"],
  "createdAt": "ISO timestamp"
}
~~~

Assistant messages additionally store **model** and **simulated**. Generated artifact messages also return artifact metadata and view/download URLs.

## 10. Seed library

Seed only when the relevant collection is empty. Seed:

1. one administrator from the environment variables;
2. one organization;
3. one demonstration construction project;
4. the six experts in section 2;
5. twelve reusable components covering the seven supported categories, including six detailed specialist skills;
6. at least one published **1.0.0** edition per starter expert so deployment can be demonstrated immediately;
7. a small, clearly marked demonstration activity history.

Sample skills must be domain-specific:

- site observation triage;
- toolbox talk preparation;
- progress variance analysis;
- controlled document lookup;
- RFI drafting;
- inspection and defect follow-up.

Every one of the twelve seeded components must receive a complete sample detail draft using all ten detail fields. The text must be a credible starting draft, not placeholder lorem ipsum.

## 11. Screen and interaction specification

### 11.1 Global shell

After login, render a sticky left navigation rail and a scrollable main content area.

Navigation order and numbering:

~~~text
01 Overview
02 Agent Chat
03 Expert Library
04 Component Library
05 Administration
06 Deployments
07 Project Files
08 Model & Connectors
09 User Control
10 Activity
~~~

The sidebar includes the **Construction intelligence** eyebrow, Varadise wordmark, active orange rule, protected-project message, current user identity, Change password, and Sign out.

Hide navigation items the current user cannot use, but continue to enforce access on the server.

### 11.2 Login

Use a split screen:

- left: full-height construction project desk image with warm overlay;
- right: editorial login panel with Varadise wordmark, email, password, validation errors, and primary sign-in button.

Do not expose the bootstrap password in production UI.

### 11.3 Overview

Show:

- page title and concise Agent Platform introduction;
- metric cards for experts, projects, running deployments, and protected files;
- action cards linking to Expert Library, Projects, Agent Chat, and Project Files;
- recent activity when the user has **activity.view**;
- clear, honest status notes for the in-process Agent Platform runtime, model state, and live per-project WhatsApp health.

### 11.4 Agent Chat

Use a two-column interface:

- left: permitted project filter and a compact roster of permitted deployed agents;
- right: selected specialist header, scrollable conversation, progress/status line, attachment tray, output-type selector, composer, and send button.

Required behavior:

1. Load the roster from **GET /api/chat/access**.
2. Keep separate histories for every user/project/deployment tuple.
3. Display the user message immediately before the request completes.
4. Submit on Enter; insert a newline on Shift+Enter.
5. Accept multiple attachments from the picker, clipboard paste, and drag-and-drop.
6. Upload attachments privately to the selected named deployment before sending the chat message.
7. Show meaningful stages:
   - Uploading attachments
   - Reading permitted project files
   - Contacting model
   - Preparing specialist reply
8. Disable duplicate submission while a request is active, but do not delay the optimistic message.
9. Render model errors as errors; never replace a failing configured model with simulated prose.
10. Offer output modes: Chat reply, DOCX, PDF, Image.
11. For generated artifacts, show Open and Download actions and make the file appear in Project Files.

### 11.5 Expert Library

Render a responsive two-column card gallery on desktop. Each card contains:

- small uppercase role and edition header;
- distinct 1:1 or 4:3 illustrated portrait;
- large Fraunces expert name;
- description;
- tags;
- active placement count;
- View profile and Put to work actions.

The profile exposes draft details, components, instructions, router, folder blueprint, editions, and placements. Authorized users can create, edit the draft, publish, and archive. Publishing and deploying require explicit actions.

Portrait art direction:

- friendly cartoon Chinese construction specialists;
- varied face shape, hair, age, glasses/facial hair, pose, clothing, and hard-hat color;
- warm cream background, navy outlines, orange or safety-yellow accents;
- no photorealism, corporate logo, or text embedded in the image;
- consistent crop, light direction, and illustration family across all six.

If the original binary portraits are unavailable, generate deterministic replacements following that art direction. Pixel identity is not required for functional replication, but layout dimensions and distinct character identity are.

### 11.6 Component Library

Show filters by category and a compact card/table library. Selecting a component expands its profile with:

- category, status, tags, draft revision, and next version;
- all ten editable detailed draft fields;
- edition history;
- Save draft, Publish edition, and Archive.

Creation must support every category. When category is **skill**, present the complete detailed skill form and enforce required objective, instructions, output, and guardrails. Existing component detail is editable using optimistic revision control.

### 11.7 Administration

Provide organization creation and an expandable Organization Settings directory. Authorized project managers can rename an organization or change its data region without breaking linked projects because relationships use the immutable organization ID. Project creation requires:

- valid organization;
- globally unique Project No using letters, numbers, dots, slashes, underscores, or hyphens;
- project name;
- WhatsApp number.

Place the two subtabs immediately beneath the **Administration** page header in this order: **Project Settings** first and selected by default, then **Organization Settings**. Remove standalone creation cards outside the tabs. The Project subtab contains project creation and an expandable project directory; each project record contains its own **Pair WhatsApp** or **Re-pair WhatsApp** action and QR panel. Starting pairing must be idempotent: if that project already has a live starting, QR, authorizing, or bridge-startup flow, return the same flow and current QR instead of HTTP 409. If the recorded pairing process has actually exited, mark it failed and permit a new isolated session. The Organization subtab contains organization creation and an expandable organization directory. Display only the selected subtab at a time. Authorized project managers can edit organization, Project No, project name, and WhatsApp number while the immutable project ID preserves files, deployments, chats, and user access. Project No uniqueness is case-insensitive. Changing the WhatsApp number stops and removes only that project’s active bridge mapping and resets its pairing status to **not paired**.

Pairing is strictly per project. Start Hermes in pair-only JSON mode with a new session directory under `runtime-data/projects/<projectId>/whatsapp/sessions/<pairId>`, render the real QR event, wait for the scan, then start the platform’s project bridge adapter on the next unused loopback port beginning at `HERMES_WHATSAPP_MANAGED_PORT`. The adapter reuses Hermes’ installed Baileys runtime and exposes health, joined-group listing, group metadata, and outbound messaging without modifying the Hermes installation. Store one session record per project containing project ID, session directory, bridge URL, port, status, and timestamps. Different projects must never share a session directory or bridge port. Re-pairing a project keeps that project’s current bridge active until its replacement is confirmed connected and must not affect any other project. Restore every saved project bridge independently after platform restart. Group discovery, verification, test messages, and outbound messages must resolve the bridge from the group’s project ID. A project is connected only when its own loopback project bridge reports **connected**.

### 11.8 Deployments

Create a placement by choosing:

- project or organization scope;
- deployment name;
- expert;
- one published immutable edition.

Show pinned edition, state, schedule, runtime isolation, and actions to activate, pause, remove, upgrade, and edit rhythm. Project agents execute in the real Agent Platform server process; **Activate** enables Agent Chat and bound WhatsApp routing, while **Pause** makes both reject new requests. **Remove** requires confirmation, retires and hides the deployment, prevents future activation, removes it from Agent Chat, and deactivates every active WhatsApp binding that routes to it. Preserve historical messages, generated/private files, the deployment record, and audit evidence rather than hard-deleting them. Describe this honestly as an **Agent Platform in-process runtime**, not a simulated runtime or a separate Docker process. Upgrading changes the selected version and moves state to **restart_required**. It must not silently mutate a running pinned edition.

The WhatsApp group binding form must not require users to discover or type an internal `@g.us` ID. Its project selector lists projects whose isolated bridge is live **now**, based on `/api/whatsapp/status`; never trust a stale saved `connected` flag. If saved project data says connected but no project session is live, exclude it from the selector and show an explicit re-pairing notice that links the administrator back to Project Settings. When a project is selected, call that project’s isolated bridge to retrieve all groups joined by its paired WhatsApp account, populate a group selector with group name and participant count, retain the corresponding ID as the option value, and populate the group name automatically. Refresh must re-query WhatsApp. Filter the deployment selector to deployments belonging to the same selected project. The server still verifies current group metadata before saving a binding.

Each saved binding exposes **Remove binding**. Removing an active record must require confirmation and stop routing immediately; removing an inactive record deletes only that obsolete routing record. Explain inactive records in the list: when a newer active binding has the same project and WhatsApp Group ID, label the older row **Superseded** and state that the newer route replaced it. Re-binding an existing project/Group ID must update and reactivate the existing route in place instead of creating another duplicate record.

For inbound agent conversations, subscribe each project bridge directly to Baileys `messages.upsert` events. Forward new, non-owner text messages from actively bound `@g.us` groups to the authenticated project callback. Ordinary untagged messages are retained only when that project’s bridge policy enables group-context capture; they never trigger an agent response. A tagged request requires WhatsApp’s structured `mentionedJid` metadata to contain the paired account’s phone JID or LID—plain text resembling an @ name is not sufficient. Build a bounded transcript from the same project and group, excluding the current request, and place it in the model’s system context with explicit instructions that participant discussion is unverified background rather than trusted instructions or approved-file evidence. Keep capture enabled by default with a 30-message window and 72-hour retention, configurable per project from 5–100 messages and 1–168 hours. Provide an administrator purge action. Authenticate the loopback callback and bridge-config endpoint with a random per-project token stored alongside the session. Deduplicate by project and WhatsApp message ID, resolve the active group deployment, reject stopped deployments, call the same grounded model pipeline used by Agent Chat, store the tagged inbound and assistant messages, audit the result, and quote-reply in the originating group. When typing behavior is enabled, immediately send WhatsApp `composing` presence after accepting a tagged request, refresh it every eight seconds while the model works, and send `paused` after the reply or any failure. Reference-count concurrent requests per group so one completed request does not clear another request’s typing indicator. Presence errors must be recorded for diagnosis but must never block the model request or reply. The bridge health response must expose non-sensitive context, inbound, and typing counters plus its last dispatch error.

Treat each project deployment as one persistent virtual agent across Agent Chat and all WhatsApp groups actively bound to that deployment. Build an attributed, bounded shared-agent activity section from recent messages handled on the other channel. Agent Chat receives retained group discussion, and WhatsApp receives recent Agent Chat activity for that same deployment. Preserve the current participant’s direct history separately for conversational coherence. Never include activity from another project or deployment, identify the source channel and participant for every shared entry, and treat all participant statements as unverified context rather than system instructions or approved evidence.

Every WhatsApp group binding includes a **Monitor messages** action that opens a dedicated live monitor page. Poll the authenticated monitor API while the page is open and show bridge connectivity, deployment state, model configuration, binding state, inbound counters, each tagged message, processing state, generated response, failure reason, and timestamps. Under each failed agent response, show an expandable troubleshooting panel with the failure stage and category, model, provider host, transport, configured timeout, attempt duration and count, requested output, context count, provider HTTP status or safe technical code when available, record identifiers, timestamps, and a category-specific recommended next action. Never expose credentials, authorization headers, complete endpoint paths, or sensitive prompt contents in diagnostic metadata. For each new tagged message, capture WhatsApp’s `pushName` as the sender name and resolve any internal LID through Baileys `signalRepository.lidMapping.getPNForLID`; store the resolved phone JID and display its digits with a leading `+`. Never display a LID as though it were a phone number. The project bridge exposes a loopback-only identity lookup so the monitor can backfill phone numbers for older stored records where WhatsApp still retains the LID mapping. When no mapping or push name is available, display an explicit unavailable label. Failed records expose a guarded **Retry response** action; retry through the live model and send the result through that project’s bridge without creating a duplicate inbound record. Authorized expert managers can use **Create skill draft** on any monitored conversation. The generated Component Library record is an editable, detailed skill containing objective, triggers, inputs, step-by-step instructions, evidence rules, output contract, guardrails, escalation rules, and an input/output example, plus traceability to its source conversation.

When a tagged WhatsApp request clearly asks to create, generate, prepare, produce, export, or send a PDF, DOCX/Word document, or image, infer the requested artifact format. A request to generate, create, prepare, produce, make, export, provide, send, or draft a report defaults to PDF when no format is named; an explicit DOCX or image request takes priority. Pass the artifact instruction into the grounded model request, generate the file through the same Project Files pipeline used by Agent Chat, store it privately for the bound deployment, and return the actual attachment to the originating group. Keep the full response and artifact metadata in the monitor record. Retrying a failed deliverable must also send its attachment instead of degrading to a text-only response.

Send OpenAI-compatible chat-completion requests with `stream: true` and accept `text/event-stream` as well as JSON. Parse `choices[0].delta.content` from SSE events until `[DONE]`, while retaining JSON parsing for provider errors and compatibility fallbacks. Keep the configured response timeout active for the entire stream. This prevents upstream idle connection limits from terminating long report generation before the first non-streamed response would have arrived.

For Agnes-compatible OpenAI-style services, keep the ordinary system-first request as the primary model call. If and only if the provider returns HTTP 400 containing `System message must be at the beginning`, retry once against the same live provider by embedding the operating instructions in the first user message and record the compatibility mode. Do not replace this failure with a simulated response.

### 11.9 Project Files

Project Files has two tabs inside the same project boundary.

#### Project Library

The Project Library upload panel must:

- permit multiple files;
- support picker and drag-and-drop;
- show selected filename, MIME type, size, and remove action;
- select a permitted project;
- select a nested project folder or the project root;
- select visibility;
- reveal a named-expert selector when visibility is private;
- reject private upload submission until a deployment is selected;
- upload each file using streamed multipart handling;
- show per-file progress/result where available.

There is no application-defined file-size or file-count cap. Available disk, proxy, operating system, and deployment limits remain practical boundaries. Never buffer the complete multipart file in RAM.

Store folders separately from documents with `projectId`, `parentId`, `name`, and timestamps. Permit create, rename, move, and deletion only when the folder contains no documents or child folders. Reject cross-project parents and cyclic moves.

Create a protected **Generated Outputs** system folder at the root of every project when the project is provisioned, and backfill it for existing projects at startup. Set every generated DOCX, PDF, and image record to this folder. Do not show this system folder in ordinary upload or parent-folder choices, and reject rename, move, or deletion requests. Ordinary project evidence cannot be uploaded into it.

The protected Project Library must provide:

- project and visibility metadata;
- named expert for private files;
- nested folder structure and folder reassignment;
- View;
- Download;
- visibility selector;
- named-expert selector when changing to private;
- Save access;
- Delete with confirmation.

Changing visibility must immediately affect later model grounding. Deleting removes both metadata and the physical stored file.

Only Project Library records are eligible for automatic agent grounding. Exclude records whose `documentType` is `template`, and exclude previously generated outputs unless the user explicitly attaches one to the current request.

#### Document Templates

The Document Templates tab accepts exactly one `.docx` or `.pdf` per upload. Store templates as project-scoped document records with `documentType: "template"`, `templateFormat`, description, and `isDefault`. Maintain at most one default per project and format. Templates never become evidence context.

Templates are AI-enabled and do not require placeholders. Before generation, extract visible DOCX or PDF text and provide its headings, field labels, terminology, and section order to the model as untrusted layout data. Ask the model to emit exact label/value pairs and repeated data under the template's exact table headers. In DOCX output, retain the existing Word layout; match bilingual labels exactly; replace visual underline and checkbox value cells; map Markdown rows into their corresponding Word tables; and reject short numeric labels as section matches. Treat a document with three or more tables as a form template: complete it in place without appending a duplicate report. Simpler layout templates may receive unmatched sections before the final section properties. Continue to support `{{title}}`, `{{content}}`, `{{project_name}}`, `{{project_no}}`, `{{agent_name}}`, and `{{generated_at}}` as optional exact-placement controls. Reject only invalid package structures. Static PDF templates preserve every uploaded page as front matter, then append the generated Unicode report pages using broadly compatible non-object-stream serialization. Agent Chat and WhatsApp apply the project default matching the requested DOCX/PDF format and record `templateId` and `templateName` on the generated artifact.

Generated PDFs must embed a Unicode CJK-capable font. Auto-detect suitable Windows, Linux, and macOS fonts and allow an explicit `VARADISE_PDF_FONT` override. Test the actual extracted PDF text with Chinese content; checking only the `%PDF` signature is insufficient.

### 11.10 Model & Connectors

Model settings:

- OpenAI-compatible service URL;
- model ID;
- API key;
- temperature or other supported public settings;
- a non-secret **hasApiKey** status;
- a **modelConnected/configured** status.

Saving a blank API-key field must retain the existing encrypted key. The UI must never display the stored key.

Project connectors accept service, label, and a secure credential. Connector list responses show metadata only. The Test action returns an explicit simulation result and never sends the credential externally.

### 11.11 User Control

Render a tight, expandable user directory. The collapsed row includes name, email, role label, status, and a concise access summary. Expanding exposes:

- editable name and validated email;
- retained Administrator or configurable custom role;
- individual permission checkboxes;
- multiple project-access checkboxes;
- multiple agent/deployment-access checkboxes;
- active/disabled state;
- Save;
- Reset password.

The create form uses the same role and multi-access controls. Show the password rule beside password fields. Self-service Change password remains available from the sidebar.

### 11.12 Activity

Render newest-first auditable events with timestamp, action, subject, detail, and actor. Only users with **activity.view** may access it. Record security- and platform-relevant mutations, never plaintext secrets.

## 12. Visual system

Use Google Fonts:

- **DM Sans** for interface text;
- **Fraunces** for display headings and expert names.

Core tokens:

~~~css
:root {
  --ink: #102d47;
  --muted: #667481;
  --line: #dedbd4;
  --paper: #f7f4ed;
  --surface: #fffdfa;
  --orange: #d6673f;
  --cream: #f5eee5;
  --green: #376246;
  --shadow: 0 16px 40px #102d4710;
}
~~~

Design rules:

- editorial construction aesthetic, warm neutral canvas, navy typography, burnt-orange accents;
- 245px sticky desktop sidebar;
- thin neutral borders and restrained radius;
- large serif page headings;
- small uppercase letter-spaced eyebrows;
- navy primary buttons, low-contrast secondary buttons, red-tinted destructive actions;
- generous page spacing but compact operational rows;
- clear hover, focus-visible, disabled, loading, error, and success states;
- minimum 44px interactive targets where practical;
- keyboard-operable forms, labels bound to inputs, and meaningful alternative text.

Responsive behavior:

- at 900px or below, collapse the sidebar into a top/compact navigation and stack two-column work areas;
- at 570px or below, make cards and form grids single-column, let action rows wrap, and keep the chat composer anchored within normal flow;
- never cause horizontal page scrolling at 320px.

## 13. File ingestion and grounding

### 13.1 Streamed upload algorithm

1. Authenticate and require **files.manage**.
2. Parse multipart fields and file streams with Busboy.
3. Validate project access.
4. Validate visibility.
5. If private, validate that the deployment exists, belongs to the project, and is accessible to the user.
6. Sanitize the client filename to a safe basename.
7. Create a document ID before writing.
8. Stream to **data/uploads/<document-id>-<safe-filename>**.
9. Count bytes while streaming.
10. On success, persist metadata and audit the upload.
11. On parser, stream, authorization, or persistence failure, remove any partial file.
12. Return only safe document metadata.

Keep the legacy JSON/base64 batch endpoint for compatibility, but use multipart in the UI.

### 13.2 Reading content

For grounding:

- extract PDFs with pdf-parse;
- decode text-like files such as TXT, MD, CSV, JSON, XML, HTML, JavaScript, and source code as UTF-8;
- for unsupported binary formats, include filename and metadata but do not pretend text was extracted;
- normalize whitespace and label every excerpt with its source filename;
- prefer explicit chat attachments, then recent permitted project documents;
- cap each extracted file at 20,000 characters;
- cap total document context at 60,000 characters;
- exclude files outside the project or outside the exact private deployment.

DOCX files generated by the system are downloadable artifacts. Unless a DOCX text extractor is deliberately added, do not claim that arbitrary uploaded DOCX files are fully parsed.

### 13.3 Visibility predicate

A document is available to a deployment only when:

~~~text
document.projectId equals selectedProject.id
AND
(
  document.visibility equals "shared"
  OR
  (
    document.visibility equals "private"
    AND document.deploymentId equals selectedDeployment.id
  )
)
~~~

Apply the same predicate when preparing model context and when authorizing access to a private document. Generated artifacts may additionally be accessed by the chat user who has access to the owning project and deployment.

## 14. Model and chat pipeline

### 14.1 Configuration states

If service URL, model ID, or decrypted API key is missing, respond with a clearly marked local pilot simulation and store **simulated: true**.

If all three are present, call the configured model. If that request times out, rejects, or returns an invalid response, return HTTP 502. Do not silently fall back.

### 14.2 OpenAI-compatible request

Send:

~~~http
POST <service-url-without-trailing-slash>/chat/completions
Authorization: Bearer <decrypted-api-key>
Content-Type: application/json
~~~

Representative body:

~~~json
{
  "model": "configured-model-id",
  "temperature": 0.2,
  "messages": [
    {
      "role": "system",
      "content": "Expert identity, specialist role, project, pinned edition, instructions, guardrails, and permitted document excerpts"
    },
    {
      "role": "user",
      "content": "Recent scoped conversation and current request"
    }
  ]
}
~~~

Use a configurable server-side model timeout, defaulting to 180 seconds and bounded from 30–600 seconds. Keep WhatsApp composing presence alive for the full request. Read the reply from the conventional first choice message content. The system prompt includes:

- selected expert name and specialty;
- selected project and deployment;
- exact pinned edition;
- published/draft specialist instructions applicable to the deployment;
- component guidance;
- explicit instruction to use only provided permitted project documents;
- filename-labelled document excerpts;
- the latest 20 non-simulated messages in the same user/project/deployment conversation;
- output-mode instruction when generating an artifact.

Never include another user’s conversation or another private deployment’s file.

### 14.3 POST message transaction

1. Authenticate.
2. Require **agents.chat**.
3. Validate project access.
4. Validate deployment access and project membership.
5. Validate non-empty message or at least one permitted attachment.
6. Resolve attachment IDs using the document visibility rules.
7. Store the user message.
8. Read permitted context.
9. Call the live model or explicit unconfigured simulation.
10. If an artifact mode was requested, generate and store the artifact privately for the deployment.
11. Store the assistant message with model and simulation metadata.
12. Audit the interaction without copying full sensitive document content into the audit trail.
13. Return user message, assistant message, and optional artifact.

## 15. Generated artifacts

All generated artifacts:

- use the selected model’s answer as source material;
- are stored in **data/uploads**;
- create a document metadata record;
- are private to the selected deployment;
- include **generated: true** and **artifactType**;
- appear immediately in Project Files;
- expose authenticated View and Download URLs.

### DOCX

Generate with the **docx** package. Include document title, expert/project metadata, generation timestamp, and model content. A valid download begins with the ZIP signature **PK**.

### PDF

Generate with **pdfkit**. Include the same metadata and wrap long content across pages. A valid download begins with **%PDF**.

### Image

Generate a branded SVG image using escaped model text, warm paper background, navy typography, orange accent, expert/project label, and safe line wrapping. Return MIME type **image/svg+xml**. A valid download contains an **svg** root element.

This reference uses SVG for deterministic local image generation. Adding a raster image-generation service is an optional production extension, not required for parity.

## 16. API contract

All authenticated responses and mutations are subject to project/agent scope in addition to the permission shown.

| Method | Route | Required access | Purpose |
|---|---|---|---|
| GET | /api/health | Public | Platform health and saved project-session count |
| POST | /api/auth/login | Public | Validate credentials and create session |
| POST | /api/auth/logout | Session | Delete session and cookie |
| GET | /api/auth/session | Session | Safe current-user record |
| PUT | /api/auth/password | Session | Change own password |
| GET | /api/users | Administrator | List safe user records |
| POST | /api/users | Administrator | Create user |
| PUT | /api/users/:id | Administrator | Edit role, scopes, status, identity |
| POST | /api/users/:id/reset-password | Administrator | Reset password and sessions |
| GET | /api/dashboard | Session | Scoped dashboard data |
| GET | /api/experts | Session | Expert profiles and editions |
| POST | /api/experts | experts.manage | Create expert |
| PUT | /api/experts/:id/draft | experts.manage | Revision-checked draft save |
| POST | /api/experts/:id/publish | experts.manage | Publish immutable edition |
| POST | /api/experts/:id/archive | experts.manage | Archive expert |
| GET | /api/components | Session | Component library |
| POST | /api/components | experts.manage | Create detailed component |
| PUT | /api/components/:id | experts.manage | Save component identity and detailed draft |
| PUT | /api/components/:id/draft | experts.manage | Generic revisioned component draft save |
| POST | /api/components/:id/publish | experts.manage | Publish immutable edition |
| POST | /api/components/:id/archive | experts.manage | Archive component |
| GET | /api/organizations | Session | List organizations |
| POST | /api/organizations | projects.manage | Create organization |
| PUT | /api/organizations/:id | projects.manage | Rename organization or change data region |
| GET | /api/projects | Session | List permitted projects |
| POST | /api/projects | projects.manage | Create project and runtime |
| PUT | /api/projects/:id | projects.manage plus project access | Edit organization, unique Project No, name, or WhatsApp number |
| GET | /api/whatsapp/status | projects.manage or deployments.manage | Read live Hermes health summarized by permitted project |
| POST | /api/whatsapp/inbound | Authenticated local project bridge | Retain an untagged context event or deduplicate and route a tagged request |
| GET | /api/whatsapp/bridge-config?projectId=:id | Authenticated local project bridge | Read the project’s non-secret live bridge policy |
| POST | /api/projects/:id/whatsapp/pairing/start | projects.manage plus project access | Start or replace only this project’s linked-device QR session |
| GET | /api/projects/:id/whatsapp/pairing/status | projects.manage plus project access | Read this project’s QR, scan, startup, connected, cancelled, or error state |
| POST | /api/projects/:id/whatsapp/pairing/cancel | projects.manage plus project access | Cancel this project’s QR flow before bridge startup |
| POST | /api/projects/:id/whatsapp/pair | projects.manage plus project access | Check this project’s saved Hermes bridge health |
| GET | /api/projects/:id/whatsapp/groups | deployments.manage plus project access | Retrieve groups joined by this project’s paired WhatsApp account |
| PUT | /api/projects/:id/whatsapp/settings | projects.manage plus project access | Configure group-context capture, window, retention, and typing behavior |
| DELETE | /api/projects/:id/whatsapp/context | projects.manage plus project access | Purge retained WhatsApp group context for the project |
| GET | /api/projects/:id/groups | Project access | List group bindings |
| POST | /api/projects/:id/groups | deployments.manage | Verify group through Hermes and bind it to a project deployment |
| GET | /api/groups | Session | List permitted group bindings |
| DELETE | /api/groups/:id | deployments.manage plus project access | Remove an active or inactive WhatsApp routing binding |
| GET | /api/groups/:id/monitor | deployments.manage plus project access | Read live binding diagnostics and the latest tagged message/response records |
| POST | /api/groups/:id/test | deployments.manage | Send an explicit connection test through Hermes |
| POST | /api/groups/:id/messages | agents.chat | Send an authorized outbound group message through Hermes |
| POST | /api/whatsapp/messages/:id/retry | deployments.manage plus project access | Retry one failed response through the live model and project bridge |
| POST | /api/whatsapp/messages/:id/skill | experts.manage plus project access | Create a detailed editable skill draft from a monitored conversation |
| GET | /api/deployments | Session | List permitted deployments |
| POST | /api/deployments | deployments.manage | Pin and provision expert edition |
| DELETE | /api/deployments/:id | deployments.manage plus project access | Retire the working expert, deactivate its bindings, and preserve history/files |
| POST | /api/deployments/:id/start | deployments.manage | Set running state |
| POST | /api/deployments/:id/stop | deployments.manage | Set stopped state |
| POST | /api/deployments/:id/upgrade | deployments.manage | Change version and require restart |
| PUT | /api/deployments/:id/schedule | deployments.manage | Edit rhythm |
| GET | /api/chat/access | agents.chat | Scoped projects and agent roster |
| GET | /api/projects/:projectId/deployments/:deploymentId/messages | agents.chat | User-scoped history |
| POST | /api/projects/:projectId/deployments/:deploymentId/messages | agents.chat | Grounded chat and artifact generation |
| GET | /api/projects/:projectId/connectors | connectors.manage | Safe connector metadata |
| POST | /api/projects/:projectId/connectors | connectors.manage | Encrypt and store credential |
| POST | /api/projects/:projectId/connectors/:connectorId/test | connectors.manage | Explicit simulated test |
| POST | /api/documents/upload | files.manage | Stream multipart files |
| GET | /api/documents | files.manage | List scoped safe metadata |
| POST | /api/documents/batch | files.manage | Legacy base64 multi-upload |
| POST | /api/documents | files.manage | Legacy text/demo upload |
| PUT | /api/documents/:id | files.manage | Change visibility/named deployment |
| DELETE | /api/documents/:id | files.manage | Delete metadata and physical file |
| GET | /api/documents/:id/view | Scoped file or chat access | Inline content |
| GET | /api/documents/:id/download | Scoped file or chat access | Attachment download |
| POST | /api/projects/:projectId/exports | files.manage | Export shared record to organization scope |
| GET | /api/audit | activity.view | Newest-first audit log |
| GET | /api/settings | Session | Redacted model settings |
| PUT | /api/settings | connectors.manage | Save public settings and encrypted API key |

Unknown **/api/** routes return JSON 404 with **Route not found.** Static browser routes fall back to **index.html** so refreshing the single-page application does not produce that API error.

## 17. Frontend implementation contract

### index.html

Provide:

- metadata and responsive viewport;
- Google Font imports;
- login root;
- authenticated application shell;
- sidebar and navigation targets;
- main render root;
- reusable dialog/toast regions;
- a module script loading **app.js**.

### app.js

Implement a small state-driven SPA without a framework:

- central state for user, current view, dashboard, experts, components, projects, deployments, files, settings, users, audit, chat selection, messages, pending attachments, and progress;
- a single authenticated fetch helper that parses JSON errors and returns to login on 401;
- route/view render functions for all ten screens;
- event delegation or carefully rebound handlers after rendering;
- safe HTML escaping for all server/user-derived text;
- permission-aware navigation and actions;
- toasts for errors and successes;
- modal/inline forms;
- optimistic chat insertion;
- keyboard and drag/drop handlers;
- object URL cleanup for local previews where used.

Do not rely on browser-only authorization. Do not place secrets in localStorage. The session is cookie-based.

### styles.css

Implement the design tokens and screens in section 12. Preserve visual consistency across every page, including forms, cards, expanded user detail, component detail, file library, and chat. Use the supplied portraits as normal responsive images with stable aspect ratios to prevent layout shift.

## 18. Server implementation contract

### env.js

Load process environment with safe defaults, resolve absolute repository/data/runtime/public paths, and export one configuration object. Do not log secrets.

### security.js

Export:

- email normalization and validation;
- password-policy explanation;
- scrypt hash and verification;
- authenticated encryption and decryption;
- random session token;
- safe constant-time comparisons.

### seed-library.js

Export deterministic seed definitions and initialization/migration functions. It owns starter experts, detailed components, starter organization/project, and protected sample-draft migration.

### store.js

Own all file-backed persistence and atomic writes. It must not contain HTTP response logic.

### server.js

Own:

- HTTP server and static serving;
- cookie/session authentication;
- permission and scope predicates;
- JSON/body/multipart parsers;
- all API routes;
- runtime manifest generation;
- document access and extraction;
- live model request;
- chat transaction;
- artifact generation;
- structured errors and audit calls.

Keep path parsing exact. Multipart upload must be registered before generic JSON body parsing. Register **/api/documents/upload** exactly; a mismatch is the common cause of the former **Route not found** upload failure.

## 19. Installation and startup

From an empty directory:

~~~powershell
npm install
npm run db:start
npm run db:migrate
npm test
npm start
~~~

Copy `.env.example` to the ignored `.env` before starting the database and replace both occurrences of the database password with the same strong value. `npm run db:start` uses the official PostgreSQL image in `compose.yaml` and binds port 5432 to loopback only. `npm run db:migrate` creates the schema and imports the legacy JSON dataset only if the database is empty. It is safe to rerun for an already initialized database.

Then open:

~~~text
http://localhost:3000/
~~~

If port 3000 is already occupied, stop the existing process or set another **PORT** before startup. After installing GitHub CLI on Windows, open a new terminal or refresh PATH before running **gh auth login**; do not concatenate install and login commands.

For a clean verification without destroying a working dataset, use a separate database/schema and point **DATA_DIR** and **RUNTIME_DIR** to new temporary directories. Never delete an existing user data directory or PostgreSQL volume merely to re-seed.

## 20. Automated test contract

Use Node’s built-in test runner. A conforming implementation must test:

### Core

- a password hash never contains the plaintext password and verifies correctly;
- encrypted secrets never retain plaintext and decrypt correctly;
- email normalization/validation and every password-policy branch;
- legacy JSON adapter save/reload and PostgreSQL import/persistence;
- seed library contains six experts and twelve detailed components.

### User and access control

- create/edit validation and duplicate email conflict;
- administrator retention and self-protection;
- configurable permission, multiple project scope, and multiple agent scope;
- disabled-user/session behavior;
- password reset session invalidation.

### Files

- multipart upload larger than the former 5 MB limit succeeds;
- multiple upload and drag/drop backend equivalent;
- private upload requires a valid named deployment;
- safe list responses redact physical/inline content;
- view/download content and headers;
- visibility change;
- deletion removes metadata and disk file;
- incorrect project/agent access is denied.

### Chat and model

- chat access returns only allowed project/deployment pairs;
- histories are isolated by user/project/deployment;
- unconfigured model produces a labelled simulated response;
- a mock OpenAI-compatible service produces a live non-simulated response;
- a configured failing service returns 502 and does not simulate;
- shared documents are grounded;
- private documents ground only for the named deployment;
- uploaded chat attachment is included in grounding;
- DOCX, PDF, and SVG generation produces correct signatures, records, and downloads.

### Components

- all twelve existing components have meaningful detailed drafts;
- detailed skill creation validates required fields;
- edit increments revision;
- stale edit returns 409 with the current draft;
- publish creates an immutable edition;
- later draft changes do not alter that edition.

Run:

~~~powershell
npm test
~~~

Reference acceptance result: five top-level tests, zero failures.

## 21. Manual acceptance checklist

### Authentication and users

- [ ] Valid administrator login succeeds; invalid login is generic.
- [ ] Email is validated and normalized.
- [ ] Passwords shorter than eight or missing uppercase, lowercase, or digit are rejected.
- [ ] User list is compact and each row expands.
- [ ] Custom permissions plus multiple projects and agents can be saved and enforced.
- [ ] The last administrator cannot be demoted or disabled.
- [ ] Changing/resetting a password invalidates the intended sessions.

### Libraries and deployments

- [ ] Six distinct worker portraits appear.
- [ ] Expert draft/publish/archive and immutable editions work.
- [ ] All component details are populated and editable.
- [ ] New detailed skill validation works.
- [ ] Deployment pins a published edition and creates an isolated runtime manifest.

### Files

- [ ] Picker and drag/drop accept multiple files.
- [ ] A file larger than 5 MB uploads without **Route not found**.
- [ ] Private visibility reveals and requires a named expert.
- [ ] View and Download work.
- [ ] Visibility can be changed and saved.
- [ ] Delete removes the record and physical content.

### Chat

- [ ] Only permitted project agents appear.
- [ ] Enter sends and Shift+Enter makes a new line.
- [ ] Multiple picker, paste, and drag/drop attachments work.
- [ ] The message appears immediately and progress stages are visible.
- [ ] Uploaded permitted project files influence the response.
- [ ] Private files never leak to a different agent.
- [ ] Configured model responses are not marked simulated.
- [ ] Configured model failures are visible and never become local-pilot responses.
- [ ] DOCX, PDF, and image outputs open, download, and appear in Project Files.

### Responsive and accessibility

- [ ] Every page uses the same design system.
- [ ] 1440px, 991px, 768px, 390px, and 320px widths are usable.
- [ ] No keyboard trap or horizontal overflow.
- [ ] Focus is visible and form errors identify the relevant field.

## 22. Production hardening beyond reference parity

The following are deliberately outside the local reference and should be completed before a multi-user production rollout:

- replace JSON persistence with a transactional database and migrations;
- use durable, revocable sessions in a secure session store;
- set **Secure** cookies behind HTTPS and add CSRF protection;
- add login throttling, lockout policy, password history, and optional MFA/SSO;
- use a managed KMS or secrets vault instead of an application-derived local key;
- add antivirus/content-disarm scanning, file quotas, and storage lifecycle policy;
- parse DOCX/XLSX and use OCR/vector search when required;
- enforce reverse-proxy request, timeout, and disk capacity controls explicitly;
- replace the local authenticated inbound callback and JSON deduplication records with a durable transactional message queue for production scale;
- connect real deployment orchestration and health probes;
- connect real third-party connector tests;
- add audit retention, export controls, privacy policy, backups, restore drills, and observability;
- add model data-governance controls, regional routing, and prompt-injection defenses for untrusted documents.

These extensions must preserve the authorization and visibility predicates defined above.

## 23. Deterministic rebuild sequence

For the closest repeatable result:

1. Create the exact tree and dependency manifest.
2. Implement configuration and security primitives.
3. Implement atomic store and root schema.
4. Add deterministic seed data and component-detail migration.
5. Implement authentication and centralized authorization predicates.
6. Implement experts, components, organizations, projects, and deployments.
7. Implement streamed document storage and access control.
8. Implement settings encryption and live model client.
9. Implement isolated chat history, grounding, and artifact generation.
10. Implement connectors, live Hermes health, verified WhatsApp group bindings, outbound messaging, and audit.
11. Build the global shell and ten screens using the visual tokens.
12. Add the six portraits and construction login artwork.
13. Run automated tests.
14. Complete every manual acceptance item at desktop and mobile widths.
15. Verify that secrets and runtime data are ignored by Git.

## 24. Definition of done

The replica is complete only when:

- **npm install**, **npm test**, and **npm start** succeed on Node 18+;
- the app loads at the configured port and every documented route responds correctly;
- all ten screens are implemented and visually consistent;
- all user, permission, project, and multiple-agent access rules are enforced server-side;
- large streamed multi-file upload, named-agent privacy, change, delete, view, and download work;
- grounded chat uses only permitted documents and the real configured model;
- the unconfigured simulation and integration simulations are unmistakably labelled;
- document generation produces valid DOCX, PDF, and SVG files;
- components are detailed, editable, revision-safe, and versioned;
- no password, API key, connector credential, storage path, or inline file body leaks through safe APIs;
- all automated and manual acceptance checks pass.

This document, the dependency lock, and the acceptance suite together define the reproducible system. Runtime data, encryption secrets, user passwords, third-party credentials, and signed-in sessions are installation-specific and must never be embedded in a replication guide.
