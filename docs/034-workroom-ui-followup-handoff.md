# Workroom UI Follow-Up Handoff

## Context

Pete reported four related gaps in the native Flight Deck workroom UI:

1. The workroom component can show a raw NIP-98 timeout on load:
   `NIP-98 signing timed out for GET https://sb4.otherstuff.studio/api/v4/flightdeck-pg/workspaces/2e5caefd-dd65-45d2-b747-ee874e8e5fc9/workrooms?limit=100`
2. Workrooms should move underneath the My Focus area for now.
3. Flight Deck needs UI controls to manually start a workroom.
4. Chat should not have a separate workroom strip. Starting a workroom should post a normal chat message with a card/link to the workroom.

The current implementation mounts the broad workroom browser before My Focus:

- `index.html`: `section.workroom-browser` around the status summary area, with `x-init="$store.chat.refreshWorkrooms()"`.

The chat view also mounts a separate channel strip:

- `index.html`: `section.chat-workroom-strip`, with `x-init="$store.chat.refreshWorkrooms({ channelId: $store.chat.selectedChannelId })"`.

Creation currently has only a combined flow:

- `src/workroom-creation-manager.js`: `createAndStartWorkroom()`.
- `index.html`: modal button labelled `Create and start`.

Workroom start already returns an announcement object used by the creation manager, so prefer rendering the existing chat announcement message before adding backend requirements.

## Goal

Implement the combined Flight Deck fix in one pass:

- resilient, quieter workroom loading;
- workroom browser below My Focus;
- no separate chat workroom strip;
- manual workroom start UI;
- started workrooms appear in chat as normal message cards with links.

## Required Changes

1. Move the workroom browser under the My Focus/daily scope area in the status page.
2. Remove or defer eager broad workroom refreshes that fire on page load.
3. Add an in-flight guard/debounce for workroom refreshes so repeated Alpine mounts do not stack signed GETs.
4. Make NIP-98 timeout errors non-blocking and quiet: keep the page usable and provide retry.
5. Remove `chat-workroom-strip` from chat.
6. Add a manual start action for draft/created workrooms, reusing `startTowerPgWorkroom`.
7. Split create-only from create-and-start if that gives the cleanest UX. At minimum, the UI must support manual start after creation.
8. Render workroom announcement messages as normal chat cards with a title, status, and open/link action. Use existing message metadata from Tower start responses where possible, especially `workroom_link` and `workroom_id`.
9. Keep source and built output aligned.

## Likely Files

- `index.html`
- `src/api.js`
- `src/workroom-detail-manager.js`
- `src/workroom-creation-manager.js`
- `src/styles.css`
- related tests under `tests/`
- regenerated `dist/`

## Constraints

- Work on `main`.
- Preserve concurrent user/agent changes. Do not reset, force checkout, or discard unknown files.
- Commit all nonignored tested state when complete.
- Do not restart Flight Deck, Tower, or Autopilot processes unless Pete explicitly approves a restart in the active conversation.
- Do not use Claude. Use Codex only.
- Keep this inside `wm-fd-2` unless a real Tower API defect is proven.

## Acceptance

- Loading My Focus does not immediately show a large red workroom NIP-98 timeout.
- Workrooms are visually underneath My Focus.
- Workroom refresh errors are quiet and retryable.
- A user can create a workroom draft and manually start it, or otherwise manually start a not-yet-started room.
- Starting a workroom posts/refreshes a normal chat message card with a link to the room.
- The separate "Workrooms in this channel" chat strip is gone.
- `bun run test` and `bun run build` pass, or any failure is documented with exact evidence.
- Final worker report includes changed files, validation, and commit hash.
