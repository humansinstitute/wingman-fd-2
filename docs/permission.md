# Flight Deck Permissions

This document defines the target permission model for Flight Deck PG.

The goal is simple:

1. Add people to groups.
2. Create channels inside scopes.
3. Grant channel access to groups or individual people.
4. Let Tower automatically enforce that access.

Groups are audiences. Access levels are capabilities. Scopes are navigation
containers.

## Core Concepts

### Workspace Members

A workspace member is a person, agent, app, or service that has an actor record
in the workspace.

Every workspace member belongs to the `Workspace` group automatically.

Other group membership is managed by workspace admins. Tower must not guess
whether an actor is a human or an agent.

### Groups

Groups are buckets of workspace members. They do not grant channel access by
themselves.

Default groups:

- `Admins`
- `Agents`
- `People`
- `Workspace`

Meaning:

- `Admins`: workspace managers. Members can manage workspace membership, groups,
  channel access, and administrative settings.
- `Agents`: manually managed group for agent/bot actors.
- `People`: manually managed group for human actors.
- `Workspace`: automatic group containing every workspace member.

The `Workspace` group is useful for broad defaults such as `Workspace = View`
on a channel.

### Access Levels

Access levels are channel capabilities.

Use these names in the app:

- `View`
- `Contribute`
- `Manage`

Tower can still store concrete permission rows internally, but Flight Deck
should present channel access in these three levels.

### Channels

Channels are the source of truth for day-to-day access.

A user can see or use a channel only if they have a channel grant:

- directly as a person, or
- through a group they belong to.

### Scopes

Scopes are groupings for channels. They are navigation containers, not access
containers.

A scope is visible to a user when that user can see at least one channel inside
the scope.

Short-term rule: workspace admins/managers can create channels in scopes.

Future rule: a `Scope Manager` concept may allow a person to create channels in
one specific scope. That is not part of the simple model yet.

## Access Level Mapping

### View

Can read the channel and related read-only work.

Concrete permissions:

- `channel.read`
- `task.read`
- `doc.read`
- `file.read`
- `audio_note.read`

App meaning:

- Can open the channel.
- Can read messages, tasks, docs, files, and audio notes.
- Cannot post, edit, or manage access.

### Contribute

Can participate in normal work.

Concrete permissions:

- everything in `View`
- `channel.write`
- `task.create`
- `task.update`
- `task.comment`
- `comment.create`
- `doc.write`
- `file.write`
- `audio_note.write`

App meaning:

- Can post messages.
- Can create/update tasks.
- Can comment.
- Can create/update docs, files, and audio notes.
- Cannot manage channel access.

### Manage

Can participate and manage channel access.

Concrete permissions:

- everything in `Contribute`
- `channel.manage`
- `channel.grants.read`
- `channel.grants.manage`

App meaning:

- Can do normal channel work.
- Can edit channel settings.
- Can add, change, and remove channel access for people and groups.

### Daily Notes

Daily notes are personal, workspace-anchored records. They sit outside the
channel access levels:

- `daily_note.read` and `daily_note.write` are workspace permissions held by
  the default groups (`Admins`, `Agents`, `People`, `Workspace`), so every
  workspace member can read and write daily notes.
- Writes always target the caller's own notes; Tower pins the note owner to
  the authenticated actor.

### Member Directory

Every workspace member can read the slim member directory (`actor_id`,
`npub`, `display_name`, `kind`) with `workspace.read`. Membership management
fields are only returned to callers with `workspace.manage`. This is what
lets any member pick a DM target or a person grant without admin rights.

## How Access Is Assigned

### Adding A Workspace Member

When a member is added to a workspace:

- Tower creates or confirms their actor record.
- Tower adds them to the `Workspace` group.
- Workspace admins can manually add them to `Admins`, `Agents`, or `People`.

Tower does not infer whether the actor belongs in `Agents` or `People`.

### Creating A Channel

When creating a channel, Flight Deck should ask for access rows.

Each access row is:

```text
Group or person + access level
```

Examples:

```text
Workspace  View
Agents     Contribute
Pete       Manage
```

Rules:

- A normal channel should have at least one access row.
- Tower creates the channel and grants in one transaction.
- Group grants apply to current and future members of the group.
- Person grants apply only to that actor.

### Creating A DM

A DM is a specialist channel between two people.

Rules:

- Any workspace member can create a DM with any other workspace member.
- DM creation does not require `channel.create` on a scope; Tower checks
  `workspace.read` plus membership of both participants.
