# Workroom Thread-First Redesign Dispatch

Date: 2026-07-17
Repo: `/Users/mini/code/wingmanbefree/wm-fd-2`
Requester: Pete

## Goal

Refactor the Flight Deck workroom page so a workroom is a specialist UI around one canonical chat thread, not a separate thread-like panel plus metadata grid.

The route should remain `/workroom/:workroomId`. The `workroomId` resolves the workroom record, and the workroom record must resolve directly to the canonical top-level chat message/thread created when the workroom was announced.

Dogfood workroom URL:

```text
https://near-tea-crab.rick.runwingman.com/pete/workroom/0ac7d368-47dc-4e4b-af88-fa27e66a5e8e?workspacekey=pg%3Anpub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy%3A%3Atower%3Anpub1vf3h0rmlrr0x6pjc68jcrk5p2zsfzl3f9zwcppcdn8386npdlxgqmam99v%3A%3Aworkspace%3Anpub1995l838tl29llpxwvpdv6hc66cttrt6hrr8xyeq7kmdqevkeyk0qwvfxlc%3A%3Aapp%3Anpub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5&scopeid=__pg_channel__%3A1b27d26f-ccdb-42fa-b27b-d33fa441dead
```

Mockup reference image:

```text
/Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy/codex/858151cb-6ae9-4539-bbef-de0ac1d7fff9.png
```

## Product Model

Pete's corrected model:

1. A workroom instance is effectively a chat thread with extra context, metadata, and display.
2. Creating a workroom must always produce or associate a top-level chat message in one scope and one channel.
3. That top-level chat message is the canonical thread anchor. Internally Tower may also have a PG thread id; product/UI logic should still resolve through the root chat message.
4. Any chat sent in the workroom is a literal reply in that chat thread.
5. Any reply sent from the normal chat thread must appear in the workroom.
6. The workroom is a specialist UI for shared work around that thread.
7. Docs, tasks, PRs, approvals, artifacts, and deployment evidence should be created in the workroom scope/channel and displayed as cards/updates related to the thread.
8. The chat thread is the focus and point of control for the room.
9. Metadata and low-level configuration should move out of the main view into a Room Details modal.
10. The page can scroll; panels such as History should grow to a reasonable size and then scroll internally.

## Required UI Shape

Use the mockup as the layout guide:

- Page title: `Workroom: <title>`.
- Left/main column: real chat thread UI.
  - Show root message and replies using the same visual affordances as normal chat thread where practical.
  - Composer must be the real thread composer. `@` mentions must typeahead correctly.
  - Sending from the workroom must create a normal thread reply.
  - Sending from the normal chat thread must show in the workroom.
- Right column: derived workroom panels.
  - Team/roles.
  - Branches/app targets.
  - History as a compact operational card; it should expand to a reasonable size then scroll.
  - Docs cards.
  - Tasks cards.
  - Later PRs/approvals/deployments if already available in linked records.
- Header actions:
  - `Room Details` opens a modal with repo, branches, app targets, approval policy, raw metadata/history diagnostics, and any low-level details removed from the main page.
  - `Archive` archives the workroom.
  - Overflow menu can hold copy link/diagnostics if useful.

## Bugs To Fix As Part Of This

- `@` mention typeahead does not open in the workroom composer.
- Workroom thread appears lost after navigating back to Deck and then opening the workroom again.
- Workroom loading feels too slow; avoid full-channel hydration when the target thread id is known. Fetch/merge only the canonical thread where possible.

## Technical Notes

- Start by inspecting current `index.html`, `src/workroom-detail-manager.js`, `src/chat-message-manager.js`, `src/app.js`, `src/pg-read-hydrator.js`, `src/api.js`, and tests.
- Preserve the route as `/workroom/:workroomId`.
- Use existing workroom metadata fields such as `announcement_message_id`, `announcement_thread_id`, and `announcement_channel_id`, but make the root chat message the canonical UI anchor.
- Do not create a parallel workroom-only chat model.
- Reuse existing chat thread rendering/composer logic where practical.
- If current Tower APIs are insufficient, keep the Flight Deck implementation clean and document the exact Tower route gap. Do not add broad cross-repo changes unless unavoidable.
- Do not restart Flight Deck, Autopilot, or Tower. Build only.

## Validation

Required:

```bash
bun run test -- tests/workroom-detail-manager.test.js tests/mention-channel.test.js tests/chat-message-manager.test.js
bun run test
bun run build
```

Add or update focused tests for:

- Workroom resolves and restores the canonical thread after navigation/reopen.
- Workroom composer uses mention typeahead.
- Workroom thread messages are real chat replies.
- Derived docs/tasks panel logic if new helpers are added.

## Git And Handoff

- Work on `main`.
- Preserve concurrent user/agent changes.
- Commit all nonignored tested state when complete.
- Do not leave required generated `dist/` changes uncommitted.
- Final response should include commit SHA, validation commands/results, what changed, and any remaining Tower/API gaps.
