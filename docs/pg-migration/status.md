# Flight Deck PG Classic Migration Status

## Current Status

Planning restored and app-card baseline available. `wm-fd-2` is a clean copy of `wingman-fd` with migration docs, installed dependencies, built static assets, and a running Autopilot app-card instance. Phase 1 is complete: backend mode selection, PG workspace descriptor connection, encrypted-record sync disablement, and Wingmen PG workspace bootstrap are in place.

Phase 2 has started. PH2-01 and PH2-02 are complete: PG mode can hydrate Tower PG scopes, accessible channels, chat messages/thread structure, and tasks into the existing Dexie-backed Flight Deck navigation and board models.

## Decisions

- Preserve the existing Flight Deck UI.
- Preserve Dexie as local/offline materialized state.
- Replace encrypted record sync with PG backend adapters in PG mode.
- Use Tower PG as source of truth.
- Keep Tower encrypted-record sync backwards compatible.
- Use the experimental `flightdeck-pg` app as API reference/test harness only, not as the product UI target.
- Dogfood with a seeded Wingmen Community PG workspace as soon as read hydration is usable.
- Do not commit generated `ecosystem.config.cjs`; Autopilot app registry owns app-card runtime process config.
- Default `wm-fd-2` to encrypted-record mode until `VITE_FLIGHT_DECK_BACKEND_MODE=tower-pg` or its compact alias is explicitly configured.

## Actions

- Created `docs/pg-migration/implementation.md`.
- Created `docs/pg-migration/architecture.md`.
- Created `docs/pg-migration/wingmen-community-bootstrap.md`.
- Created work packages under `docs/pg-migration/work-packages/`.
- App-card baseline available at `https://near-tea-crab.rick.runwingman.com`.
- Removed the copied PM2 runtime file from source control and ignored it.
- Added PH1-01 backend-mode resolution for `encrypted-records` and `tower-pg`.
- Added PH1-02 PG auth/workspace connection wiring in `tower-pg` mode: the classic connect modal now accepts Tower PG workspace descriptors, stores verified descriptor metadata in the existing known-workspaces settings state, and calls Tower PG service, workspace list, descriptor, and `/me` routes with browser NIP-98 auth.
- Added PH1-02 focused coverage for PG descriptor parsing, credential rejection, PG workspace materialization, PG workspace identity merging, and descriptor persistence through the existing connection manager.
- Fixed PG workspace normalization so descriptor-backed workspaces do not generate or persist SuperBased connection tokens.
- Hardened PH1-02 cached PG workspace activation: verified descriptors are now scoped to the authenticated session npub plus Tower/workspace/app identity, cached PG workspaces are filtered to the active signer, and cached selections re-run descriptor plus `/me` verification before becoming active after reload or login.
- Recovered PH1-02 from stalled pipeline run `b1854b43-088e-4eae-9c34-905c7d9d74f6`; retained the useful partial patch, completed tests/build locally, and will continue with one ticket per pipeline where the runner remains healthy.
- Recovered PH1-03 from stalled pipeline run `9f2da542-48b1-4500-936a-111e21eb37b9`; completed the sync gating locally because the assigned worker session stopped making observable progress.
- Added PH1-03 PG-mode sync guard: when `tower-pg` backend mode is active, the classic encrypted-record worker sync, worker flush timer, background tick, access prune, status refresh, and SSE stream startup are intentionally disabled while the existing encrypted-records mode remains unchanged.
- Hardened PH1-03 repair paths so Tower PG mode also no-ops encrypted-record family restore, quarantine retry, pending-write Tower repair, task-family backfill, and direct family pulls before they clear Dexie sync state or enqueue encrypted worker pulls.
- Added visible disabled sync status text/badge styling for Tower PG mode so the classic avatar menu does not imply encrypted-record sync is running.
- Renamed completed PH1-01 through PH1-03 work packages with the `COMPLETED-` prefix to prevent accidental redispatch.
- Completed PH1-04 Tower/CLI bootstrap: Tower setup now seeds the Wingmen workspace defaults, group permissions include task/chat/doc/file/audio surfaces, the direct setup script defaults to Pete + wm21, and `flightdeck-cli` has a one-command `smoke task` create/read/list verification.
- Seeded local Wingmen PG workspace in the local Tower DB: workspace `52ed5143-9c7b-4d93-aa8a-e6fdabec7e2d`, scope `Wingman Suite`, channels `Flight Deck PG`, `Tower PG`, and `Implementation`; descriptor saved at `/tmp/wingmen-flightdeck-pg-descriptor.json` for local import testing.
- Fixed Tower migration runner bootstrap ordering so `CREATE SEQUENCE IF NOT EXISTS` statements run before tables with sequence-backed defaults.
- Renamed completed PH1-04 work package with the `COMPLETED-` prefix.
- Completed PH2-01 PG read hydrator: added Tower PG scope/channel/thread API helpers, DB-master Dexie replace helpers, local PG-to-classic row mappers, and workspace/bootstrap hooks so connected PG workspaces populate the existing scope/channel/thread UI.
- Renamed completed PH2-01 work package with the `COMPLETED-` prefix.
- Completed PH2-02 PG read hydrator: added Tower PG channel message, channel task, and scope task API helpers; mapped PG messages and tasks into classic Flight Deck rows; hydrated tasks after PG workspace bootstrap/switch; and retained PG channel/thread IDs on local task rows for later channel/thread board zoom.
- Renamed completed PH2-02 work package with the `COMPLETED-` prefix.

## Outputs

- Migration plan is ready for pipeline execution.
- App-card baseline is available for pipeline work.
- PG migration product code now has a mode boundary plus descriptor-based Tower PG workspace connection in the existing Flight Deck UI.
- PH1-02 validation: `bun run test -- tests/backend-mode.test.js tests/api-pg-workspaces.test.js tests/pg-workspace-descriptor.test.js tests/workspaces.test.js tests/connect-settings-manager.test.js tests/pg-connect-settings-manager.test.js tests/pg-workspace-manager.test.js`; `bun run test -- tests/pg-workspace-descriptor.test.js tests/workspaces.test.js tests/connect-settings-manager.test.js tests/pg-connect-settings-manager.test.js tests/pg-workspace-manager.test.js tests/shell-state.test.js`; `bun run build`.
- PH1-03 validation: `bun run test -- tests/backend-mode.test.js tests/sse-sync-lifecycle.test.js tests/sync-manager.test.js`; `bun run build`.
- PH1-04 validation: Tower `DB_USER=postgres DB_PASSWORD=postgres bun test tests/flightdeck-pg-setup.test.ts`; Tower `bun --check src/services/flightdeck-pg-setup.ts src/scripts/setup-flightdeck-pg-workspace.ts src/routes/admin.ts src/schema/run-migrations.ts`; CLI `npm test`; live CLI smoke through temporary Tower on `localhost:3199` created/read/listed task `78435418-f4a8-4aa4-b301-3c7755dad201`.
- PH2-01 validation: `bun run test -- tests/pg-read-hydrator.test.js tests/api-pg-workspaces.test.js tests/backend-mode.test.js tests/pg-workspace-manager.test.js tests/shell-state.test.js`; `bun run build`.
- PH2-02 validation: `bun run test -- tests/pg-read-hydrator.test.js tests/api-pg-workspaces.test.js tests/backend-mode.test.js tests/pg-workspace-manager.test.js tests/shell-state.test.js`; `bun run build`.
