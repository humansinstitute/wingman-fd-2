# Workroom People Membership Correction

## Context

Pete clarified that the current Workroom Creation people section is still wrong. It must not create a second access/member management model inside workrooms.

Workroom visibility and participation should follow the existing scope/channel access model:

- A workroom is started from a scope/channel.
- Everyone who can see the channel can see the workroom.
- The workroom modal should enumerate that existing visible membership.
- The only workroom-specific action is assigning a role to each existing member.

Current implementation after `8b3523a` still has a separate workroom membership UX:

- integration autopilot typeahead;
- participant typeahead rows;
- Add participant button;
- remove participant button;
- fallback address-book suggestions.

That should be removed.

## Required Behavior

1. On opening Workroom Creation, enumerate all members visible through the selected channel:
   - individually assigned channel participants;
   - members inherited through channel groups;
   - use the existing `getChannelParticipants(selectedChannel)` behavior unless a better local helper already exists.
2. Show these people by default in the People section.
3. Every listed person defaults to role `contributor`.
4. The user changes roles in that list.
5. Selecting the integration autopilot is done by setting that member's role to `integration`.
6. There must not be a separate add-person flow in the Workroom Creation modal.
7. There must not be a participant npub/typeahead field in the Workroom Creation modal.
8. There must not be a separate integration-autopilot typeahead/input.
9. The modal should tell the user to manage membership through channel/scope access if someone is missing.
10. Payload compatibility must remain:
    - `participants` contains the channel-derived members and their selected roles;
    - `integration_autopilot_npub` is the member with role `integration` if selected.

## UX Direction

Replace the People section with a roster/table:

- avatar or initials;
- display name;
- short npub/secondary identity;
- role select.

The role select should use existing `workroomRoleOptions`.

If multiple people are changed to `integration`, enforce one integration autopilot:

- either automatically downgrade the previous integration member to `contributor`;
- or prevent multiple integration roles.

Prefer the first option for simple UX.

If the channel has no visible members:

- show an empty state that says membership comes from channel/scope access;
- do not show an add-person input.

## Likely Files

- `index.html`
- `src/workroom-creation-manager.js`
- `src/styles.css`
- `tests/workroom-creation-manager.test.js`
- regenerated `dist/`

## Acceptance

- People section shows channel-derived roster immediately on modal open.
- No Add participant button.
- No participant npub/typeahead inputs.
- No integration autopilot typeahead/input.
- Role selection drives participant roles.
- Selecting `integration` on a member sets `integration_autopilot_npub`.
- Selecting `integration` on another member clears/downgrades the previous integration member.
- Workroom create payload includes only channel-derived participants with selected roles.
- Existing repo/app/branch improvements from `8b3523a` remain intact.
- Focused tests cover channel roster prefill and integration role selection.
- `bun run test` and `bun run build` pass.
- Commit all tested state.

## Constraints

- Work on `main`.
- Preserve concurrent changes. Do not reset, force checkout, or discard unknown files.
- Use Codex only. Do not launch Claude.
- Do not restart Flight Deck, Tower, or Autopilot.
- Keep this in `wm-fd-2` unless a real Tower API defect is proven.
