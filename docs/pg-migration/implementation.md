# Flight Deck PG Classic Implementation Plan

This plan migrates the existing Flight Deck UI to Tower Postgres without rebuilding the frontend from scratch.

## Operating Rules

- One work package per implementation pipeline run.
- Each ticket must name its working directory and supporting docs explicitly.
- Each ticket must produce a human-testable or machine-testable outcome.
- The orchestrator reviews each pipeline result before dispatching the next ticket.
- Update later tickets when implementation reality changes.
- Keep Tower encrypted-record sync backwards compatible.
- Use commits per ticket.
- Keep `<phase>/status.md` current during implementation.

## Supporting Docs

- `docs/pg-migration/architecture.md`
- `docs/pg-migration/scope-group-channel-gap-review.md`
- `docs/pg-migration/wingmen-community-bootstrap.md`
- `/Users/mini/code/wingmanbefree/flightdeck-pg`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/routes/flightdeck-pg.ts`
- `/Users/mini/code/wingmanbefree/wingman-tower/src/services/flightdeck-pg-api.ts`
- `/Users/mini/code/wingmanbefree/wingman-fd`

## Phase 1: Baseline And Workspace Connection

Goal: make `wm-fd-2` identify as the PG migration copy, support a PG backend mode, connect to Tower PG workspaces through the existing login shell, and seed a dogfood workspace.

Tickets:

- `work-packages/PH1-01-pg-mode-and-repo-baseline.md`
- `work-packages/PH1-02-pg-auth-and-workspace-connection.md`
- `work-packages/PH1-03-disable-record-sync-in-pg-mode.md`
- `work-packages/PH1-04-wingmen-community-bootstrap.md`

Human test at end: Pete can open the app-card URL, log in with Nostr, connect the Wingmen PG workspace, and see the existing Flight Deck shell without encrypted sync competing.

## Phase 2: Read Hydration

Goal: hydrate scopes, channels, threads, chat, tasks, docs, files, and audio notes from Tower PG into existing Dexie-backed views.

Tickets:

- `work-packages/PH2-01-pg-read-hydrator-scopes-channels.md`
- `work-packages/PH2-02-pg-read-hydrator-chat-tasks.md`
- `work-packages/PH2-03-pg-read-hydrator-docs-files-audio.md`

Human test at end: Pete can browse scope/channel/thread hierarchy, read seeded chat, see task boards at scope/channel/thread zoom levels, and inspect docs/files/audio metadata.

## Phase 3: Write Adapters

Goal: route existing UI actions through Tower PG while preserving the current UI behavior, and align PG mode with the agreed scope/group/channel access model.

Tickets:

- `work-packages/PH3-01-pg-pending-write-queue.md`
- `work-packages/PH3-02-task-write-adapter.md`
- `work-packages/PH3-03-chat-write-adapter.md`
- `work-packages/PH3-04-pg-scope-group-channel-model.md`
- `work-packages/PH3-05-pg-workspace-admin-groups.md`
- `work-packages/PH3-06-pg-channel-grants-ui.md`
- `work-packages/PH3-07-pg-scope-channel-thread-record-context.md`

Human test at end: Pete can create chat threads/messages and task-board records in the Wingmen PG workspace, manage members/groups, grant a user or group to a channel, and verify that the user sees the parent scope plus granted channel but not sibling channels.

## Phase 4: Collaboration Records

Goal: add doc/file/audio writes, comments, reactions, and row-version conflict handling.

Tickets:

- `work-packages/PH4-01-doc-file-audio-write-adapters.md`
- `work-packages/PH4-02-comments-reactions-adapters.md`
- `work-packages/PH4-03-row-version-conflict-handling.md`

Human test at end: Pete can create/update docs, attach file/audio metadata, comment/react, and see clear conflict handling for stale writes.

## Phase 5: Parity Hardening

Goal: remove remaining gaps between `wingman-fd` encrypted-record UX and `wm-fd-2` PG UX.

Tickets:

- `work-packages/PH5-01-offline-reconnect-and-event-reconcile.md`
- `work-packages/PH5-02-human-parity-hardening.md`

Human test at end: Pete can use `wm-fd-2` as the active Wingmen workspace for normal chat/task/doc work and report issues as product bugs rather than migration blockers.
