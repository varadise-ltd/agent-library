# Handover reference documents and corrections

The two Word documents and their diagram images are historical references from 28 September 2026. They contain no preserved database or session archives. Their `01-source` and `02-docker-preserved` paths refer to the separate private handover export.

Apply the following corrections when reading the Systems Analysis and Design document and diagrams. The current source code is authoritative.

- The explicit message state machine primarily describes inbound WhatsApp processing. Browser Agent Chat uses execution and artifact records and does not implement the same delivery acknowledgement handshake.
- `delivery_acknowledged` is terminal. The state diagram's arrow from acknowledgement to failure is incorrect. Failures are exits from active processing stages.
- Approval may mean administrator tool approval or end-user template selection. These are distinct branches. Tool approval is configurable through deployment settings; it is not mandatory for every tool call. Approved work may return to `executing`.
- Outbound WhatsApp delivery runs from the control plane through the project bridge send endpoint to the group. The bridge returns a transport acknowledgement; the runtime does not send directly to the group.
- Deployment manifests are versioned and hash-pinned. Active deployments can be updated and receive new manifest revisions.
- Provider URLs are validated for HTTP(S). There is no demonstrated private-IP or DNS-based SSRF denylist. The diagram label "allowlisted egress" is a recommended network control, not an implemented application guarantee.
- AES-GCM protects connector secret values. This does not mean all database, file or WhatsApp-session data is encrypted at rest.
- At the September capture, control-plane persistence and retrieval were ready, while Hermes health returned 503. This is a historical observation, not a current health certificate.
- Existing tests use mocks and in-memory PostgreSQL emulation. Proposed receiver acceptance checks do not establish live provider, WhatsApp, native PostgreSQL restore, TLS or internet-facing security readiness.
- The private backup contains a logical JSON snapshot. It is not a native `pg_dump` backup or SQL dump. In that package, the restore helper is `scripts/restore-postgres-logical.mjs`, with `scripts/RESTORE-LOGICAL-SNAPSHOT.md`; the DOCX command appendix refers to an incorrect PowerShell helper name. Obtain and test a native PostgreSQL dump separately.
- Do not build from the private package's Docker-only folder without the application source. The Docker build context must include `apps`, `packages`, `scripts`, `package.json` and the lockfile, as this repository does.
- Diagram images were generated, but full Word pagination and layout were not visually verified because the document renderer lacked LibreOffice. Review the Word documents before treating them as formally accepted deliverables.

Consult `../../README.md`, `../../compose.yaml`, `../../Dockerfile` and the implementation files for current installation behavior. Restore confidential customer data only from a separately authorized backup.
