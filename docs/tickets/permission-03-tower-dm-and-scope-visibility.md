# Permission 03: Tower DM defaults and scope visibility

## Pipeline scope

Implement Tower behavior for DM channel defaults and scope visibility under the simplified permission model.

## Primary repo

`/Users/mini/code/wingmanbefree/wingman-tower`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

DMs are joint spaces, not owner-only spaces. Scopes are navigation containers, not permission containers.

## Required behavior

- When creating a one-to-one DM/specialist channel, grant `manage` access to both participants.
- Ensure both participants can read, write, and manage that DM channel.
- Ensure non-participant workspace members do not gain access unless explicitly granted.
- Make scope visibility derived from visible channels.
- A user sees a scope if they can see one or more channels inside that scope.
- A user does not need a direct `scope.read` grant to see a scope that contains a visible channel.
- Short-term rule: named-channel creation remains limited to workspace admins/managers unless an existing broader rule already permits it.
- DM exception: any workspace member can create a DM with any other existing workspace member. DM creation checks `workspace.read`, not scope `channel.create`.
- Both DM participants must already be workspace members; reject otherwise with `dm_participant_not_member` instead of auto-enrolling the counterpart.
- Provision the `DMs` scope (kind `dm`) for every workspace at setup/backfill so clients never need `scope.create` to start a DM.

## Guardrails

- Do not introduce scope-level permission as the normal visibility mechanism.
- Do not make workspace ownership the only way to render participant names or sender metadata.
- Do not make DMs asymmetric by default.

## Acceptance criteria

- Creating a one-to-one DM grants both participants `manage`.
- Both DM participants can list, read, write, and manage the DM.
- A non-owner participant can render the DM without needing workspace-management permissions.
- Scope lists include scopes that contain at least one visible channel.
- Empty or inaccessible scopes are hidden from users without explicit management access.

## Validation

- Add or update Tower tests for DM creation grants.
- Add or update Tower tests for non-owner participant access.
- Add or update Tower tests for scope visibility derived from channel visibility.
