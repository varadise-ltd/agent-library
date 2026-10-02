# Current platform source publication

Prepared on 2 October 2026 for https://github.com/varadise-ltd/agent-library.

This repository contains the current application source, browser assets, Docker configuration, dependency lockfile, tests, reusable blank safety-report template, template builder and operating documentation. The source was copied from the working tree based on commit `a55db265b3462e32acdef210e3e000f48b0e3a66` on `codex/major-revamp-2026-09-25`, including the pending Dockerfile, interface and server changes.

The publication starts a clean Git history. Earlier local history contains filled customer reports and an administrator password example. That history is retained in the original local repository and is not included here. Commit author and committer are `varadisezecalee <336750156+varadisezecalee@users.noreply.github.com>`.

## Installation and data

Follow the root README and Compose configuration. Set fresh database, administrator, encryption and integration secrets in your own `.env`. The example environment file contains placeholders. The reusable DOCX template is blank.

Local `.env`, project source mounts, database exports, uploaded customer files, generated customer reports, session cookies, WhatsApp credentials, runtime directories, temporary QA captures, Git bundles and marketing decks containing live screenshots are excluded. Keep backups in private operational storage and transfer them separately to the authorized receiver. Excluding this operational data does not remove application functionality.

## Historical handover documents

The Word documents in `docs/handover` describe the separate local handover package captured on 28 September 2026. Paths such as `01-source` and `02-docker-preserved` refer to that private package, not folders in this Git repository. Read `docs/handover/README.md` for corrections and limitations before using those documents.

Source publication does not certify that Docker, PostgreSQL, model providers, Hermes or WhatsApp are healthy in a receiver environment. Run deployment acceptance checks after installing and configuring the system.

## Validation on 2 October 2026

The existing Node tests were run from the isolated source copy with temporary JSON state and a mock WhatsApp bridge. Six core tests passed. The user and WhatsApp integration test failed at `apps/control-plane/test/users.test.js:180`, receiving HTTP 202 where it expected HTTP 200. The full integration suite therefore has not passed; subsequent assertions in that test did not run.

A missing `scripts/export-platform-markdown.mjs` wrapper was supplied for the existing package script. It invokes the existing seed-based specification exporter, requires an explicit output destination and does not read live application state. Help, syntax, deterministic file output, strict options JSON and rejection of application-state input were checked.

Source and document scans checked for common API token and private-key patterns and known secret-bearing paths. These checks are not a formal security certification. Current Docker or external integration health was not established by this publication task.
