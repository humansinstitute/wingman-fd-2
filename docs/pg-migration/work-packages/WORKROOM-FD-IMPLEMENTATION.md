# Workroom Flight Deck Implementation

Owner: wm21 manager session
Repo: `/Users/mini/code/wingmanbefree/wm-fd-2`
Date: 2026-07-16

## Context

Tower workroom support is already implemented, tested, rebuilt, and live on the local Tower service at `http://127.0.0.1:3100`.

Completed Tower commits:

- `2142072 Add Flight Deck workroom PG schema`
- `1a68452 Add Flight Deck workroom routes`
- `d835ff9 Add Flight Deck workroom approval guards`

Flight Deck should now implement the native workroom user experience before Autopilot integration work begins. The product intent is to use the UI to prove the workflow, expose contract gaps, and only then update Autopilot skills/GitHub merge loops.

Do not build this as a WApp. Workrooms are Flight Deck native functionality.

## Runtime And Repo Rules

- Work on `main` unless Pete explicitly redirects.
- Preserve concurrent work. Do not reset, revert, or discard unrelated local changes.
- Commit all nonignored tested state when the package is complete.
- Edit source files, not only `dist/`.
- Run `bun run build` after source changes so `dist/` matches the served app.
- Do not start a standalone Vite/dev server unless Pete explicitly asks.
- If the implementation exposes missing Tower API fields or awkward route contracts, document the exact gap and keep the UI change as small as possible until the Tower contract is corrected.

## Existing Tower Contract To Use

Route prefix: `/api/v4/flightdeck-pg`

Workroom routes:

- `GET /workspaces/:workspaceId/workrooms`
- `POST /workspaces/:workspaceId/workrooms`
- `GET /workspaces/:workspaceId/workrooms/:workroomId`
- `PATCH /workspaces/:workspaceId/workrooms/:workroomId`
- `POST /workspaces/:workspaceId/workrooms/:workroomId/start`
- `POST /workspaces/:workspaceId/workrooms/:workroomId/archive`
- participant list/create/update routes
- event list/create routes
- link list/create routes
- `GET /workspaces/:workspaceId/workrooms/search`
- production merge approval request/list/get/decision routes

Expected behavior:

- Workrooms are created from an existing scope and channel.
- Scope/channel membership governs visibility.
- Starting a room posts the canonical workroom link to the current channel chat.
- Creation can succeed even if a participant could not be involved; record and display the failed access status.
- Workroom events are append-only product history.
- Production branch merge requires a human approval tied to workroom, repo, branch, and commit.

## Execution Order

Run these as separate packages in order. FD-02 depends on FD-01. FD-03 depends on FD-01 and benefits from FD-02. FD-04 depends on FD-03 approval surfaces.

## FD-01: Workroom Dexie Stores And API Client

Goal: materialize Tower workroom records locally and add API helpers for workroom operations.

Scope:

- Add Dexie stores for workrooms, workroom participants, workroom events, workroom links, and typed workroom approvals if current approval stores are insufficient.
- Add API client methods for Tower workroom routes.
- Add PG read hydrator handling for workroom visible events.
- Add selectors/helpers for:
  - current channel workrooms;
  - active workrooms;
  - archived workrooms;
  - workroom search;
  - pending workroom approvals.
- Keep payload normalization explicit and close to existing PG client/hydrator patterns.

Acceptance:

- Unit tests cover API helper URL/payload behavior where practical.
- Unit tests cover hydration/local store updates for workroom records and event/link records.
- Workroom events can update local state without requiring a full page reload.
- `bun run build` passes.

Report:

- Commit the completed package.
- Report commit SHA, files touched, tests run, and any Tower contract gaps to the wm21 manager session.

## FD-02: Native Workroom Creation Flow

Goal: build the native Flight Deck create-room flow from an existing scope/channel.

Scope:

- Add a Workroom entry point in the current scope/channel UI.
- Creation fields:
  - title;
  - goal;
  - participants and roles;
  - integration Autopilot;
  - GitHub repo;
  - integration branch;
  - production branch;
  - preview app target;
  - production app target;
  - approval policy;
  - save choices as channel defaults.
- Apply channel defaults and allow per-room overrides.
- Start the room and show the canonical chat announcement from Tower.
- Show warning state if an intended participant could not be involved because access failed.

Acceptance:

- User can create a workroom from the current channel/scope.
- Current channel chat receives or displays the canonical room link after start.
- Channel defaults can be saved and reused.
- `bun run build` passes.

Report:

- Commit the completed package.
- Report commit SHA, files touched, tests run, screenshots or manual check notes, and any Tower contract gaps.

## FD-03: Native Workroom Detail And Archive View

Goal: implement the main workroom surface and archive.

Scope:

- Detail header with title, goal, status, integration Autopilot, repo, branches, preview URL, and production URL.
- Participants and roles panel.
- PR queue and external links panel.
- Files/docs/test-data/artifacts panel.
- Events/archive timeline with filters by actor, PR, task, artifact, deploy, decision, blocker, and date.
- Approval panel placeholder or integration point for FD-04.
- Blockers and access warnings.
- Archived/completed rooms discoverable from chat thread, workroom views, and command palette.

Acceptance:

- User can review room history from initial goal through deploy evidence.
- Search/command palette can find rooms by title, goal, repo, participant, PR, task/doc/file/artifact, URL, and status.
- `bun run build` passes.

Report:

- Commit the completed package.
- Report commit SHA, files touched, tests run, screenshots or manual check notes, and any Tower contract gaps.

## FD-04: Production Merge Approval UX

Goal: expose production merge approvals in the workroom UI with clear human language.

Scope:

- Render approval requests as "Approve production merge".
- Show repo, from branch, production branch, commit, preview URL, integration Autopilot, and validation evidence.
- Provide approve, reject, and needs-changes controls if the Tower decision contract supports all three; otherwise use approve/reject and record needs-changes as a note/gap.
- Write decision note and update workroom timeline.
- Do not let non-approvers approve in UI; surface disabled/error state clearly.

Acceptance:

- Human approver can understand exactly what branch/commit is being approved.
- Non-approvers cannot approve in the UI.
- Decision appears in the workroom timeline.
- `bun run build` passes.

Report:

- Commit the completed package.
- Report commit SHA, files touched, tests run, screenshots or manual check notes, and any Tower contract gaps.
