# Workroom creation visible people fix

## Context

Pete reports that the Workroom Creation modal still shows no people:

> No visible channel members. Add people through channel or scope membership, then reopen workroom creation.

At minimum Pete and Rick should appear when the room is started from a channel they can both see.

The browser console also shows repeated NIP-98 signing timeouts while Flight Deck refreshes PG records after SSE events, for example:

- `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/scopes/:scopeId/channels?limit=100`
- `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/channels/:channelId/docs?limit=200`
- `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/channels/:channelId/messages?limit=200`
- `GET /api/v4/flightdeck-pg/workspaces/:workspaceId/tasks/:taskId`

This timeout pressure may make local channel/member/grant state stale, but the roster bug exists independently: the current roster path only sees a narrow subset of channel visibility data.

## Current diagnosis

Relevant files:

- `src/workroom-creation-manager.js`
- `src/app.js`
- `src/channels-manager.js`
- `src/pg-read-hydrator.js`
- `tests/workroom-creation-manager.test.js`
- `tests/channels-manager.test.js`

Current behavior:

- `openWorkroomCreation()` builds `form.participants` from `channelParticipantFormRows(channel, this.getChannelParticipants, this.getSenderName)`.
- `getChannelParticipants(channel)` currently reads only `channel.participant_npubs` and expands `channel.group_ids` through `this.groups`.
- `mapPgChannelToLocal()` only maps `participant_npubs` and `group_ids` if Tower PG returns them directly.
- `materializeSelectedDmParticipantsFromChannelGrants()` derives participants from channel grants only for DM channels.
- Normal PG channels can be visible through actor grants, group grants, workspace/scope membership, or cached workspace member data, but Workroom Creation may still see an empty participant list.

## Goal

Fix Workroom Creation so the People list represents the people who can see the selected scope/channel, not just `participant_npubs`.

## Required behavior

- When opening the modal from a PG channel, include a deduped participant list from:
  - direct `channel.participant_npubs`
  - `channel.group_ids` expanded through known groups
  - selected channel grant rows where the principal is an actor
  - selected channel grant rows where the principal is a group, expanded through known workspace/current groups
  - any directly available current workspace/channel member data already loaded by Flight Deck
  - current viewer/session npub fallback so Pete always appears
- Preserve Pete's model: no secondary workroom-specific group membership system. The workroom should inherit scope/channel visibility, and the modal only assigns workroom roles.
- Keep everyone as `contributor` by default unless channel/workroom defaults explicitly say otherwise.
- The integrator is selected by changing one visible channel member's role to `integration`.
- If data is still incomplete because PG grant/member reads fail, show the current viewer at minimum and make the empty/error state accurate.
- Avoid starting or restarting Flight Deck servers.

## NIP-98/SSE timeout handling

Inspect whether Workroom Creation itself is causing extra signed reads or whether it is only suffering from the existing SSE refresh storm.

If a small, safe mitigation is obvious in Flight Deck, implement it. Examples:

- avoid triggering duplicate member/grant refreshes when the same selected channel data is already in-flight
- use cached grant/member data for opening the modal instead of blocking on a signed read

Do not attempt a broad SSE auth queue redesign in this job. If the signing timeout issue needs a separate Tower/Flight Deck job, document the specific follow-up.

## Tests

Add or update tests covering:

- a non-DM PG channel with actor grant rows populates Workroom Creation participants
- group grant rows expand to member npubs when group membership is available
- current viewer/session npub is included as a fallback when no channel participants are locally visible
- existing direct `participant_npubs` behavior still works

Run:

```bash
bun run test
bun run build
```

Include regenerated `dist/` output in the same commit if the build changes it.

## Git/worktree rules

- Work in `/Users/mini/code/wingmanbefree/wm-fd-2`.
- Use Codex only.
- Preserve concurrent work. Do not reset, revert, force push, or discard changes you did not make.
- Default to `main`.
- Commit all nonignored tested state needed for this fix, including generated `dist/` if changed.
- Do not start a Vite/dev server unless Pete explicitly asks.

## Reporting

When complete, report:

- what changed
- validation commands and results
- commit hash
- any separate follow-up needed for the NIP-98/SSE timeout storm

## Follow-up items not in this job unless trivially adjacent

Pete also raised these next items:

1. After successful workroom creation, the modal currently stays open. It should close or transition cleanly to the created workroom/announcement result.
2. A workroom should become a real Flight Deck view. It should have a chat thread represented as replies to the chat message that announced the room, so room users can issue commands and do work in that thread.

These should be treated as follow-up work unless they are tiny and naturally touched by this fix.
