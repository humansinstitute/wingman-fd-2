# Legacy Coworker Identifier Compatibility Note

Status: inventory complete, no renames performed
Created: 2026-04-06
Task: FD As-Built Remediation 05

## Purpose

This document classifies every remaining `Coworker` identifier in the Flight Deck repo by rename safety so that follow-on rename work is not guesswork.

## Classification categories

| Category | Meaning | Can rename now? |
|---|---|---|
| **migration-sensitive** | Persisted in user browsers (IndexedDB names, event tags). Renaming orphans existing data. | No — needs migration plan |
| **external-contract** | Consumed by Tower, Yoke, or external agents. Renaming breaks cross-repo consumers. | No — needs coordinated multi-repo change |
| **env-var** | Used in `.env`, CI, and deploy scripts. Renaming requires updating every deployment environment. | No — needs coordinated deploy change |
| **deploy-config** | Generated PM2 / ecosystem process files. These are runtime artifacts and should not be committed. | Remove from source control |
| **internal-low-risk** | localStorage keys or internal constants. Renaming causes minor UX reset, not data loss. | Yes, with optional migration |
| **user-facing** | Display-only strings. No persistence or contract dependency. | Yes — safe to rename immediately |

## Inventory

### migration-sensitive

| Identifier | File | Why it must stay |
|---|---|---|
| `CoworkerV4SecureAuth` (IndexedDB name) | `src/auth/secure-store.js:3` | Every existing user's browser has auth credentials stored under this DB name. Renaming it would orphan stored credentials and device keys, forcing re-login on all devices. |
| `CoworkerV4` (IndexedDB name) | `src/db.js:182` | `migrateFromLegacyDb()` reads from this exact DB name to migrate app_settings into the new shared DB. The name must match what older app versions created. |
| `CoworkerV4SecureAuth`, `CoworkerV4` (hard-reset targets) | `src/hard-reset.js:4-5` | Hard-reset must delete these exact DB names to clean up data created by older versions. Must track whatever names were ever used in production. |
| `coworker-v4` (APP_TAG in signed events) | `src/auth/nostr.js:11` | Embedded in Nostr login events (kind 27235) as an `['app', 'coworker-v4']` tag. Tower and any event verifier may filter or validate against this tag value. Changing it creates a new namespace and could break session verification against existing records. |

### external-contract

| Identifier | File | Why it needs coordination |
|---|---|---|
| `coworker_agent_connect` (package kind) | `src/agent-connect.js:48` | The Agent Connect package `kind` field is consumed by Wingman Yoke and external agents. Renaming requires updating Yoke's parser, any agent that checks the kind, and published documentation. |
| `Coworker/agent session` (notes text) | `src/agent-connect.js:74` | Part of the `notes` array in a structured JSON payload. Agents may parse or display this text. Low risk but technically part of a published shape. |
| `coworker_agent_connect` | `public/llms.txt:57` | Published agent instruction surface served at `/llms.txt`. Must match the actual kind emitted by Agent Connect. |
| `Coworker` references | `public/agentconnect.md` | Published documentation consumed by agents. Should be renamed in coordination with the kind field. |

### env-var

| Identifier | File | Why it needs coordination |
|---|---|---|
| `FLIGHT_DECK_PG_APP_NPUB` | `src/app-identity.js`, `README.md` | Required build-time env var for the Flight Deck PG app namespace. Older Coworker env names are not accepted for PG workspace identity. |

### deploy-config

| Identifier | File | Rename notes |
|---|---|---|
| `ecosystem.config.cjs` | `.gitignore`, repo root | Removed from `wm-fd-2`. Autopilot app registry generates and owns Wingman app-card runtime process configuration. Do not commit generated PM2 files because they can contain stale paths and runtime secrets. |

### internal-low-risk

| Identifier | File | Rename notes |
|---|---|---|
| `coworker:last-task-board-id` (localStorage key) | `src/task-board-state.js:69` | Deprecated constant. Renaming loses the user's last-selected task board, causing a minor one-time UX reset. Not data loss. |
| `coworker:${slug}:*` (localStorage key pattern) | `src/task-board-state.js:73,835-836,851-852` | Namespaced localStorage keys for board state and collapsed sections. Same minor UX-reset impact as above. |
| `wm-fd-2` (package name) | `package.json:2`, `bun.lock` | Package is `private: true` and now identifies this repo as the PG migration copy. |

### user-facing

| Identifier | File | Rename notes |
|---|---|---|
| `Authenticate with Coworker` (event content) | `src/auth/nostr.js:89` | Display-only `content` field of the login event. Tower does not validate the content string — it checks signature, kind, and tags. Safe to rename to "Authenticate with Wingman" immediately. |

## Test identifiers (not in shipped code)

These appear only in test files and track the current source values. They do not need independent classification but must be updated when the source values change:

- `tests/docs-translator.test.js` — `app_namespace: 'coworker'`
- `tests/chat-translator.test.js` — `app_namespace: 'coworker'`
- `tests/read-cursor-queries.test.js` — `target_record_family_hash: 'coworker:document'`
- `tests/chat-app.test.js` — `record_family_hash: 'coworker:channel'`, `'coworker:chat_message'`
- `tests/agent-connect.test.js` — `kind: 'coworker_agent_connect'`
- `tests/task-board-state.test.js` — `'coworker:last-task-board-id'`
- `tests/e2e/workspace-profile.spec.js` — `key: 'COWORKER_APP_NSEC'`

## Recommended action sequence

1. **Now (safe):** Rename `Authenticate with Coworker` → `Authenticate with Wingman` in `src/auth/nostr.js:89`.
2. **Keep clean:** Do not re-add `ecosystem.config.cjs`; use Autopilot app registry for app-card process config.
3. **Coordinated rename:** `coworker_agent_connect` kind and associated docs — requires Yoke + agent updates in the same pass.
4. **Done:** PG app identity now requires `FLIGHT_DECK_PG_APP_NPUB`.
5. **Done for this repo:** private package name is `wm-fd-2`.
6. **localStorage migration (optional):** `coworker:*` localStorage keys — minor UX reset if not migrated.
7. **Do not rename:** `CoworkerV4SecureAuth`, `CoworkerV4`, `coworker-v4` APP_TAG — these are migration-sensitive. Any rename requires a versioned migration that reads the old name and writes to the new name, and hard-reset must continue to list both old and new names.
