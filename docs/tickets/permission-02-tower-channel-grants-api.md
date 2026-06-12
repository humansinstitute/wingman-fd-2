# Permission 02: Tower channel grants API

## Pipeline scope

Implement semantic channel access APIs in Tower so Flight Deck can grant access to groups or people by access level.

## Primary repo

`/Users/mini/code/wingmanbefree/wingman-tower`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

When creating or editing a channel, clients should specify:

- a principal type: `group` or `person`
- a principal id
- an access level: `view`, `contribute`, or `manage`

Tower expands that into the required low-level permissions and enforces access from those grants.

## Required behavior

- Add or update APIs for listing channel grants.
- Add or update APIs for creating channel grants.
- Add or update APIs for updating channel grant access level.
- Add or update APIs for removing channel grants.
- Support group grants and individual person grants.
- Return grant rows with principal metadata needed by Flight Deck UI.
- Return the semantic access level when the stored permission bundle exactly matches `view`, `contribute`, or `manage`.
- Return or label non-matching legacy/custom bundles as custom without destroying them.
- Support initial channel grants during channel creation in the same transaction as the channel record.

## Guardrails

- Do not require clients to manually submit low-level permission scopes for standard `view`, `contribute`, or `manage`.
- Do not break existing legacy grants.
- Do not require `scope.read` for seeing scopes that contain visible channels.
- Do not expose grants to users without `channel.grants.read` or `channel.manage`.

## Acceptance criteria

- Channel creation can include initial group/person access rows.
- Grant editing changes effective permissions immediately.
- Grant listing includes enough data for the UI to show group/person names and access level.
- Legacy/custom permission bundles remain readable and are not overwritten.
- Unauthorized users cannot list or mutate channel grants.

## Validation

- Add or update Tower API tests for create/list/update/delete channel grants.
- Add or update Tower API tests for initial grants on channel creation.
- Add or update Tower authorization tests for grant visibility and mutation.
