# Varadise Agent Platform

A coordinator-first local pilot for managing version-pinned construction AI experts across protected projects.

## Run locally

For publication scope and historical handover documents, see [Source publication](docs/SOURCE_PUBLICATION.md) and [Handover reference corrections](docs/handover/README.md).

1. Copy `.env.example` to `.env`; replace the database password, application secret, and administrator password.
2. Run `npm install`.
3. Run `npm run db:start` to start PostgreSQL with Docker.
4. Run `npm run db:migrate` to initialize the schema and import an existing `data/store.json` when the database is empty.
5. Run `npm start` and open `http://localhost:3000`.

Platform records, settings, encrypted connector values, chat history, and file metadata are persisted in PostgreSQL. Uploaded files, generated outputs, WhatsApp credentials, and local runtime manifests remain on protected disk storage. Under **Administration → Project Settings**, open a project and choose **Pair WhatsApp**. Every project receives a separate linked-device QR code, credential directory, loopback Hermes bridge, and port beginning at `HERMES_WHATSAPP_MANAGED_PORT`. Project sessions are restored independently after platform restarts; re-pairing one project does not replace another project’s account. Under **Deployments → Bind a WhatsApp group**, choosing a connected project automatically retrieves the group names and internal IDs joined by that project’s paired account. Group validation and outbound messages always use the selected project’s own bridge. In an actively bound group, the bridge can retain a bounded window of ordinary group messages as context, but the agent responds only when the paired account is selected through WhatsApp’s structured @ mention picker. WhatsApp displays **typing…** while the live model works and the response is then posted back to that group. Tagged requests for a PDF, DOCX, or image generate an actual Project Files artifact and return it to the originating group as an attachment. A request to generate, create, prepare, produce, make, export, provide, send, or draft a report defaults to PDF when the sender does not name a format; an explicit DOCX or image request still takes priority. Model responses are consumed through SSE streaming when the configured OpenAI-compatible provider supports it, avoiding idle connection cutoffs during long report generation while retaining JSON error compatibility. The default model response timeout is 180 seconds and is configurable from 30–600 seconds under **Model & Connectors → Advanced connection settings**. Each project configures context capture, message-window size, retention period, typing behavior, and context clearing under **WhatsApp bridge policy**. Each binding has a **Monitor messages** page with live routing and typing diagnostics, sender name and resolved WhatsApp phone number, inbound/response history, context-use counts, generated-artifact links, failed-message retry, and generation of an editable Component Library skill draft from a selected conversation. Without a connected project bridge, WhatsApp actions fail clearly rather than reporting a simulated pairing.

## PostgreSQL persistence

The production backend uses schema `varadise` by default. Array-backed platform entities are stored as individually indexed JSONB records in `platform_records`; scalar settings and an optimistic revision are stored in `platform_state`; applied schema versions are recorded in `schema_migrations`. Every save is serialized and committed in a database transaction. A stale process is refused rather than allowed to overwrite a newer revision.

On first connection to an empty database, the platform imports the existing `data/store.json` automatically. The JSON file is retained as a rollback copy but is no longer modified by the PostgreSQL adapter. Set `DATA_BACKEND=json` only for isolated tests or an intentional rollback. The `/api/health` response reports the active persistence backend, revision, pending writes, and any persistence failure.

Back up both layers: use `pg_dump` for PostgreSQL and separately back up `data/uploads` plus `runtime-data`. The Compose database is bound to loopback only; the web server can still be exposed to a trusted LAN with `HOST=0.0.0.0` without exposing port 5432.

Agent Chat and bound WhatsApp groups use one unified context for each project deployment. Agent Chat receives recent attributed discussion from every active group bound to that deployed expert, while WhatsApp receives recent activity handled by the same expert in Agent Chat. Direct conversation history remains available for continuity, and the shared context is bounded, attributed, and never crosses a project or deployment boundary.

Working experts can be removed from **Deployments → Working experts**. Removal retires the deployment, removes it from Agent Chat, prevents reactivation, and deactivates its active WhatsApp bindings. Historical messages, generated/private project files, and audit records are preserved rather than hard-deleted.

## User access

The environment administrator is migrated into the configured data store on first startup. In **User Control**, administrators can create users, retain the protected Administrator role or define custom role names, assign granular permissions and project access, update validated email addresses, disable accounts, and reset temporary passwords. Every signed-in user can change their own password.

Passwords require at least 8 characters with uppercase, lowercase, and a number. Email validation and uniqueness checks are enforced by the server; disabling an account or resetting its password invalidates its active sessions. Project and capability permissions are also enforced by the API rather than only hidden in the interface.

The login page includes **Forgot password?** recovery for lockout situations. Starting recovery is restricted to a loopback address on the computer hosting the platform; it issues a single-use token that expires after 15 minutes. Completing recovery replaces the password and invalidates the account's existing sessions. Remote LAN users must ask an administrator to reset their password from **User Control**.

## Project Files and templates

Project Files has two project-scoped tabs. **Project Library** uses one expandable hierarchical register for folders and files, with search, visibility filters, contextual upload and folder creation, row action menus, and bulk movement or access changes. Uploads stream directly to protected local disk storage, nested folders remain visible in context, and every evidence file can be shared with approved project agents or private to one named deployment. Choosing private visibility immediately reveals the eligible named-expert selector. Every project has a protected **Generated Outputs** system folder directly under the project root; all existing and future agent-generated DOCX, PDF, and image files are kept there and cannot be moved out. Only permitted Project Library evidence is extracted for model context; document templates and previously generated outputs are excluded from automatic grounding. There is no application-defined file-count or file-size cap, so available disk space is the practical boundary.

**Document Templates** accepts one DOCX or PDF at a time and keeps one default per project and file type. Templates are AI-enabled and do not require placeholders: the model receives the visible headings and field labels as layout guidance. For DOCX, exact bilingual labels, visual underline fields, checkbox option cells, and repeated Markdown rows are mapped into the existing Word tables. Multi-table form templates are completed in place and do not receive a duplicate report appendix; `{{title}}`, `{{content}}`, `{{project_name}}`, `{{project_no}}`, `{{agent_name}}`, and `{{generated_at}}` remain optional for exact placement. Static PDF pages are preserved as front matter before the generated report. Agent Chat and WhatsApp use the matching project default automatically and record the applied template on the generated file. Generated PDFs embed an available Unicode CJK font; set `VARADISE_PDF_FONT` and optionally `VARADISE_PDF_FONT_FAMILY` when the host does not provide a detected Noto/Windows/macOS CJK font.

## Checks

Run `npm test` for core security, account-management API, local fallback persistence, and PostgreSQL import/persistence checks.
