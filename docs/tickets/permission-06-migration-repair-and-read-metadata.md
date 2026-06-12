# Permission 06: Migration, repair, and read-safe metadata

## Pipeline scope

Implement migration and repair behavior for existing workspaces, plus read-side metadata needed by non-owner users.

## Primary repo

`/Users/mini/code/wingmanbefree/wingman-tower`

## Related repo

`/Users/mini/code/wingmanbefree/wm-fd-2`

## Design reference

`/Users/mini/code/wingmanbefree/wm-fd-2/docs/permission.md`

## Goal

Existing workspaces should be repaired into the simplified model without losing grants or requiring non-owner users to have workspace-management permission just to render chats.

## Required behavior

- Backfill the four default groups: `Admins`, `Agents`, `People`, `Workspace`.
- Add all current workspace members to `Workspace`.
- Add owner/admin users to `Admins`.
- Do not auto-add users to `Agents` or `People`.
- Preserve all existing groups and grants.
- For existing one-to-one DMs, ensure both participants have `manage` access.
- Identify exact standard bundles as `view`, `contribute`, or `manage`.
- Preserve non-standard bundles as custom.
- Ensure read endpoints used by normal channel rendering include required actor/sender/principal metadata.
- Normal read/render paths must not require `workspace.manage`.
- Update Flight Deck read hydration only if Tower response shape changes or if local rendering still depends on management-only endpoints.

## Guardrails

- Do not delete legacy grants.
- Do not collapse existing groups into the new defaults.
- Do not rely on Chrome/Firefox local cache differences as the fix.
- Do not paper over missing metadata in Flight Deck if Tower can provide it directly.

## Acceptance criteria

- Existing workspace members all become members of `Workspace`.
- Existing DM participants both receive `manage` where missing.
- Existing custom grants survive migration.
- Non-owner users can render sender names/avatars in accessible channels without `workspace.manage`.
- Repair/migration can be run safely more than once.

## Validation

- Add or update Tower migration/repair tests.
- Add or update Tower read endpoint tests for non-owner rendering metadata.
- If Flight Deck changes are needed, run `bun run build` in Flight Deck and include rebuilt `dist/`.