- Both DM participants must already be workspace members. Tower rejects a DM
  whose counterpart is not a member with `dm_participant_not_member`; admins
  add the person to the workspace first.
- Both DM participants get `Manage`.
- Both participants are direct person grants, created by Tower in the same
  transaction as the DM channel.
- Tower provisions the `DMs` scope (kind `dm`) for every workspace at setup,
  so clients never need `scope.create` to start a DM.

Plain language:

- Both sides jointly own the DM.
- Either side can post, work with related records, and manage access for that DM.

### Editing Channel Access

Channel settings needs an `Access` editor.

The editor should show rows like:

```text
Workspace  View
Agents     Contribute
Pete       Manage
```

Users with `Manage` on the channel can:

- add a group grant;
- add a person grant;
- change a grant's access level;
- remove a grant.

Changing the access level updates the concrete Tower permission rows.

### Editing Groups

Group editing manages membership only.

Group screen language should make this clear:

```text
Groups collect workspace members. They do not grant access by themselves.
Add a group to a channel's Access section to grant access.
```

The `Workspace` group is automatic and should not require manual membership
management.

## What Users Experience

If a user cannot see a channel:

- they do not have `View`, `Contribute`, or `Manage` on that channel;
- or they are not in a group that has access to that channel.

If a user can see a channel but cannot post:

- they have `View`;
- they need `Contribute` or `Manage`.

If a user can post but cannot change access:

- they have `Contribute`;
- they need `Manage`.

If a user cannot see a scope:

- they cannot see any channel inside that scope.

If a user is added to a group but still cannot see a channel:

- the group probably does not have a grant on that channel.

## Backend Rules

Tower authorization should check channel grants for channel work.

For each request, Tower resolves:

- signed actor npub;
- workspace membership;
- actor's effective group ids;
- direct actor grant or group grant on the channel.

Tower should not require scope grants to display scopes. Scope visibility should
be derived from visible channels.

Tower should not require workspace management endpoints for read-side rendering.
If a user can read a record, the read endpoint should include enough metadata to
display that record.

Examples:

- message responses include `sender_npub`;
- grant responses include group names and actor npubs where appropriate;
- channel responses include enough DM participant metadata to render the DM.

## Permission Grants Reference

This section describes how grants actually work in Tower, end to end.

### Anatomy Of A Grant

Every grant is one row in `flightdeck_pg_permission_grants`:

```text
principal (actor | group)  +  resource anchor  +  permission
```

- `principal_type` is `actor` (one person/agent) or `group` (current and
  future members of that group, including nested child groups).
- The resource anchor is `workspace`, `scope`, or `channel`. Each permission
  has exactly one valid anchor (see the catalog below); a channel permission
  is always granted against a specific channel, never "workspace-wide".
- Revoking a grant sets `revoked_at`; rows are never deleted, so history is
  preserved and a revoked grant can be re-issued.

### Permission Catalog

| Permission | Anchor | Meaning |
| --- | --- | --- |
| `workspace.read` | workspace | Read workspace metadata, own membership, and the slim member directory |
| `workspace.manage` | workspace | Manage members, groups, settings; see membership management fields |
| `workspace.invite` | workspace | Invite actors into the workspace |
| `scope.create` | workspace | Create scopes |
| `scope.read` | scope | Legacy direct scope visibility (normal visibility derives from channels) |
| `scope.manage` | scope | Edit or archive a scope |
| `channel.create` | scope | Create channels inside that scope (DMs are exempt, see below) |
| `channel.read` | channel | Open the channel and read messages/threads |
| `channel.write` | channel | Post messages |
| `channel.manage` | channel | Edit or archive the channel |
| `channel.grants.read` | channel | List the channel's access rows |
| `channel.grants.manage` | channel | Add, change, or remove access rows |
| `channel.grant` | channel | Legacy alias kept in the catalog; APIs check `channel.grants.manage` |
| `task.read` / `task.create` / `task.update` / `task.comment` | channel | Task work anchored to the channel |
| `comment.create` | channel | Channel and task comments |
| `doc.read` / `doc.write` | channel | Documents anchored to the channel |
| `file.read` / `file.write` | channel | Files anchored to the channel |
| `audio_note.read` / `audio_note.write` | channel | Audio notes anchored to the channel |
| `daily_note.read` / `daily_note.write` | workspace | Personal daily notes; writes always target the caller's own notes |

