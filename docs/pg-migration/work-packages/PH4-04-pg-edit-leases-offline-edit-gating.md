# PH4-04 PG Edit Leases And Offline Edit Gating

## Workdirs

- `/Users/mini/code/wingmanbefree/wm-fd-2`
- `/Users/mini/code/wingmanbefree/wingman-tower`

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `docs/pg-migration/pg-edit-leases-and-offline-editing.md`
- `docs/pg-migration/work-packages/PH3-01-pg-pending-write-queue.md`
- `docs/pg-migration/work-packages/PH4-03-row-version-conflict-handling.md`
- `/Users/mini/code/wingmanbefree/wm-fd-2/docs/checkout_semantics.md` for legacy encrypted-record behavior only.
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`

## Scope

Implement PG-native edit leases and offline edit gating for synced tasks and documents.

The product rule is:

- Existing synced PG tasks/docs are viewable offline but not editable offline.
- New locally created PG tasks/docs are editable offline until Tower PG accepts them.
- Online synced PG task/doc edits acquire a Tower PG edit lease before entering edit mode.
- PG mode must not reuse encrypted-record checkout helpers for these edit sessions.

## Required Tower Work

- Add an edit lease persistence table/service for PG mode.
- Add acquire, renew, and release routes under `/api/v4/flightdeck-pg/workspaces/:workspaceId/edit-leases`.
- Enforce actor write access through existing PG workspace/channel ACL logic before issuing a lease.
- Reject synced task/document update requests that do not include a valid lease token and expected row version.
- Treat expired leases as reclaimable.
- Keep encrypted-record APIs backwards compatible.

## Required Flight Deck Work

- Add PG edit lease API helpers.
- Add shared PG edit-session helpers for task and document edit mode.
- Gate task detail edit entry:
  - offline + synced PG task = read-only message;
  - offline + unsynced local PG task = editable;
  - online + synced PG task = acquire lease then edit.
- Gate document edit entry with the same rules.
- Include `lease_token` and expected row version in synced PG task/doc saves.
- Release leases on save, cancel, close, route change, or document switch where practical.
- Keep encrypted-record backend mode on the existing checkout path.

## Acceptance

- Tests pass in `wm-fd-2`: focused PG edit/offline tests plus existing PG adapter tests and build.
- Tests pass in `wingman-tower`: focused PG edit lease tests plus existing flightdeck-pg tests.
- Manual app-card test can verify:
  - synced PG task/doc view offline;
  - synced PG task/doc edit blocked offline;
  - new unsynced local PG task/doc editable offline;
  - online synced PG task/doc edit acquires lease and saves.
- Both repos are committed and left clean before handoff.

## Pipeline Notes

- One implementation pipeline run owns this ticket.
- Manager review must check both code and docs against `pg-edit-leases-and-offline-editing.md`.
- If the implementation discovers the offline create queue is not complete enough for unsynced local docs/tasks, it must add the smallest queue support needed for this ticket rather than silently weakening the product rule.
