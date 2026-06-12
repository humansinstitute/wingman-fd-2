# Permission 05: Flight Deck channel settings access editor

## Pipeline scope

Add or update Flight Deck UI for editing channel access after channel creation.

## Primary repo

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

Channel managers must be able to edit group and person permissions on a channel after creation.

## Required behavior

- Add a channel settings access editor or update the existing settings surface.
- List current grants with principal type, principal name, and access level.
- Allow managers to add a group grant.
- Allow managers to add a person grant.
- Allow managers to change an existing grant between `View`, `Contribute`, and `Manage`.
- Allow managers to remove a grant.
- Show legacy/custom grants clearly without silently converting them.
- Disable or hide edit controls for users without `channel.grants.manage` or `channel.manage`.
- Keep group management copy clear: groups collect members; channel grants give those groups capabilities.

## Guardrails

- Do not expose low-level permission scopes in the primary editor.
- Do not delete or rewrite custom grants just because they do not match the standard bundles.
- Do not infer `People` or `Agents` membership.
- Do not edit `dist/index.html` directly; edit source and run the build if UI/source changes are made.

## Acceptance criteria

- Managers can view and edit channel access after creation.
- Non-managers cannot mutate channel access.
- Group/person grants are understandable in the UI.
- Custom grants are visible as custom and preserved.
- Access editor uses Tower grant APIs instead of local-only state.

## Validation

- Add or update relevant Flight Deck tests if existing coverage is available.
- Run `bun run build` after source changes and include rebuilt `dist/`.
- Note whether a browser/manual pass is still needed.
