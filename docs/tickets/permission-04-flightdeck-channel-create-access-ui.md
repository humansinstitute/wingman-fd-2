# Permission 04: Flight Deck channel creation access UI

## Pipeline scope

Update Flight Deck so channel creation uses the simplified permission model and sends initial grants to Tower.

## Primary repo

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

When creating a channel, the user chooses who can access it and at what level.

The UI should express this as:

- group or person
- `View`, `Contribute`, or `Manage`

## Required behavior

- Add channel creation UI for access rows.
- Allow each access row to target a group or an individual workspace member.
- Allow each access row to select `View`, `Contribute`, or `Manage`.
- Send initial grants to Tower when creating the channel.
- Prefer a simple default for normal channels: `Workspace` with `View`, plus creator with `Manage`, unless product code already specifies a stricter default.
- For one-to-one DM/specialist channel creation, expect Tower to grant `Manage` to both participants and render that outcome.
- Do not expose low-level permission scopes in the normal channel creation UI.

## Guardrails

- Do not implement access at scope level.
- Do not infer whether a member is human or agent.
- Do not rely on workspace-management APIs just to render channel participants or sender names.
- Do not edit `dist/index.html` directly; edit source and run the build if UI/source changes are made.

## Acceptance criteria

- Channel creation presents access rows in plain language.
- Channel creation sends group/person access levels to Tower.
- Created channels are visible to granted users after sync.
- DM creation does not require the creator to manually add the other participant as manager.
- UI copy clearly separates groups from access levels.

## Validation

- Add or update relevant Flight Deck unit/integration tests if existing coverage is available.
- Run `bun run build` after source changes and include rebuilt `dist/`.
- Note whether a browser/manual pass is still needed.
