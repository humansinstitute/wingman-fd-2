# Workroom Creation UI Handoff

## Context

Pete reviewed the native workroom creation modal after the first Flight Deck workroom UI pass and wants it to become a proper setup surface rather than a compact raw-data form.

Screenshot references from the report:

- `/Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy/codex/a06b3516-c69f-4de2-a2b1-9d432b8b9329.png`
- `/Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy/codex/9a92d1df-efc1-4436-bd72-12d95e3ae204.png`
- `/Users/mini/code/wingmanbefree/autopilot/tmp/uploads/images/npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy/codex/b4975b2c-0c80-44ea-a51f-4a40cd750757.png`

Current implementation:

- `index.html` has `.workroom-create-modal` around the workroom creation dialog.
- `src/workroom-creation-manager.js` owns form defaults, payload building, creation, and start.
- `src/styles.css` owns `.workroom-create-*` modal styling.
- `tests/workroom-creation-manager.test.js` covers payload/default helpers.

## User Requirements

1. Modal should be bigger, around 80% viewport width on desktop.
2. Modal padding/spacing needs to be fixed.
3. Selecting an integration Autopilot should be a typeahead lookup of users in the current scope/channel.
4. Repository should be selected from previously used repos, or from the default saved on this scope/channel if present.
5. The user should not manually enter both URL and `org/repo`; infer one from the other.
6. Branches should default by convention:
   - integration: `staging`
   - production: `deployed`
7. Remaining npub entry sections should use typeahead lookups, not raw npub-only inputs.
8. App targets should be selected from available app cards on the integration Autopilot.
9. Prefill participants from the current channel membership when starting the room.
10. Everyone from the channel should default to `contributor`.
11. Use this same participant/channel membership model for selecting the integration Autopilot: the integrator must already be in the channel to work.

## Implementation Direction

### Layout

- Widen `.workroom-create-modal` to roughly `width: min(80vw, 1180px)` with sensible mobile fallback.
- Give the modal body real internal padding and section spacing.
- Prefer clear sections:
  - Workroom
  - People
  - Repository
  - App targets
  - Approval/defaults
- Keep controls dense enough for an operational setup modal. Do not make it a marketing/hero layout.

### People and Integration

- On `openWorkroomCreation()`, derive participants from the selected channel using `this.getChannelParticipants(this.selectedChannel)`.
- Prefill `workroomCreationForm.participants` with those channel member npubs, all role `contributor`, labels from `getSenderName`.
- If there are no channel participants, keep one empty contributor row as fallback.
- Integration Autopilot selection must use the same channel participant pool. The user should search by name/npub and select one participant.
- When a participant is selected as integration, make sure they are present in the participants list and set their role to `integration`.
- Participant rows should also use typeahead lookup against channel participants/address book/scope members rather than raw npub-only input.
- Reuse existing people suggestion conventions where practical:
  - `findPeopleSuggestions`
  - `taskAssigneeSuggestions`
  - `getSenderName`
  - `getSenderSecondaryLabel`
  - `getSenderAvatar`
  - `getChannelParticipants`

### Repo Selection

- Replace the separate raw `GitHub repo URL` and `Repo name` entry experience with one repo selector/input.
- Source suggestions from:
  - current channel `metadata.workroom_defaults`;
  - existing `workrooms` in the same channel/scope;
  - any global workroom rows already loaded that have `repo.url` or `repo.name`.
- Selecting a repo should populate both `repo_name` and `repo_url`.
- If a typed value is needed as fallback:
  - `https://github.com/org/repo` should infer `repo_name = org/repo`;
  - `org/repo` should infer `repo_url = https://github.com/org/repo`;
  - avoid making the user fill both fields.

### Branches

- Change `createWorkroomForm()` defaults:
  - `integration_branch: 'staging'`
  - `production_branch: 'deployed'`
- Channel defaults may still override these if explicitly saved.
- The UI may keep branches editable, but should present them as conventional defaults rather than empty/manual setup.

### App Targets

- Replace raw preview/production app target text fields with selectors from available app cards.
- Use existing Flight Deck app-card/WApp state first:
  - `visiblePersonalWapps`
  - `wapps`
  - `launch_url`
  - `title`
- If the codebase already has a route/helper to query app cards from the selected integration Autopilot, use it. If not, implement the selector from the currently known app-card/WApp rows and leave a concise TODO/comment or final note that true remote integration-autopilot app-card discovery needs a backend/API bridge.
- Selecting an app target should store a useful stable value in the existing `app_targets.preview` / `app_targets.production` payload fields. Prefer launch URL or record id consistently with existing Workroom display behavior.

### Defaults

- Preserve the "Save these integration choices as channel defaults" behavior.
- Saved defaults should include repo/app/branch/integration choices, but avoid saving stale per-run participant rows unless that is already intended by the current helper.

## Acceptance

- Opening the modal from a channel prepopulates all channel members as contributor participants.
- Integration Autopilot is selected from channel members via typeahead, not typed as a raw npub.
- Participant npub entries use typeahead lookup.
- Repo selection can be made from prior/default repos and keeps URL/name inferred.
- Branch defaults are `staging` and `deployed`.
- App targets are selected from available app-card/WApp records, not raw text-first fields.
- Modal is materially wider and spacing/padding is clean at desktop width and still usable on mobile.
- Existing workroom create/start payloads remain compatible with Tower.
- Add or update tests around defaults, repo inference, channel participant prefill, and payload mapping.
- Run focused tests, `bun run test`, and `bun run build`.
- Commit all tested source and generated `dist/` output.

## Constraints

- Work on `main`.
- Preserve concurrent changes. Do not reset, force checkout, or discard unknown files.
- Use Codex only. Do not launch Claude.
- Do not restart Flight Deck, Tower, or Autopilot processes unless Pete explicitly approves in the active conversation.
- Keep the implementation in `wm-fd-2` unless a real Tower/Autopilot API gap is proven.
