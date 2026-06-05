# Wingman Apps Flight Deck Design

## Goal

Flight Deck should display Wingman Apps, or WApps, published by Autopilot. A WApp is a launchable, single-purpose app assigned to a workspace scope. Flight Deck is responsible for encrypted discovery, local Dexie storage, filtering by workspace/scope, and opening the WApp link in a new browser tab.

Autopilot owns runtime, app process management, allowlist derivation, and WApp publication. Flight Deck owns the user-facing catalog.

## Product Rules

- WApps are Nostr-authenticated at the WApp server.
- A visible WApp record is only a launcher entry. Autopilot must also have registered the underlying runtime app through the Wingman app CLI/API before publishing the record.
- Flight Deck does not authenticate the WApp user for MVP.
- Flight Deck does not perform a handoff token flow for MVP.
- Flight Deck shows WApps the user can decrypt from workspace records.
- Clicking a WApp opens its launch URL in a new browser tab.
- WApps should be shown in the relevant workspace and scope context.

## Record Family

Add a first-class Flight Deck record family:

```txt
collection_space: wapp
record_family_hash: `${APP_NPUB}:wapp`
schema_version: 1
```

Payload shape:

```ts
{
  app_namespace: APP_NPUB,
  collection_space: 'wapp',
  schema_version: 1,
  record_id: string,
  data: {
    title: string;
    description?: string;
    owner_npub: string;
    wapp_id: string;
    app_id: string;
    launch_url: string;
    source_wingman_url?: string | null;
    workspace_owner_npub: string;
    scope_id: string;
    scope_l1_id?: string | null;
    scope_l2_id?: string | null;
    scope_l3_id?: string | null;
    scope_l4_id?: string | null;
    scope_l5_id?: string | null;
    record_state: 'active' | 'archived';
  }
}
```

The WApp record should be encrypted to the selected scope groups by Autopilot. Flight Deck should rely on the existing group/owner decrypt path.

`data.app_id` must be the canonical registered Wingman app id returned by the app registration flow. Flight Deck should not assume that `launch_url` is routable just because the WApp record decrypts; missing app registration or alias registration is an Autopilot-side publish/runtime error.

## Dexie Storage

Add a `wapps` workspace store with useful indexes:

```js
wapps: 'record_id, owner_npub, workspace_owner_npub, scope_id, scope_l1_id, scope_l2_id, scope_l3_id, scope_l4_id, scope_l5_id, updated_at'
```

The stored row should include:

```js
{
  record_id,
  owner_npub,
  title,
  description,
  wapp_id,
  app_id,
  launch_url,
  source_wingman_url,
  workspace_owner_npub,
  scope_id,
  scope_l1_id,
  scope_l2_id,
  scope_l3_id,
  scope_l4_id,
  scope_l5_id,
  group_ids,
  sync_status,
  record_state,
  version,
  created_at,
  updated_at
}
```

Add helpers in `src/db.js`:

- `upsertWapp(wapp)`
- `getWappsByOwner(ownerNpub)`
- `getWappById(recordId)`
- `getRecentWappChangesSince(sinceIso, options)`

## Translators

Add:

```txt
src/translators/wapps.js
```

Exports:

- `recordFamilyHash(collectionSpace)`
- `inboundWapp(record)`
- `outboundWapp(input)` if Flight Deck later needs to create/update WApp records

The inbound translator should:

1. Decrypt with `decryptRecordPayload`.
2. Read `payload.data`.
3. Normalize URLs and strings.
4. Preserve scope lineage fields.
5. Set `record_state` default to `active`.
6. Extract `group_ids` from `record.group_payloads`.

## Sync Integration

Update:

```txt
src/sync-families.js
src/worker/sync-worker.js
src/generated/flightdeck-schema-bundle.js or schema source generation path
```

WApps should participate in normal sync windows and pending write conventions. For MVP, WApps are expected to be published by Autopilot, so Flight Deck does not need a create/edit form.

## UI Surface

Add a WApps launcher surface that is Dexie-first.

Recommended files:

```txt
src/wapps-manager.js
src/ui/views or existing app shell template section
```

Behavior:

- Load WApps from Dexie live queries.
- Filter out `record_state === 'archived'`.
- Filter by active workspace.
- When a scope is selected, show WApps assigned to that scope or optionally inherited from ancestor scopes if the UI pattern supports it.
- Render compact cards or rows with title, description, scope breadcrumb, and an open action.
- Open `launch_url` in a new tab with `rel="noopener noreferrer"`.

Do not display WApps directly from raw API responses.

## Accessibility

Follow the Peekaboo-friendly design requirements:

- Semantic region or nav placement for the WApps launcher.
- `aria-label` on open buttons and menus.
- `data-testid` on key WApp list, card, and open actions.
- `aria-live` status for sync or empty states if needed.

## App Schema Bundle

Add the WApp schema to the Flight Deck schema publishing source so `app_schema` manifests include the new `wapp` family. If generated files are updated, keep them consistent with the repo's current schema generation process.

## Acceptance Criteria

- Flight Deck sync recognizes the `wapp` record family.
- WApp records decrypt and materialize into Dexie.
- WApps appear from Dexie-backed state, not direct API results.
- Published WApp records carry a real registered Wingman app id from Autopilot.
- WApps are filtered by workspace and scope.
- Clicking a WApp opens `launch_url` in a new tab.
- Archived WApps are hidden.
- The schema bundle includes the `wapp` family.
- Tests cover the translator, sync materialization, DB helpers, and UI filtering.
- Existing sync families and current dirty work are preserved.

## Non-Goals

- Do not implement WApp runtime or SQLite management in Flight Deck.
- Do not add Flight Deck auth handoff.
- Do not require NIP-98 for WApp launch.
- Do not create or edit WApps from Flight Deck in the MVP.