### How Tower Evaluates A Request

For every authenticated request Tower resolves, in order:

1. The signed npub (NIP-98) to an actor record.
2. The actor's workspace membership — non-members are rejected outright.
3. The actor's effective group ids, expanded recursively through nested
   child groups.
4. Whether an unrevoked grant exists for the required permission at the
   required anchor, either directly for the actor or for any effective group.

There is no permission hierarchy or implication. `workspace.manage` does not
imply `channel.write`; an Admin sees a private channel only if a grant says
so. Every check is a literal lookup of the one permission the endpoint
requires, and a failed check names that permission in the response.

Two deliberate exceptions to the literal-grant rule:

- Scope visibility derives from channels: a scope is listed when the actor
  holds `channel.read` on any channel inside it (or a legacy `scope.read`
  grant).
- DM creation checks `workspace.read` plus membership of both participants
  instead of scope `channel.create`.

### Where Grants Come From

Grants are written at these moments:

- **Workspace setup**: the four default groups receive workspace-anchored
  grants — `Admins`: `workspace.read`, `workspace.manage`,
  `workspace.invite`, `scope.create`, `daily_note.read`, `daily_note.write`;
  `Agents`, `People`, `Workspace`: `workspace.read`, `daily_note.read`,
  `daily_note.write`.
- **Scope creation**: the creating actor gets `scope.read`, `scope.manage`,
  and `channel.create` on the new scope, and the `Admins` group gets
  `channel.create` on it.
- **Channel creation**: the creator gets the full creator bundle (read,
  write, manage, grants, and all content permissions) on the channel, and
  each access row submitted with the channel becomes a grant in the same
  transaction.
- **DM creation**: both participants get direct person grants for the full
  `Manage` bundle in the same transaction as the channel.
- **Access editor**: users with `channel.grants.manage` add, change, or
  remove grants; changing an access level rewrites the concrete rows.

### Access Levels Are Stored As Concrete Rows

`View`, `Contribute`, and `Manage` are client-facing bundles. Tower expands
them into concrete permission rows on write and labels a grant by exact
bundle match on read. A grant whose rows match no standard bundle is labeled
`custom` and is never rewritten or deleted by migrations.

### Denial Responses

A failed authorization returns HTTP 403:

```json
{ "code": "permission_denied", "reason": "...", "required_permission": "channel.grants.manage" }
```

DM creation with a counterpart who is not a workspace member returns
`dm_participant_not_member`. Flight Deck translates `required_permission`
into access-level language ("You need Manage access on this channel…").

### Boot-Time Repair And Backfill

Tower re-runs an idempotent repair on every boot, so existing workspaces
converge on this model without manual migration:

- create missing default groups, add every member to `Workspace`, add
  owner/admin roles to `Admins`;
- write the default groups' workspace-anchored grants listed above;
- create the `DMs` scope for every workspace;
- grant `Admins` `channel.create` on every existing scope;
- grant channel creators their creator bundle on channels they created;
- backfill `participant_npubs` on DM channels from their Manage grants.

The repair never revokes anything: existing custom grants, legacy groups,
and channel access rows are preserved as-is. It also deliberately does not
add new channel-level grants to pre-existing channels (for example
`Workspace = View`), because that could expose channels that were intended
to stay private.

## Migration Notes

Existing workspaces may have older default groups:

- `Managers`
- `Viewers`
- `AIAgents`

Migration should not destroy those groups.

Repair/backfill should:

- create missing `Admins`, `Agents`, `People`, and `Workspace`;
- add all workspace members to `Workspace`;
- add workspace owner/admin actors to `Admins`;
- leave `Agents` and `People` manual unless already explicitly assigned;
- preserve existing channel grants;
- label exact permission bundles as `View`, `Contribute`, or `Manage`;
- label unknown bundles as `Custom`;
- repair existing DMs so both participants have `Manage` when participants can
  be identified.

## Implementation Checklist

- Define access-level mappings in Tower.
- Create/repair default groups.
- Auto-add every workspace member to `Workspace`.
- Make scope visibility derive from visible channels.
- Support channel creation with initial grants.
- Grant `Manage` to both DM participants.
- Add channel grant create/update/delete by access level.
- Add Flight Deck channel creation access rows.
- Add Flight Deck channel settings Access editor.
- Update group UI language.
- Remove read-side dependence on `workspace.manage` endpoints.

