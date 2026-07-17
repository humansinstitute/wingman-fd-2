# Workroom Thread-First Follow-Up Dispatch

Date: 2026-07-17
Repo: `/Users/mini/code/wingmanbefree/wm-fd-2`

## Current State

The thread-first workroom redesign has landed in:

- `e4261f7` - `Redesign workrooms around canonical chat threads`
- `6741e6f` - `Move workroom delivery metadata into room details`

Validation already run by the review worker:

- Focused tests: 133 passed
- Full suite: 2,463 passed across 171 files
- `bun run build`: passed
- Worktree was clean after `6741e6f`

## Product Model To Preserve

- Route remains `/workroom/:workroomId`.
- `workroomId` resolves the workroom record.
- The workroom record resolves directly to the canonical top-level chat message/thread created by the announcement.
- The workroom page is a specialist full-page UI over that one chat thread.
- Every message sent in the workroom must be a literal reply in the canonical chat thread.
- Replies sent from the normal chat thread must appear in the workroom.
- Docs/tasks/links/PRs/history/approvals are contextual cards around the same thread, in the same scope/channel.
- Metadata and low-level delivery configuration belong in `Room Details`, not the main thread surface.

## Follow-Up Issues From Review

1. The workroom composer is still a reduced custom composer at `index.html:5038`.
   It should behave like the normal thread composer as far as practical, especially for `@` mentions and existing chat affordances. If full reuse is too risky, extract or share the missing composer behavior rather than duplicating divergent logic.

2. Mention lookup works broadly, but candidate sourcing is not explicitly scoped to channel/scope-visible participants.
   Review reference: `src/app.js:7612-7851`.
   The workroom composer should typeahead people who can see the current scope/channel/workroom. It must include members brought in through channel assignment and assigned groups, such as Rick through the agents group.

3. Workroom thread rendering remains custom.
   Review reference: `src/workroom-detail-manager.js:207-210, 383-386`.
   It should reuse the normal thread rendering path where practical, or share the same normalized message model and card rendering so thread replies, task/doc/link cards, and command outputs do not diverge between chat and workroom views.

## Required Deliverable

Implement a focused follow-up that closes these gaps without broad unrelated refactors.

Acceptance:

- `@` mention typeahead opens in the workroom composer and includes current channel/scope-visible people, including users visible through groups.
- Sending from the workroom still posts a real reply to the canonical chat thread.
- Replies from the normal thread still hydrate into the workroom page after navigation away and back.
- Workroom thread display uses shared chat/thread rendering behavior where practical, especially for cards/updates.
- Delivery metadata remains behind `Room Details`.
- Build output in `dist/` is regenerated if source/template/CSS changes.

## Validation

Run:

```bash
bun run test -- tests/workroom-detail-manager.test.js tests/mention-channel.test.js tests/chat-message-manager.test.js tests/chat-thread-flow-dispatch.test.js
bun run test
bun run build
```

Add or update focused tests for the specific follow-up changes.

## Git

- Work on `main`.
- Preserve concurrent work.
- Do not reset, rebase, or force-push.
- Commit all nonignored tested state when complete.
- Final report should include commit SHA, validation commands/results, and any remaining gaps.
