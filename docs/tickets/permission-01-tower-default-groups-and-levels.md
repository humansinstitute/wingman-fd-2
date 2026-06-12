# Permission 01: Tower default groups and access levels

## Pipeline scope

Implement the Tower-side foundation for the simplified Flight Deck permission model.

## Primary repo

`/Users/mini/code/wingmanbefree/wingman-tower`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

Tower must treat groups as audiences and access levels as capabilities.

The default groups are:

- `Admins`
- `Agents`
- `People`
- `Workspace`

Every workspace member belongs to `Workspace` automatically. `Agents` and `People` are manually managed by workspace managers; do not infer human vs agent.

## Required behavior

- Create the four default groups for every new Flight Deck PG workspace.
- Ensure `Workspace` contains every workspace member automatically.
- Ensure the workspace owner/admin is in `Admins`.
- Do not automatically place members into `Agents` or `People`.
- Define canonical access levels: `view`, `contribute`, `manage`.
- Centralize the mapping from access level to permission bundle so channel grants can reuse it.
- Preserve existing custom permission bundles instead of deleting or rewriting them.

## Access level mapping

`view` grants:

- `channel.read`
- `task.read`
- `doc.read`
- `file.read`
- `audio_note.read`

`contribute` grants everything in `view`, plus:

- `channel.write`
- `task.create`
- `task.update`
- `task.comment`
- `comment.create`
- `doc.write`
- `file.write`
- `audio_note.write`

`manage` grants everything in `contribute`, plus:

- `channel.manage`
- `channel.grants.read`
- `channel.grants.manage`

## Guardrails

- Do not rename existing database objects unless migration coverage is included.
- Do not delete existing groups or grants.
- Do not make `Agents` or `People` automatic classification groups.
- Do not apply permissions at scope level for normal channel visibility.

## Acceptance criteria

- New workspaces receive all four default groups.
- Adding a workspace member automatically makes them a member of `Workspace`.
- Workspace owner/admin is in `Admins`.
- Access level to permission bundle mapping is tested.
- Existing custom grants remain valid.

## Validation

- Add or update Tower tests for default group creation.
- Add or update Tower tests for `Workspace` membership backfill/assignment.
- Add or update Tower tests for access-level expansion.
