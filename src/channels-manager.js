/**
 * Channel and group management methods extracted from app.js.
 *
 * Pure utility functions are exported individually for direct testing.
 * The channelsManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import {
  getChannelsByOwner,
  upsertChannel,
  upsertGroup,
  deleteGroupById,
  getAddressBookPeople,
  addPendingWrite,
} from './db.js';
import {
  createGroup,
  addGroupMember,
  rotateGroup,
  deleteGroupMember,
  updateGroup,
  getGroups,
  getGroupKeys,
  deleteGroup,
  addTowerPgWorkspaceChildGroup,
  addTowerPgWorkspaceGroupMember,
  createTowerPgWorkspaceGroup,
  createTowerPgWorkspaceScope,
  createTowerPgWorkspaceMember,
  createTowerPgChannelGrant,
  createTowerPgScopeChannel,
  deleteTowerPgChannelGrant,
  getTowerPgChannelGrants,
  getTowerPgWorkspaceGroups,
  getTowerPgWorkspaceMembers,
  removeTowerPgWorkspaceChildGroup,
  removeTowerPgWorkspaceGroupMember,
  updateTowerPgChannel,
  updateTowerPgChannelGrant,
} from './api.js';
import {
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  moveChannelInOrder,
  normalizeChannelOrder,
  sortChannelsByOrder,
} from './channel-order.js';
import {
  bootstrapWrappedGroupKeys,
  buildWrappedMemberKeys,
  cacheGroupKey,
  createGroupIdentity,
  getLastGroupKeyBootstrapDiagnostics,
  wrapKnownGroupKeyForMember,
} from './crypto/group-keys.js';
import { sameListBySignature, toRaw } from './utils/state-helpers.js';
import { isTaskUnscoped, matchesTaskBoardScope } from './task-board-scopes.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { APP_NPUB } from './app-identity.js';
import { flightDeckLog } from './logging.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import {
  DM_SCOPE_ID,
  buildDmChannelDescription,
  findExistingDmChannel,
  isDmChannel,
  isDmScope,
  resolveDmScope,
} from './dm-scope.js';
import {
  hydrateTowerPgAudioNotes,
  hydrateTowerPgChannels,
  hydrateTowerPgDocumentsAndFiles,
  hydrateTowerPgScopes,
  hydrateTowerPgTasks,
  mapPgChannelToLocal,
  resolveTowerPgWorkspaceContext,
} from './pg-read-hydrator.js';
import { buildPgChannelTaskBoardId, parsePgTaskBoardId } from './pg-record-context.js';

// ---------------------------------------------------------------------------

const FULL_NPUB_PATTERN = /^npub1[023456789acdefghjklmnpqrstuvwxyz]{50,}$/i;
const SYSTEM_SCOPE_IDS = new Set(['__all__', '__recent__', '__unscoped__']);
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

/**
 * Filter channels to only those the viewer should see.
 * The workspace owner sees all channels. Guest viewers see channels when
 * their real user npub is either listed as a participant or belongs to one of
 * the channel delivery groups.
 */
export function filterChannelsForViewer(channels, viewerNpub, workspaceOwnerNpub, groups = []) {
  if (!viewerNpub || viewerNpub === workspaceOwnerNpub) return channels;
  const accessibleGroupRefs = new Set();
  for (const group of Array.isArray(groups) ? groups : []) {
    const members = Array.isArray(group?.member_npubs) ? group.member_npubs : [];
    if (!members.includes(viewerNpub)) continue;
    if (group.group_id) accessibleGroupRefs.add(String(group.group_id));
    if (group.group_npub) accessibleGroupRefs.add(String(group.group_npub));
  }

  return channels.filter((ch) => {
    const participants = ch.participant_npubs;
    if (Array.isArray(participants) && participants.includes(viewerNpub)) return true;

    const channelGroupRefs = Array.isArray(ch.group_ids)
      ? ch.group_ids.map((ref) => String(ref || '').trim()).filter(Boolean)
      : [];
    if (channelGroupRefs.some((ref) => accessibleGroupRefs.has(ref))) return true;

    if (!Array.isArray(participants) || participants.length === 0) return true;
    return false;
  });
}

export function filterChannelsByScope(channels, selectedBoardId, selectedBoardScope, scopesMap = new Map()) {
  const liveChannels = (Array.isArray(channels) ? channels : [])
    .filter((channel) => channel && channel.record_state !== 'deleted');
  if (!selectedBoardId || selectedBoardId === '__all__' || selectedBoardId === '__recent__') {
    return liveChannels;
  }
  if (isDmScope(selectedBoardId) || isDmScope(selectedBoardScope)) {
    return liveChannels.filter((channel) => isDmChannel(channel));
  }
  if (selectedBoardId === '__unscoped__') {
    return liveChannels.filter((channel) => !isDmChannel(channel) && isTaskUnscoped(channel, scopesMap));
  }
  if (!selectedBoardScope) return liveChannels;
  return liveChannels.filter((channel) =>
    !isDmChannel(channel)
    && matchesTaskBoardScope(channel, selectedBoardScope, scopesMap, { includeDescendants: true }),
  );
}

function getChannelScopeId(channel) {
  return String(
    channel?.scope_id
    || channel?.scope_l5_id
    || channel?.scope_l4_id
    || channel?.scope_l3_id
    || channel?.scope_l2_id
    || channel?.scope_l1_id
    || '',
  ).trim();
}

export function findExistingNamedChannel(channels = [], title = '', scopeId = '') {
  const targetTitle = String(title || '').trim().toLowerCase();
  const targetScopeId = String(scopeId || '').trim();
  if (!targetTitle || !targetScopeId) return null;
  return (Array.isArray(channels) ? channels : [])
    .find((channel) =>
      channel?.record_state !== 'deleted'
      && String(channel.title || channel.name || '').trim().toLowerCase() === targetTitle
      && String(channel.scope_id || channel.scope_l1_id || '').trim() === targetScopeId,
    ) || null;
}

function groupSignature(group) {
  return [
    String(group?.group_id || ''),
    String(group?.group_npub || ''),
    String(group?.owner_npub || ''),
    String(group?.name || ''),
    String(group?.group_kind || ''),
    String(group?.private_member_npub || ''),
    String(group?.current_epoch || ''),
    [...(group?.member_npubs || [])].map(String).join(','),
    [...(group?.child_group_ids || [])].map(String).join(','),
    [...(group?.effective_member_npubs || [])].map(String).join(','),
  ].join('|');
}

function towerPgErrorCode(error) {
  const text = String(error?.responseText || error?.message || '');
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) return '';
  try {
    return String(JSON.parse(text.slice(jsonStart))?.code || '').trim();
  } catch {
    return '';
  }
}

function mapTowerPgActor(actor = {}) {
  const actorId = String(actor.actor_id || actor.id || '').trim();
  const npub = String(actor.npub || '').trim();
  if (!actorId && !npub) return null;
  return {
    actor_id: actorId,
    id: actorId,
    npub,
    kind: String(actor.kind || 'human').trim() || 'human',
    display_name: String(actor.display_name || '').trim() || null,
  };
}

function mapTowerPgGroupEntry(group = {}, { workspaceOwnerNpub = '' } = {}) {
  const members = Array.isArray(group.members)
    ? group.members.map(mapTowerPgActor).filter(Boolean)
    : [];
  const effectiveMembers = Array.isArray(group.effective_members)
    ? group.effective_members.map(mapTowerPgActor).filter(Boolean)
    : members;
  const memberNpubs = Array.isArray(group.member_npubs)
    ? group.member_npubs.map((member) => String(member || '').trim()).filter(Boolean)
    : members.map((member) => member.npub).filter(Boolean);
  const effectiveMemberNpubs = Array.isArray(group.effective_member_npubs)
    ? group.effective_member_npubs.map((member) => String(member || '').trim()).filter(Boolean)
    : effectiveMembers.map((member) => member.npub).filter(Boolean);
  const groupId = String(group.group_id || group.id || '').trim();
  return {
    group_id: groupId,
    group_npub: groupId,
    current_epoch: 1,
    owner_npub: workspaceOwnerNpub,
    name: String(group.name || '').trim() || 'Untitled group',
    group_kind: String(group.group_kind || group.kind || 'custom').trim() || 'custom',
    private_member_npub: null,
    member_npubs: memberNpubs,
    members,
    child_group_ids: Array.isArray(group.child_group_ids) ? group.child_group_ids.map(String).filter(Boolean) : [],
    parent_group_ids: Array.isArray(group.parent_group_ids) ? group.parent_group_ids.map(String).filter(Boolean) : [],
    effective_member_npubs: effectiveMemberNpubs,
    effective_members: effectiveMembers,
    pg_backend: true,
  };
}

function normalizeGroupMemberNpubs(entries = []) {
  return [...new Set((entries || [])
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object') {
        return String(entry.member_npub || entry.npub || '').trim();
      }
      return String(entry || '').trim();
    })
    .filter(Boolean))];
}

/**
 * Normalize a raw group object from the API into a consistent shape.
 */
export function mapGroupEntry(group) {
  const rawMembers = Array.isArray(group.members)
    ? group.members
    : (Array.isArray(group.member_npubs) ? group.member_npubs : []);
  return {
    group_id: group.id ?? group.group_id,
    group_npub: group.group_npub ?? group.group_id ?? group.id,
    current_epoch: Number(group.current_epoch || 1),
    owner_npub: group.owner_npub,
    name: group.name,
    group_kind: group.group_kind || 'shared',
    private_member_npub: group.private_member_npub ?? null,
    member_npubs: normalizeGroupMemberNpubs(rawMembers),
  };
}

/**
 * Map a createGroup API response into the local group shape.
 */
export function mapCreatedGroup(response, name, ownerNpub) {
  const groupNpub = response.group_npub ?? response.group_id ?? response.id;
  return {
    group_id: response.group_id ?? response.id ?? groupNpub,
    group_npub: groupNpub,
    current_epoch: Number(response.current_epoch || 1),
    owner_npub: ownerNpub,
    name: response.name ?? name,
    group_kind: response.group_kind || 'shared',
    private_member_npub: response.private_member_npub ?? null,
    member_npubs: normalizeGroupMemberNpubs(response.members ?? []),
  };
}

/**
 * Map a rotateGroup API response into the local group shape.
 */
export function mapRotatedGroup(response, groupIdentity, group, nextMembers, options) {
  const rawMembers = Array.isArray(response.members) && response.members.length > 0
    ? response.members
    : nextMembers;
  return {
    group_id: response.group_id ?? group.group_id,
    group_npub: response.group_npub ?? groupIdentity.npub,
    current_epoch: Number(response.current_epoch || ((group.current_epoch || 1) + 1)),
    owner_npub: response.owner_npub ?? group.owner_npub,
    name: response.name ?? options.name ?? group.name,
    group_kind: response.group_kind || group.group_kind || 'shared',
    private_member_npub: response.private_member_npub ?? group.private_member_npub ?? null,
    member_npubs: normalizeGroupMemberNpubs(rawMembers),
  };
}

/**
 * Deduplicate and normalize member npubs, ensuring the owner is first.
 */
export function deduplicateMembers(ownerNpub, memberNpubs) {
  return [...new Set([ownerNpub, ...normalizeGroupMemberNpubs(memberNpubs)])];
}

/**
 * Compute added/removed members between desired and existing sets.
 */
export function computeGroupMemberDiff(desiredMembers, existingMembers) {
  const membersToAdd = desiredMembers.filter((m) => !existingMembers.includes(m));
  const membersToRemove = existingMembers.filter((m) => !desiredMembers.includes(m));
  return { membersToAdd, membersToRemove };
}

/**
 * Parse a comma-separated query string and extract valid npub entries.
 */
export function parseGroupMemberQueryNpubs(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const parts = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (part.startsWith('npub1') && part.length >= 60 && !seen.has(part)) {
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

export const PG_CHANNEL_GRANT_CAPACITY_PRESETS = Object.freeze({
  viewer: Object.freeze([
    'channel.read',
    'task.read',
    'doc.read',
    'file.read',
    'audio_note.read',
  ]),
  contributor: Object.freeze([
    'channel.read',
    'channel.write',
    'task.read',
    'task.create',
    'task.update',
    'task.comment',
    'comment.create',
    'doc.read',
    'doc.write',
    'file.read',
    'file.write',
    'audio_note.read',
    'audio_note.write',
  ]),
  manager: Object.freeze([
    'channel.read',
    'channel.write',
    'channel.manage',
    'channel.grants.read',
    'channel.grants.manage',
    'task.read',
    'task.create',
    'task.update',
    'task.comment',
    'comment.create',
    'doc.read',
    'doc.write',
    'file.read',
    'file.write',
    'audio_note.read',
    'audio_note.write',
  ]),
  agent: Object.freeze([
    'channel.read',
    'channel.write',
    'task.read',
    'task.create',
    'comment.create',
    'doc.read',
    'doc.write',
    'file.read',
    'file.write',
    'audio_note.read',
    'audio_note.write',
  ]),
});

export function permissionsForPgChannelCapacity(capacity) {
  const key = String(capacity || '').trim();
  const permissions = PG_CHANNEL_GRANT_CAPACITY_PRESETS[key] || PG_CHANNEL_GRANT_CAPACITY_PRESETS.viewer;
  return [...permissions];
}

function accessLevelForPgChannelCapacity(capacity) {
  const key = String(capacity || '').trim();
  if (key === 'viewer') return 'view';
  if (key === 'contributor') return 'contribute';
  if (key === 'manager') return 'manage';
  return '';
}

function buildPgChannelGrantMutationPayload(capacity) {
  const accessLevel = accessLevelForPgChannelCapacity(capacity);
  return accessLevel
    ? { access_level: accessLevel }
    : { permissions: permissionsForPgChannelCapacity(capacity) };
}

function permissionSetSignature(permissions = []) {
  return [...new Set((permissions || []).map((permission) => String(permission || '').trim()).filter(Boolean))]
    .sort()
    .join('|');
}

const PG_CHANNEL_GRANT_CAPACITY_BY_SIGNATURE = new Map(
  Object.entries(PG_CHANNEL_GRANT_CAPACITY_PRESETS)
    .map(([capacity, permissions]) => [permissionSetSignature(permissions), capacity])
);

async function ensureTowerPgDmScope(store, { workspaceId, workspaceOwnerNpub, baseUrl, appNpub }) {
  const existingScope = resolveDmScope(store.scopes || []);
  if (existingScope?.record_id && existingScope.record_id !== DM_SCOPE_ID) {
    return existingScope.record_id;
  }
  if (store.dmScopeId && store.dmScopeId !== DM_SCOPE_ID) return store.dmScopeId;

  // Tower provisions the DMs scope at workspace setup; refresh before falling
  // back to creating one (older Towers only — creation needs scope.create).
  if (typeof store.refreshScopes === 'function') {
    try {
      await store.refreshScopes();
      const refreshedScope = resolveDmScope(store.scopes || []);
      if (refreshedScope?.record_id && refreshedScope.record_id !== DM_SCOPE_ID) {
        return refreshedScope.record_id;
      }
    } catch {
      // Fall through to the create path below.
    }
  }

  const createdScope = await createTowerPgWorkspaceScope(workspaceId, {
    name: 'DMs',
    description: 'Direct message conversations',
    kind: 'dm',
  }, { baseUrl, appNpub });
  const scopeRow = createdScope?.scope ? createdScope.scope : createdScope;
  const scopeId = scopeRow.id || scopeRow.record_id;
  if (!scopeId) throw new Error('Tower PG did not return a DMs scope id.');

  const mappedScope = {
    record_id: scopeId,
    owner_npub: workspaceOwnerNpub,
    title: scopeRow.name || 'DMs',
    description: scopeRow.description || 'Direct message conversations',
    level: 'l1',
    parent_id: null,
    l1_id: scopeId,
    record_state: 'active',
    pg_backend: true,
    pg_kind: 'dm',
  };
  store.scopes = [...(store.scopes || []).filter((scope) => scope.record_id !== scopeId), mappedScope];
  store.selectedBoardId = scopeId;
  store.persistSelectedBoardId?.(scopeId);
  return scopeId;
}

async function ensureTowerPgDmChannelGrant(store, { workspaceId, baseUrl, appNpub, targetNpub, channelId }) {
  // Tower grants both DM participants Manage at channel creation and owns
  // workspace membership; this helper only repairs older asymmetric DMs and
  // never enrolls new members.
  if (!canCurrentActorManageTowerPgChannelGrants(store)) {
    return store.getPgWorkspaceMemberActorId?.(targetNpub) || '';
  }

  let actorId = store.getPgWorkspaceMemberActorId?.(targetNpub) || '';
  if (!actorId) {
    await store.refreshTowerPgWorkspaceMembers?.({ force: true, limit: 200 }).catch(() => []);
    actorId = store.getPgWorkspaceMemberActorId?.(targetNpub) || '';
  }
  if (!actorId) return '';

  await createTowerPgChannelGrant(workspaceId, channelId, {
    principal_type: 'actor',
    principal_id: actorId,
    access_level: 'manage',
  }, { baseUrl, appNpub });
  return actorId;
}

async function ensureTowerPgDmChannel(store, targetNpub) {
  const ownerNpub = store.workspaceOwnerNpub;
  const memberNpub = store.session?.npub;
  const cleanTargetNpub = String(targetNpub || '').trim();
  if (!ownerNpub || !memberNpub || !cleanTargetNpub) return null;

  const { workspaceId, workspaceOwnerNpub, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(store);
  if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected.');

  const existing = findExistingDmChannel(store.channels || [], [memberNpub, cleanTargetNpub]);
  if (existing?.record_id) {
    await ensureTowerPgDmChannelGrant(store, {
      workspaceId,
      baseUrl,
      appNpub,
      targetNpub: cleanTargetNpub,
      channelId: existing.record_id,
    });
    return existing;
  }

  const scopeId = await ensureTowerPgDmScope(store, { workspaceId, workspaceOwnerNpub, baseUrl, appNpub });
  if (!scopeId || scopeId === DM_SCOPE_ID) throw new Error('Select the DMs scope before creating a DM.');

  const dmDescription = buildDmChannelDescription([memberNpub, cleanTargetNpub]);
  const result = await createTowerPgScopeChannel(workspaceId, scopeId, {
    name: `DM: ${cleanTargetNpub}`,
    description: dmDescription,
    kind: 'dm',
    participant_npubs: [memberNpub, cleanTargetNpub],
  }, { baseUrl, appNpub });
  const channelRow = {
    ...mapPgChannelToLocal(result.channel, { workspaceOwnerNpub }),
    description: result.channel?.description || dmDescription,
    channel_type: 'dm',
    participant_npubs: [memberNpub, cleanTargetNpub],
  };
  await upsertChannel(channelRow);
  store.channels = [...(store.channels || []).filter((channel) => channel.record_id !== channelRow.record_id), channelRow];
  await store.rememberPeople?.([ownerNpub, cleanTargetNpub], 'chat');
  return channelRow;
}

export function capacityForPgChannelPermissions(permissions = []) {
  return PG_CHANNEL_GRANT_CAPACITY_BY_SIGNATURE.get(permissionSetSignature(permissions)) || 'custom';
}

export function describePgPermissionDenied(error, fallbackAction = 'do this') {
  const permission = String(error?.requiredPermission || '').trim();
  if (permission === 'channel.grants.manage' || permission === 'channel.grants.read' || permission === 'channel.manage') {
    return 'You need Manage access on this channel to do that.';
  }
  if (
    permission === 'channel.write'
    || permission === 'comment.create'
    || permission.startsWith('task.')
    || permission.endsWith('.write')
  ) {
    return 'You need Contribute access on this channel to do that.';
  }
  if (permission.endsWith('.read')) {
    return 'You need View access on this channel to do that.';
  }
  if (permission.startsWith('workspace.') || permission === 'scope.create' || permission === 'scope.manage') {
    return 'Only workspace admins can do that.';
  }
  return `You do not have permission to ${fallbackAction}.`;
}

export function aggregatePgChannelGrants(grants = []) {
  const byPrincipal = new Map();
  for (const grant of Array.isArray(grants) ? grants : []) {
    const rawPrincipalType = String(grant?.principal_type || grant?.stored_principal_type || '').trim();
    const principalType = rawPrincipalType === 'person' ? 'actor' : rawPrincipalType;
    const principalId = String(
      grant?.principal_id
      || grant?.principal?.actor_id
      || grant?.principal?.group_id
      || grant?.principal?.group_npub
      || grant?.principal?.id
      || ''
    ).trim();
    if (!principalType || !principalId) continue;
    const key = `${principalType}:${principalId}`;
    const existing = byPrincipal.get(key) || {
      key,
      principal_type: principalType,
      principal_id: principalId,
      permissions: [],
      grants: [],
      created_at: grant?.created_at || null,
      updated_at: grant?.updated_at || grant?.created_at || null,
      principal_npub: String(grant?.principal_npub || grant?.actor_npub || grant?.npub || '').trim(),
    };
    const grantPrincipalNpub = String(grant?.principal_npub || grant?.actor_npub || grant?.npub || grant?.principal?.npub || '').trim();
    if (grantPrincipalNpub) existing.principal_npub = grantPrincipalNpub;
    const grantPermissions = Array.isArray(grant?.permissions)
      ? grant.permissions
      : [grant?.permission];
    existing.permissions = [
      ...new Set([
        ...existing.permissions,
        ...grantPermissions.map((permission) => String(permission || '').trim()).filter(Boolean),
      ]),
    ].sort();
    existing.grants.push(grant);
    existing.updated_at = grant?.updated_at || grant?.created_at || existing.updated_at;
    byPrincipal.set(key, existing);
  }
  return [...byPrincipal.values()].map((entry) => ({
    ...entry,
    capacity: capacityForPgChannelPermissions(entry.permissions),
  }));
}

function embeddedChannelGrants(channel = {}) {
  return [
    ...(Array.isArray(channel?.channel_grants) ? channel.channel_grants : []),
    ...(Array.isArray(channel?.grants) ? channel.grants : []),
    ...(Array.isArray(channel?.access_grants) ? channel.access_grants : []),
  ];
}

function pgChannelGrantPermissionNames(grant) {
  const permissions = Array.isArray(grant?.permissions)
    ? grant.permissions
    : [grant?.permission];
  return permissions.map((permission) => String(permission || '').trim()).filter(Boolean);
}

function groupHasEffectiveMember(group, viewerNpub) {
  if (!group || !viewerNpub) return false;
  const memberNpubs = [
    ...(Array.isArray(group.effective_member_npubs) ? group.effective_member_npubs : []),
    ...(Array.isArray(group.member_npubs) ? group.member_npubs : []),
  ].map((member) => String(member || '').trim()).filter(Boolean);
  return memberNpubs.includes(viewerNpub);
}

export function canManagePgChannelGrantsFromRows({
  grants = [],
  actorId = '',
  viewerNpub = '',
  groups = [],
  canAdminWorkspace = false,
} = {}) {
  if (canAdminWorkspace) return true;
  const normalizedActorId = String(actorId || '').trim();
  const normalizedViewerNpub = String(viewerNpub || '').trim();
  const groupById = new Map(
    (Array.isArray(groups) ? groups : [])
      .filter((group) => group?.group_id || group?.id)
      .map((group) => [String(group.group_id || group.id), group])
  );

  return (Array.isArray(grants) ? grants : []).some((grant) => {
    if (!pgChannelGrantPermissionNames(grant).includes('channel.grants.manage')) return false;
    const rawPrincipalType = String(grant?.principal_type || grant?.stored_principal_type || '').trim();
    const principalType = rawPrincipalType === 'person' ? 'actor' : rawPrincipalType;
    const principalId = String(
      grant?.principal_id
      || grant?.principal?.actor_id
      || grant?.principal?.id
      || ''
    ).trim();
    if (principalType === 'actor') {
      return Boolean(normalizedActorId && principalId === normalizedActorId);
    }
    if (principalType === 'group') {
      return groupHasEffectiveMember(groupById.get(principalId), normalizedViewerNpub);
    }
    return false;
  });
}

function canCurrentActorManageTowerPgChannelGrants(store = {}) {
  const { workspace } = resolveTowerPgWorkspaceContext(store);
  const permissions = pgMePermissionNames(workspace);
  if (permissions.includes('channel.grants.manage')) return true;
  if (Boolean(store.canAdminWorkspace)) return true;

  return canManagePgChannelGrantsFromRows({
    grants: Array.isArray(store.channelGrants) ? store.channelGrants : [],
    actorId: pgMeActorId(workspace),
    viewerNpub: pgMeActorNpub(workspace) || store.session?.npub || '',
    groups: (Array.isArray(store.currentWorkspaceGroups) && store.currentWorkspaceGroups.length > 0
      ? store.currentWorkspaceGroups
      : Array.isArray(store.groups) ? store.groups : []),
    canAdminWorkspace: false,
  });
}

function pgMePermissionNames(workspace = {}) {
  return (Array.isArray(workspace?.pgMe?.permissions) ? workspace.pgMe.permissions : [])
    .map((permission) => String(permission || '').trim())
    .filter(Boolean);
}

function pgMeActorId(workspace = {}) {
  return String(
    workspace?.pgMe?.actor?.actor_id
    || workspace?.pgMe?.actor?.id
    || workspace?.pgMe?.actor_id
    || ''
  ).trim();
}

function pgMeActorNpub(workspace = {}) {
  return String(
    workspace?.pgMe?.actor?.npub
    || workspace?.pgSessionNpub
    || ''
  ).trim();
}

function normalizeNewChannelAccessRow(row = {}) {
  const principalType = String(row.principal_type || row.principalType || '').trim();
  const principalId = String(row.principal_id || row.principalId || '').trim();
  const capacity = String(row.capacity || row.access_level || row.accessLevel || '').trim();
  if (!['actor', 'group'].includes(principalType) || !principalId) return null;
  const normalizedCapacity = ['viewer', 'contributor', 'manager', 'agent'].includes(capacity) ? capacity : 'viewer';
  return {
    principal_type: principalType,
    principal_id: principalId,
    capacity: normalizedCapacity,
  };
}

export function buildChannelAccessGrantPayloads(rows = []) {
  const byPrincipal = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeNewChannelAccessRow(row);
    if (!normalized) continue;
    byPrincipal.set(`${normalized.principal_type}:${normalized.principal_id}`, normalized);
  }
  return [...byPrincipal.values()].map((row) => ({
    principal_type: row.principal_type,
    principal_id: row.principal_id,
    ...(accessLevelForPgChannelCapacity(row.capacity)
      ? { access_level: accessLevelForPgChannelCapacity(row.capacity) }
      : { permissions: permissionsForPgChannelCapacity(row.capacity) }),
  }));
}

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const channelsManagerMixin = {
  get newChannelScopeOptions() {
    return (this.scopes || [])
      .filter((scope) => scope?.record_id && scope.record_state !== 'deleted' && !isDmScope(scope))
      .map((scope) => ({
        id: scope.record_id,
        label: this.getScopeBreadcrumb?.(scope.record_id) || scope.title || scope.record_id,
      }));
  },

  get currentConcretePgScopeId() {
    if (!isTowerPgBackendMode()) return '';
    const selectedScopeId = String(this.selectedBoardScope?.record_id || '').trim();
    if (selectedScopeId && !SYSTEM_SCOPE_IDS.has(selectedScopeId) && !isDmScope(selectedScopeId)) return selectedScopeId;
    const board = parsePgTaskBoardId(this.selectedBoardId);
    if (board.type === 'scope' && board.scopeId && !SYSTEM_SCOPE_IDS.has(board.scopeId) && !isDmScope(board.scopeId)) {
      return board.scopeId;
    }
    if (board.type === 'scope') return '';
    const channelScopeId = String(this.selectedChannel?.scope_id || '').trim();
    if (channelScopeId && !SYSTEM_SCOPE_IDS.has(channelScopeId) && !isDmScope(channelScopeId)) return channelScopeId;
    return '';
  },

  openNewChannelScopePicker() {
    this.newChannelScopeId = '';
    this.showNewChannelScopePicker = true;
  },

  closeNewChannelScopePicker() {
    this.showNewChannelScopePicker = false;
    this.newChannelScopeId = '';
  },

  async continueNewChannelWithScope() {
    const scopeId = String(this.newChannelScopeId || '').trim();
    if (!scopeId) {
      this.error = 'Select a scope before creating a channel.';
      return;
    }
    this.showNewChannelScopePicker = false;
    await this.openNewChannelModal({ scopeId });
  },

  // --- channels ---

  async ensureTowerPgDmChannel(targetNpub) {
    return ensureTowerPgDmChannel(this, targetNpub);
  },

  get scopeFilteredChannels() {
    return filterChannelsByScope(
      this.channels,
      this.selectedBoardId,
      this.pgContextScope || this.selectedBoardScope,
      this.scopesMap,
    );
  },

  get dmScope() {
    return resolveDmScope(this.scopes || [], this.workspaceOwnerNpub);
  },

  get dmScopeId() {
    return this.dmScope?.record_id || DM_SCOPE_ID;
  },

  get isDmScopeSelected() {
    return isDmScope(this.selectedBoardId) || isDmScope(this.selectedBoardScope);
  },

  get canCreateDmInCurrentScope() {
    return this.isDmScopeSelected;
  },

  ensureSelectedChatChannelInScope({ syncRoute = true } = {}) {
    const visibleChannels = Array.isArray(this.scopeFilteredChannels) ? this.scopeFilteredChannels : [];
    const selectedVisible = this.selectedChannelId
      && visibleChannels.some((channel) => channel.record_id === this.selectedChannelId);
    if (selectedVisible) return this.selectedChannelId;
    const nextChannelId = visibleChannels[0]?.record_id || null;
    if (nextChannelId) {
      this.selectChannel(nextChannelId, { syncRoute });
      return nextChannelId;
    }
    this.selectedChannelId = null;
    this.closeThread?.({ syncRoute: false });
    this.stopSelectedChannelLiveQuery?.();
    void this.applyMessages?.([], { scrollToLatest: false });
    if (syncRoute) this.syncRoute?.();
    return null;
  },

  async loadLocalChannels(options = {}) {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return [];
    const channels = await getChannelsByOwner(ownerNpub);
    await this.applyChannels(channels, options);
    return channels;
  },

  async refreshChannels() {
    if (isTowerPgBackendMode()) {
      return hydrateTowerPgChannels(this);
    }
    return this.loadLocalChannels();
  },

  scheduleChannelsRefresh(reason = 'background') {
    Promise.resolve()
      .then(() => this.refreshChannels())
      .catch((refreshError) => {
        flightDeckLog('warn', 'settings', `PG channel refresh failed after ${reason}`, {
          error: refreshError?.message || String(refreshError),
        });
      });
  },

  scheduleGroupsRefresh(options = {}, reason = 'background') {
    Promise.resolve()
      .then(() => this.refreshGroups(options))
      .catch((refreshError) => {
        flightDeckLog('warn', 'groups', `PG group refresh failed after ${reason}`, {
          error: refreshError?.message || String(refreshError),
        });
      });
  },

  async refreshTowerPgWorkspaceMembers(options = {}) {
    const { workspaceId, workspaceOwnerNpub, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
    if (!workspaceId || !baseUrl) return [];
    const currentActor = mapTowerPgActor(this.currentWorkspace?.pgMe?.actor || {});
    const selfMember = currentActor?.npub
      ? [{
        ...currentActor,
        workspace_owner_npub: workspaceOwnerNpub,
        role: String(this.currentWorkspace?.pgMe?.membership?.role || '').trim() || 'member',
        joined_at: this.currentWorkspace?.pgMe?.membership?.joined_at || this.currentWorkspace?.pgMe?.membership?.created_at || null,
      }]
      : [];
    let result = { members: [] };
    try {
      result = await getTowerPgWorkspaceMembers(workspaceId, {
        baseUrl,
        appNpub,
        limit: options.limit || 200,
      });
    } catch (error) {
      if (selfMember.length === 0) throw error;
    }
    const byNpub = new Map();
    for (const member of selfMember) byNpub.set(member.npub, member);
    for (const entry of result.members || []) {
      const actor = mapTowerPgActor(entry.actor || entry);
      if (!actor?.npub) continue;
      byNpub.set(actor.npub, {
        ...actor,
        workspace_owner_npub: workspaceOwnerNpub,
        role: String(entry.membership?.role || '').trim() || 'member',
        joined_at: entry.membership?.joined_at || entry.membership?.created_at || null,
      });
    }
    const members = [...byNpub.values()];
    this.pgWorkspaceMembers = members;
    if (members.length > 0) {
      await this.rememberPeople(members.map((member) => member.npub), 'pg-workspace-member');
    }
    return members;
  },

  get pgChannelGrantCapacityOptions() {
    return [
      { value: 'viewer', label: 'View' },
      { value: 'contributor', label: 'Contribute' },
      { value: 'manager', label: 'Manage' },
      { value: 'agent', label: 'Agent' },
    ];
  },

  get pgChannelGrantActorOptions() {
    const byActorId = new Map();
    for (const member of (this.pgWorkspaceMembers || [])) {
      if (!member?.actor_id || !member?.npub) continue;
      byActorId.set(member.actor_id, member);
    }
    const currentActor = this.currentWorkspace?.pgMe?.actor || {};
    const currentActorId = String(currentActor.actor_id || currentActor.id || '').trim();
    const currentActorNpub = String(currentActor.npub || this.session?.npub || '').trim();
    if (currentActorId && currentActorNpub && !byActorId.has(currentActorId)) {
      byActorId.set(currentActorId, {
        actor_id: currentActorId,
        npub: currentActorNpub,
        display_name: currentActor.display_name || currentActor.name || null,
      });
    }
    return [...byActorId.values()]
      .filter((member) => member?.actor_id && member?.npub)
      .map((member) => ({
        actorId: member.actor_id,
        npub: member.npub,
        label: this.getPgWorkspaceMemberLabel(member),
      }));
  },

  get pgChannelGrantGroupOptions() {
    const sourceGroups = Array.isArray(this.currentWorkspaceGroups) && this.currentWorkspaceGroups.length > 0
      ? this.currentWorkspaceGroups
      : this.groups;
    return (sourceGroups || [])
      .filter((group) => group?.group_id)
      .map((group) => ({
        groupId: group.group_id,
        label: group.name || 'Untitled group',
        subtitle: group.group_kind === 'workspace_admin'
          ? 'Workspace admin group'
          : `${(group.effective_member_npubs || group.member_npubs || []).length} effective members`,
      }));
  },

  get channelGrantRows() {
    return this.getSelectedChannelGrantRows();
  },

  getSelectedChannelGrantRows(channelId = this.selectedChannelId) {
    const selectedId = String(channelId || '').trim();
    const selectedChannel = (this.channels || []).find((channel) => channel?.record_id === selectedId) || null;
    const loadedChannelId = String(this.channelGrantsChannelId || '').trim();
    const hasLoadedRowsForChannel = selectedId && (!loadedChannelId || loadedChannelId === selectedId);
    const source = hasLoadedRowsForChannel
      ? (this.channelGrants || [])
      : embeddedChannelGrants(selectedChannel);
    return aggregatePgChannelGrants(source);
  },

  get pgChannelBulkGrantChannelOptions() {
    return (this.channels || [])
      .filter((channel) => channel?.record_id && channel.record_state !== 'deleted' && !isDmChannel(channel))
      .map((channel) => {
        const scopeId = String(channel.scope_id || channel.scope_l1_id || '').trim();
        const scope = scopeId ? this.scopesMap?.get?.(scopeId) : null;
        return {
          id: channel.record_id,
          label: this.getChannelLabel?.(channel) || channel.title || channel.name || channel.record_id,
          scopeLabel: scopeId ? (scope?.title || this.getScopeBreadcrumb?.(scopeId) || scopeId) : 'No scope',
        };
      })
      .sort((left, right) =>
        String(left.scopeLabel || '').localeCompare(String(right.scopeLabel || ''))
        || String(left.label || '').localeCompare(String(right.label || ''))
      );
  },

  get channelBulkGrantSelectedCount() {
    const selected = new Set(
      (Array.isArray(this.channelBulkGrantSelectedChannelIds) ? this.channelBulkGrantSelectedChannelIds : [])
        .map((channelId) => String(channelId || '').trim())
        .filter(Boolean)
    );
    return this.pgChannelBulkGrantChannelOptions.filter((channel) => selected.has(channel.id)).length;
  },

  get channelBulkGrantAllSelected() {
    const options = this.pgChannelBulkGrantChannelOptions;
    return options.length > 0 && this.channelBulkGrantSelectedCount === options.length;
  },

  get channelBulkGrantSelectedPrincipalKey() {
    const principalType = String(this.channelBulkGrantPrincipalType || '').trim();
    const principalId = this.resolveChannelBulkGrantPrincipalId();
    if (!['actor', 'group'].includes(principalType) || !principalId) return '';
    return `${principalType}:${principalId}`;
  },

  get canApplyChannelBulkGrant() {
    return Boolean(
      this.canManageSelectedPgChannelGrants
      && !this.channelBulkGrantBusy
      && this.channelBulkGrantSelectedCount > 0
      && this.channelBulkGrantSelectedPrincipalKey
    );
  },

  get newChannelAccessPrincipalOptions() {
    const groups = this.pgChannelGrantGroupOptions.map((group) => ({
      value: `group:${group.groupId}`,
      type: 'group',
      id: group.groupId,
      label: group.label,
      subtitle: group.subtitle,
    }));
    const people = this.pgChannelGrantActorOptions.map((actor) => ({
      value: `actor:${actor.actorId}`,
      type: 'actor',
      id: actor.actorId,
      label: actor.label,
      subtitle: actor.npub,
    }));
    return [
      { disabled: true, label: 'Groups' },
      ...groups,
      { disabled: true, label: 'People' },
      ...people,
    ];
  },

  get newChannelAccessAddOptions() {
    const selectedPrincipals = new Set(
      (Array.isArray(this.newChannelAccessRows) ? this.newChannelAccessRows : [])
        .map((row) => this.getNewChannelAccessPrincipalValue(row))
        .filter(Boolean)
    );
    return this.newChannelAccessPrincipalOptions.filter((option) =>
      !option.disabled && !selectedPrincipals.has(option.value)
    );
  },

  get newChannelCanAddAccessRow() {
    return this.newChannelAccessAddOptions.length > 0;
  },

  get newChannelAccessDisabledReason() {
    if (!isTowerPgBackendMode()) return '';
    if (this.newChannelCanAddAccessRow) return '';
    if (this.newChannelAccessLoading) return 'Loading users and groups...';
    if (this.newChannelAccessError) return this.newChannelAccessError;
    return 'All available users and groups already have a permission row.';
  },

  get canCreateNamedChannel() {
    if (!this.newChannelName?.trim()) return false;
    if (!isTowerPgBackendMode()) return Boolean(this.newChannelGroupId);
    return buildChannelAccessGrantPayloads(this.newChannelAccessRows).length > 0;
  },

  getNewChannelAccessRowKey(row, index) {
    return row?.id || `${row?.principal_type || 'row'}:${row?.principal_id || index}:${index}`;
  },

  getNewChannelAccessPrincipalValue(row) {
    return `${row?.principal_type || ''}:${row?.principal_id || ''}`;
  },

  setNewChannelAccessPrincipal(index, value) {
    const [principalType, ...idParts] = String(value || '').split(':');
    const principalId = idParts.join(':');
    if (!['actor', 'group'].includes(principalType) || !principalId) return;
    const rows = Array.isArray(this.newChannelAccessRows) ? [...this.newChannelAccessRows] : [];
    if (!rows[index]) return;
    rows[index] = {
      ...rows[index],
      principal_type: principalType,
      principal_id: principalId,
    };
    this.newChannelAccessRows = rows;
  },

  setNewChannelAccessCapacity(index, capacity) {
    const nextCapacity = ['viewer', 'contributor', 'manager', 'agent'].includes(capacity) ? capacity : 'viewer';
    const rows = Array.isArray(this.newChannelAccessRows) ? [...this.newChannelAccessRows] : [];
    if (!rows[index]) return;
    rows[index] = { ...rows[index], capacity: nextCapacity };
    this.newChannelAccessRows = rows;
  },

  addNewChannelAccessRow(value = '') {
    const requestedValue = String(value || this.newChannelAccessPrincipalDraft || '').trim();
    const principal = requestedValue
      ? this.newChannelAccessAddOptions.find((option) => option.value === requestedValue)
      : this.newChannelAccessAddOptions[0];
    this.newChannelAccessPrincipalDraft = '';
    if (!principal) return;
    this.newChannelAccessRows = [
      ...(Array.isArray(this.newChannelAccessRows) ? this.newChannelAccessRows : []),
      {
        id: crypto.randomUUID(),
        principal_type: principal.type,
        principal_id: principal.id,
        capacity: 'viewer',
      },
    ];
  },

  removeNewChannelAccessRow(index) {
    this.newChannelAccessRows = (Array.isArray(this.newChannelAccessRows) ? this.newChannelAccessRows : [])
      .filter((_, rowIndex) => rowIndex !== index);
  },

  getNewChannelAccessPrincipalLabel(row) {
    const principalType = String(row?.principal_type || '').trim();
    const principalId = String(row?.principal_id || '').trim();
    if (principalType === 'group') return this.getPgGroupLabel(principalId);
    const member = (this.pgWorkspaceMembers || []).find((entry) => entry.actor_id === principalId || entry.id === principalId);
    return member?.npub ? this.getSenderName(member.npub) : principalId;
  },

  resetNewChannelAccessRows() {
    if (!isTowerPgBackendMode()) {
      this.newChannelAccessPrincipalDraft = '';
      this.newChannelAccessRows = [];
      return;
    }
    const rows = [];
    const workspaceGroup = this.pgChannelGrantGroupOptions.find((group) =>
      String(group.label || '').trim().toLowerCase() === 'workspace'
      || String(group.groupId || '').trim().toLowerCase() === 'workspace'
    );
    if (workspaceGroup?.groupId) {
      rows.push({
        id: crypto.randomUUID(),
        principal_type: 'group',
        principal_id: workspaceGroup.groupId,
        capacity: 'viewer',
      });
    }
    const actorId = pgMeActorId(this.currentWorkspace || {});
    if (actorId) {
      rows.push({
        id: crypto.randomUUID(),
        principal_type: 'actor',
        principal_id: actorId,
        capacity: 'manager',
      });
    }
    this.newChannelAccessPrincipalDraft = '';
    this.newChannelAccessRows = rows;
  },

  get canManageSelectedPgChannelGrants() {
    if (!isTowerPgBackendMode()) return Boolean(this.canAdminWorkspace);
    const workspace = this.currentWorkspace || {};
    return canManagePgChannelGrantsFromRows({
      grants: this.channelGrantRows || [],
      actorId: pgMeActorId(workspace),
      viewerNpub: pgMeActorNpub(workspace) || this.session?.npub || '',
      groups: Array.isArray(this.currentWorkspaceGroups) && this.currentWorkspaceGroups.length > 0
        ? this.currentWorkspaceGroups
        : this.groups,
      canAdminWorkspace: Boolean(this.canAdminWorkspace),
    });
  },

  get canAttemptSelectedPgChannelGrantRead() {
    if (!isTowerPgBackendMode()) return false;
    if (this.canAdminWorkspace) return true;
    const permissions = pgMePermissionNames(this.currentWorkspace || {});
    return permissions.includes('channel.grants.read') || permissions.includes('channel.grants.manage');
  },

  resetChannelGrantDraft() {
    this.channelGrantPrincipalType = 'actor';
    this.channelGrantActorId = this.pgChannelGrantActorOptions[0]?.actorId || '';
    this.channelGrantGroupId = this.pgChannelGrantGroupOptions[0]?.groupId || '';
    this.channelGrantCapacity = 'viewer';
    this.channelGrantsError = null;
    this.channelGrantsNotice = '';
  },

  resetChannelBulkGrantDraft(options = {}) {
    const agentGroup = this.pgChannelGrantGroupOptions.find((group) => {
      const label = String(group.label || '').trim().toLowerCase().replace(/\s+/g, '');
      return label === 'agents' || label === 'aiagents' || label === 'agent';
    });
    const groupId = agentGroup?.groupId || this.pgChannelGrantGroupOptions[0]?.groupId || '';
    const actorId = this.pgChannelGrantActorOptions[0]?.actorId || '';
    this.channelBulkGrantPrincipalType = groupId ? 'group' : 'actor';
    this.channelBulkGrantGroupId = groupId;
    this.channelBulkGrantActorId = actorId;
    this.channelBulkGrantCapacity = 'contributor';
    this.channelBulkGrantProgress = '';
    if (options.selectAll === true) {
      this.channelBulkGrantSelectedChannelIds = this.pgChannelBulkGrantChannelOptions.map((channel) => channel.id);
      return;
    }
    const selectedChannelId = String(this.selectedChannelId || '').trim();
    const channelIds = new Set(this.pgChannelBulkGrantChannelOptions.map((channel) => channel.id));
    this.channelBulkGrantSelectedChannelIds = selectedChannelId && channelIds.has(selectedChannelId)
      ? [selectedChannelId]
      : [];
  },

  openChannelSettings(channelId = null) {
    const normalizedChannelId = String(channelId || '').trim();
    if (normalizedChannelId) this.selectedChannelId = normalizedChannelId;
    const selectedChannel = this.selectedChannel || this.channels?.find((channel) => channel?.record_id === this.selectedChannelId);
    if (!selectedChannel) return;
    this.closeScopePicker();
    this.closeChannelScopePicker();
    this.channelDeleteConfirmArmed = false;
    this.channelSettingsBasePrompt = String(selectedChannel.metadata?.basePrompt || '');
    this.channelSettingsNotice = '';
    this.channelSettingsError = '';
    this.showChannelSettingsModal = true;
    if (isTowerPgBackendMode()) {
      this.preparePgChannelAccessPanel();
    }
  },

  closeChannelSettings() {
    this.closeChannelScopePicker();
    this.channelDeleteConfirmArmed = false;
    this.channelSettingsNotice = '';
    this.channelSettingsError = '';
    this.showChannelSettingsModal = false;
  },

  async saveChannelBasePrompt() {
    if (!isTowerPgBackendMode()) return;
    const channel = this.selectedChannel || this.channels?.find((candidate) => candidate?.record_id === this.selectedChannelId);
    if (!channel?.record_id) {
      this.channelSettingsError = 'Select a channel first.';
      return;
    }
    this.channelSettingsSaving = true;
    this.channelSettingsNotice = '';
    this.channelSettingsError = '';
    try {
      const { workspaceId, baseUrl, appNpub, workspaceOwnerNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      const metadata = {
        ...(channel.metadata && typeof channel.metadata === 'object' && !Array.isArray(channel.metadata) ? channel.metadata : {}),
        basePrompt: String(this.channelSettingsBasePrompt || '').trim(),
      };
      const result = await updateTowerPgChannel(workspaceId, channel.record_id, { metadata }, { baseUrl, appNpub });
      const updatedChannel = mapPgChannelToLocal(result.channel, { workspaceOwnerNpub });
      try {
        await upsertChannel(updatedChannel);
      } catch (cacheError) {
        flightDeckLog('warn', 'settings', 'PG channel cache write failed after metadata update', {
          error: cacheError?.message || String(cacheError),
        });
      }
      this.channels = (this.channels || []).map((candidate) =>
        candidate?.record_id === updatedChannel.record_id ? updatedChannel : candidate
      );
      this.channelSettingsBasePrompt = String(updatedChannel.metadata?.basePrompt || '');
      this.channelSettingsNotice = 'Channel prompt saved.';
      this.scheduleChannelsRefresh?.('PG channel metadata update');
    } catch (error) {
      this.channelSettingsError = error?.message || 'Failed to save channel prompt.';
    } finally {
      this.channelSettingsSaving = false;
    }
  },

  async preparePgChannelAccessPanel() {
    this.channelGrantsError = null;
    try {
      await Promise.all([
        this.refreshGroups({ force: true, minIntervalMs: 0 }),
        this.refreshTowerPgWorkspaceMembers?.({ force: true, limit: 200 }) ?? Promise.resolve([]),
      ]);
      this.resetChannelGrantDraft();
      this.resetChannelBulkGrantDraft();
      if (this.canAttemptSelectedPgChannelGrantRead) {
        await this.refreshChannelGrants();
      } else {
        this.channelGrantsChannelId = String(this.selectedChannelId || '').trim() || null;
        this.channelGrants = embeddedChannelGrants(this.selectedChannel || {});
      }
    } catch (error) {
      this.channelGrantsError = error?.message || 'Failed to load channel access';
    }
  },

  async cacheSelectedChannelGrants(channelId, grants = []) {
    const cleanChannelId = String(channelId || '').trim();
    if (!cleanChannelId) return;
    const channel = (this.channels || []).find((candidate) => candidate?.record_id === cleanChannelId);
    if (!channel) return;
    const nextChannel = {
      ...channel,
      channel_grants: Array.isArray(grants) ? grants : [],
    };
    try {
      await upsertChannel(nextChannel);
    } catch (cacheError) {
      flightDeckLog('warn', 'settings', 'PG channel grant cache write failed after refresh', {
        error: cacheError?.message || String(cacheError),
      });
    }
    this.channels = (this.channels || []).map((candidate) =>
      candidate?.record_id === cleanChannelId ? nextChannel : candidate
    );
  },

  async refreshChannelGrants() {
    if (!isTowerPgBackendMode()) return [];
    const channelId = String(this.selectedChannelId || '').trim();
    if (!channelId) return [];
    this.channelGrantsLoading = true;
    this.channelGrantsError = null;
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      const result = await getTowerPgChannelGrants(workspaceId, channelId, { baseUrl, appNpub });
      this.channelGrants = Array.isArray(result?.grants) ? result.grants : [];
      this.channelGrantsChannelId = channelId;
      await this.cacheSelectedChannelGrants(channelId, this.channelGrants);
      await this.materializeSelectedDmParticipantsFromChannelGrants();
      return this.channelGrants;
    } catch (error) {
      this.channelGrantsError = error?.message || 'Failed to load channel grants';
      return this.channelGrantsChannelId === channelId
        ? (this.channelGrants || [])
        : embeddedChannelGrants(this.selectedChannel || {});
    } finally {
      this.channelGrantsLoading = false;
    }
  },

  resolveChannelGrantPrincipalId() {
    if (this.channelGrantPrincipalType === 'group') {
      return String(this.channelGrantGroupId || '').trim();
    }
    return String(this.channelGrantActorId || '').trim();
  },

  resolveChannelBulkGrantPrincipalId() {
    if (this.channelBulkGrantPrincipalType === 'group') {
      return String(this.channelBulkGrantGroupId || '').trim();
    }
    return String(this.channelBulkGrantActorId || '').trim();
  },

  isChannelSelectedForBulkGrant(channelId) {
    const id = String(channelId || '').trim();
    if (!id) return false;
    return (Array.isArray(this.channelBulkGrantSelectedChannelIds) ? this.channelBulkGrantSelectedChannelIds : [])
      .map((selectedId) => String(selectedId || '').trim())
      .includes(id);
  },

  setChannelBulkGrantSelection(channelId, selected) {
    const id = String(channelId || '').trim();
    if (!id) return;
    const selectedIds = new Set(
      (Array.isArray(this.channelBulkGrantSelectedChannelIds) ? this.channelBulkGrantSelectedChannelIds : [])
        .map((selectedId) => String(selectedId || '').trim())
        .filter(Boolean)
    );
    if (selected) selectedIds.add(id);
    else selectedIds.delete(id);
    const validIds = new Set(this.pgChannelBulkGrantChannelOptions.map((channel) => channel.id));
    this.channelBulkGrantSelectedChannelIds = [...selectedIds].filter((selectedId) => validIds.has(selectedId));
  },

  selectAllChannelBulkGrantChannels() {
    this.channelBulkGrantSelectedChannelIds = this.pgChannelBulkGrantChannelOptions.map((channel) => channel.id);
  },

  clearChannelBulkGrantChannels() {
    this.channelBulkGrantSelectedChannelIds = [];
  },

  get selectedChannelGrantPrincipalKey() {
    const principalType = String(this.channelGrantPrincipalType || '').trim();
    const principalId = this.resolveChannelGrantPrincipalId();
    if (!['actor', 'group'].includes(principalType) || !principalId) return '';
    return `${principalType}:${principalId}`;
  },

  get selectedChannelGrantAlreadyExists() {
    const key = this.selectedChannelGrantPrincipalKey;
    if (!key) return false;
    return (this.channelGrantRows || []).some((grant) => grant?.key === key);
  },

  get canCreateSelectedChannelGrant() {
    return Boolean(
      this.canManageSelectedPgChannelGrants
      && this.selectedChannelGrantPrincipalKey
      && !this.selectedChannelGrantAlreadyExists
    );
  },

  get selectedChannelGrantDraftMessage() {
    if (!this.selectedChannelGrantPrincipalKey) return 'Select a user or group to grant access.';
    if (this.selectedChannelGrantAlreadyExists) return 'This user or group already has access. Change the permission in the list below.';
    return this.getPgChannelGrantCapacityDescription(this.channelGrantCapacity);
  },

  getPgChannelGrantPrincipalLabel(grant) {
    const rawPrincipalType = String(grant?.principal_type || grant?.stored_principal_type || '').trim();
    const principalType = rawPrincipalType === 'person' ? 'actor' : rawPrincipalType;
    const principalId = String(grant?.principal_id || grant?.principal?.actor_id || grant?.principal?.id || '').trim();
    if (principalType === 'group') {
      return this.getPgGroupLabel(principalId);
    }
    const npub = this.getPgChannelGrantPrincipalNpub(grant);
    if (npub) return this.getSenderName(npub);
    return principalId;
  },

  getPgChannelGrantPrincipalNpub(grant) {
    const rawPrincipalType = String(grant?.principal_type || grant?.stored_principal_type || '').trim();
    const principalType = rawPrincipalType === 'person' ? 'actor' : rawPrincipalType;
    const principalId = String(grant?.principal_id || grant?.principal?.actor_id || grant?.principal?.id || '').trim();
    if (principalType !== 'actor') return '';
    const directNpub = String(grant?.principal_npub || grant?.actor_npub || grant?.npub || grant?.principal?.npub || '').trim();
    if (directNpub) return directNpub;
    if (principalId.startsWith('npub1')) return principalId;
    if (!principalId) return '';
    const member = (this.pgWorkspaceMembers || []).find((entry) => entry.actor_id === principalId || entry.id === principalId);
    return String(member?.npub || '').trim();
  },

  getPgChannelGrantCapacityLabel(capacity) {
    const value = String(capacity || '').trim();
    return this.pgChannelGrantCapacityOptions.find((option) => option.value === value)?.label || 'Custom';
  },

  getPgChannelGrantCapacityDescription(capacity) {
    const value = String(capacity || '').trim();
    if (value === 'manager') return 'can view, post, and manage access';
    if (value === 'contributor') return 'can view and post';
    if (value === 'agent') return 'can view and create channel work as an agent';
    if (value === 'viewer') return 'can view only';
    return 'uses custom permissions';
  },

  describePgChannelGrantPermissions(permissions = []) {
    return (permissions || []).map(String).filter(Boolean).join(', ');
  },

  canEditPgChannelGrantRow(grant) {
    return Boolean(this.canManageSelectedPgChannelGrants && grant?.capacity !== 'custom');
  },

  async refreshPgChannelAccessMaterialization() {
    if (!isTowerPgBackendMode()) return;
    await hydrateTowerPgScopes(this);
    await hydrateTowerPgChannels(this);
    await Promise.all([
      hydrateTowerPgTasks(this),
      hydrateTowerPgDocumentsAndFiles(this),
      hydrateTowerPgAudioNotes(this),
    ]);
  },

  schedulePgChannelAccessMaterializationRefresh() {
    if (!isTowerPgBackendMode()) return;
    Promise.resolve()
      .then(() => this.refreshPgChannelAccessMaterialization())
      .catch((error) => {
        flightDeckLog('warn', 'settings', 'PG channel access materialization refresh failed', {
          error: error?.message || String(error),
        });
      });
  },

  async materializeSelectedDmParticipantsFromChannelGrants() {
    const channelId = String(this.selectedChannelId || '').trim();
    const channel = this.channels?.find((candidate) => candidate?.record_id === channelId) || null;
    if (!channel || !isDmChannel(channel)) return;
    if (!Array.isArray(this.pgWorkspaceMembers) || this.pgWorkspaceMembers.length === 0) {
      await this.refreshTowerPgWorkspaceMembers({ force: true, limit: 200 }).catch(() => []);
    }
    const byActorId = new Map((this.pgWorkspaceMembers || [])
      .filter((member) => member?.actor_id || member?.id)
      .map((member) => [String(member.actor_id || member.id), member]));
    const participantNpubs = new Set(
      (Array.isArray(channel.participant_npubs) ? channel.participant_npubs : [])
        .map((npub) => String(npub || '').trim())
        .filter(Boolean)
    );
    for (const grant of this.channelGrantRows || []) {
      const principalId = String(grant?.principal_id || '').trim();
      if (grant?.principal_type !== 'actor') continue;
      const directNpub = String(grant?.principal_npub || grant?.actor_npub || grant?.npub || '').trim();
      const npub = directNpub || (principalId.startsWith('npub1') ? principalId : String(byActorId.get(principalId)?.npub || '').trim());
      if (npub) participantNpubs.add(npub);
    }
    if (participantNpubs.size <= (channel.participant_npubs || []).length) return;
    const nextParticipants = [...participantNpubs];
    const nextChannel = {
      ...channel,
      channel_type: channel.channel_type || 'dm',
      participant_npubs: nextParticipants,
      description: channel.description || buildDmChannelDescription(nextParticipants),
    };
    await upsertChannel(nextChannel);
    this.channels = (this.channels || []).map((candidate) =>
      candidate?.record_id === channelId ? nextChannel : candidate
    );
    await this.rememberPeople?.(nextParticipants, 'channel-grants');
  },

  async createChannelGrant() {
    if (!isTowerPgBackendMode()) return;
    if (!this.canManageSelectedPgChannelGrants && this.canAttemptSelectedPgChannelGrantRead) {
      await this.refreshChannelGrants();
    }
    if (!this.canManageSelectedPgChannelGrants) {
      this.channelGrantsError = 'You do not have permission to manage grants for this channel.';
      return;
    }
    const channelId = String(this.selectedChannelId || '').trim();
    const principalType = String(this.channelGrantPrincipalType || '').trim();
    const principalId = this.resolveChannelGrantPrincipalId();
    if (!channelId) {
      this.channelGrantsError = 'Select a channel first.';
      return;
    }
    if (!['actor', 'group'].includes(principalType) || !principalId) {
      this.channelGrantsError = 'Select a user or group.';
      return;
    }
    if (this.selectedChannelGrantAlreadyExists) {
      this.channelGrantsError = 'This user or group already has access. Change the permission in the list below.';
      return;
    }

    this.channelGrantsSaving = true;
    this.channelGrantsError = null;
    this.channelGrantsNotice = '';
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await createTowerPgChannelGrant(workspaceId, channelId, {
        principal_type: principalType,
        principal_id: principalId,
        ...buildPgChannelGrantMutationPayload(this.channelGrantCapacity),
      }, { baseUrl, appNpub });
      if (principalType === 'actor' && typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
        const recipientNpub = (this.pgWorkspaceMembers || [])
          .find((member) => member.actor_id === principalId || member.id === principalId)?.npub || '';
        if (recipientNpub) {
          await this.publishPgOnboardingAnnouncementForGrant({
            recipientNpub,
            grantId: `${workspaceId}:${channelId}:${principalId}`,
            reason: 'added_to_workspace_or_group',
          });
        }
      }
      await this.refreshChannelGrants();
      this.schedulePgChannelAccessMaterializationRefresh();
      this.channelGrantsNotice = 'Channel access updated.';
    } catch (error) {
      if (error?.code === 'permission_denied') {
        this.channelGrantsError = describePgPermissionDenied(error, 'grant channel access');
        await this.refreshChannelGrants().catch(() => {});
      } else {
        this.channelGrantsError = error?.message || 'Failed to grant channel access';
      }
    } finally {
      this.channelGrantsSaving = false;
    }
  },

  async updateChannelGrantCapacity(grant, capacity) {
    if (!isTowerPgBackendMode()) return;
    const nextCapacity = String(capacity || '').trim();
    if (!grant || grant.capacity === 'custom' || nextCapacity === 'custom') return;
    if (!this.canManageSelectedPgChannelGrants) {
      this.channelGrantsError = 'You do not have permission to manage grants for this channel.';
      return;
    }
    const channelId = String(this.selectedChannelId || '').trim();
    const principalType = String(grant.principal_type || '').trim();
    const principalId = String(grant.principal_id || '').trim();
    if (!channelId || !principalType || !principalId) {
      this.channelGrantsError = 'Select a channel grant first.';
      return;
    }

    this.channelGrantsSaving = true;
    this.channelGrantsError = null;
    this.channelGrantsNotice = '';
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await updateTowerPgChannelGrant(
        workspaceId,
        channelId,
        principalType,
        principalId,
        buildPgChannelGrantMutationPayload(nextCapacity),
        { baseUrl, appNpub },
      );
      await this.refreshChannelGrants();
      this.schedulePgChannelAccessMaterializationRefresh();
      this.channelGrantsNotice = 'Channel access updated.';
    } catch (error) {
      if (error?.code === 'permission_denied') {
        this.channelGrantsError = describePgPermissionDenied(error, 'update channel access');
        await this.refreshChannelGrants().catch(() => {});
      } else {
        this.channelGrantsError = error?.message || 'Failed to update channel access';
      }
    } finally {
      this.channelGrantsSaving = false;
    }
  },

  async applyChannelBulkGrant() {
    if (!isTowerPgBackendMode()) return;
    if (!this.canManageSelectedPgChannelGrants) {
      this.channelGrantsError = 'You do not have permission to manage grants for this channel.';
      return;
    }
    const principalType = String(this.channelBulkGrantPrincipalType || '').trim();
    const principalId = this.resolveChannelBulkGrantPrincipalId();
    const capacity = String(this.channelBulkGrantCapacity || '').trim();
    const selectedIds = new Set(
      (Array.isArray(this.channelBulkGrantSelectedChannelIds) ? this.channelBulkGrantSelectedChannelIds : [])
        .map((channelId) => String(channelId || '').trim())
        .filter(Boolean)
    );
    const targetChannels = this.pgChannelBulkGrantChannelOptions.filter((channel) => selectedIds.has(channel.id));
    if (!['actor', 'group'].includes(principalType) || !principalId) {
      this.channelGrantsError = 'Select a user or group.';
      return;
    }
    if (targetChannels.length === 0) {
      this.channelGrantsError = 'Select at least one channel.';
      return;
    }

    this.channelBulkGrantBusy = true;
    this.channelGrantsSaving = true;
    this.channelGrantsError = null;
    this.channelGrantsNotice = '';
    this.channelBulkGrantProgress = `0 / ${targetChannels.length}`;
    const summary = {
      created: 0,
      updated: 0,
      unchanged: 0,
      customSkipped: 0,
      failed: [],
    };
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      const principalKey = `${principalType}:${principalId}`;
      for (let index = 0; index < targetChannels.length; index += 1) {
        const channel = targetChannels[index];
        this.channelBulkGrantProgress = `${index + 1} / ${targetChannels.length}: ${channel.label}`;
        try {
          const result = await getTowerPgChannelGrants(workspaceId, channel.id, { baseUrl, appNpub });
          const rows = aggregatePgChannelGrants(result?.grants || []);
          const existing = rows.find((grant) => grant?.key === principalKey);
          if (existing?.capacity === 'custom') {
            summary.customSkipped += 1;
            continue;
          }
          if (existing?.capacity === capacity) {
            summary.unchanged += 1;
            continue;
          }
          if (existing) {
            await updateTowerPgChannelGrant(
              workspaceId,
              channel.id,
              principalType,
              principalId,
              buildPgChannelGrantMutationPayload(capacity),
              { baseUrl, appNpub },
            );
            summary.updated += 1;
            continue;
          }
          await createTowerPgChannelGrant(workspaceId, channel.id, {
            principal_type: principalType,
            principal_id: principalId,
            ...buildPgChannelGrantMutationPayload(capacity),
          }, { baseUrl, appNpub });
          summary.created += 1;
        } catch (error) {
          summary.failed.push({
            channel: channel.label,
            message: error?.code === 'permission_denied'
              ? describePgPermissionDenied(error, 'grant channel access')
              : (error?.message || 'Failed to grant channel access'),
          });
        }
      }

      await this.refreshChannelGrants();
      this.schedulePgChannelAccessMaterializationRefresh();
      const parts = [
        summary.created ? `${summary.created} added` : '',
        summary.updated ? `${summary.updated} updated` : '',
        summary.unchanged ? `${summary.unchanged} already set` : '',
        summary.customSkipped ? `${summary.customSkipped} custom skipped` : '',
      ].filter(Boolean);
      this.channelGrantsNotice = parts.length > 0
        ? `Bulk access complete: ${parts.join(', ')}.`
        : 'Bulk access complete.';
      if (summary.failed.length > 0) {
        const failureLabels = summary.failed.slice(0, 3).map((failure) => `${failure.channel}: ${failure.message}`).join('; ');
        this.channelGrantsError = `${summary.failed.length} channel${summary.failed.length === 1 ? '' : 's'} failed. ${failureLabels}`;
      }
    } catch (error) {
      this.channelGrantsError = error?.message || 'Failed to apply channel access.';
    } finally {
      this.channelBulkGrantBusy = false;
      this.channelGrantsSaving = false;
      this.channelBulkGrantProgress = '';
    }
  },

  async removeChannelGrant(grant) {
    if (!isTowerPgBackendMode()) return;
    if (!this.canManageSelectedPgChannelGrants) {
      this.channelGrantsError = 'You do not have permission to manage grants for this channel.';
      return;
    }
    const channelId = String(this.selectedChannelId || '').trim();
    const principalType = String(grant?.principal_type || '').trim();
    const principalId = String(grant?.principal_id || '').trim();
    if (!channelId || !principalType || !principalId) {
      this.channelGrantsError = 'Select a channel grant first.';
      return;
    }

    this.channelGrantsSaving = true;
    this.channelGrantsError = null;
    this.channelGrantsNotice = '';
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await deleteTowerPgChannelGrant(workspaceId, channelId, principalType, principalId, { baseUrl, appNpub });
      await this.refreshChannelGrants();
      this.schedulePgChannelAccessMaterializationRefresh();
      this.channelGrantsNotice = 'Channel access removed.';
    } catch (error) {
      if (error?.code === 'permission_denied') {
        this.channelGrantsError = describePgPermissionDenied(error, 'remove channel access');
        await this.refreshChannelGrants().catch(() => {});
      } else {
        this.channelGrantsError = error?.message || 'Failed to remove channel access';
      }
    } finally {
      this.channelGrantsSaving = false;
    }
  },

  async refreshGroups(options = {}) {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub || !this.backendUrl) return;
    this.groupsLoadError = null;
    const force = options.force === true;
    const minIntervalMs = Number(options.minIntervalMs);
    const maxAgeMs = Number(options.maxAgeMs);
    const now = Date.now();
    const ageMs = this.lastGroupsRefreshAt > 0 ? now - this.lastGroupsRefreshAt : Infinity;
    const expiredByMaxAge = Number.isFinite(maxAgeMs) && maxAgeMs > 0 && ageMs >= maxAgeMs;
    if (
      !force
      && !expiredByMaxAge
      && Number.isFinite(minIntervalMs)
      && minIntervalMs > 0
      && this.lastGroupsRefreshAt > 0
      && this.groups.length > 0
      && ageMs < minIntervalMs
    ) {
      return this.groups;
    }
    try {
      if (isTowerPgBackendMode()) {
        const { workspaceId, workspaceOwnerNpub, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
        if (!workspaceId || !baseUrl) return this.groups;
        const [result] = await Promise.all([
          getTowerPgWorkspaceGroups(workspaceId, { baseUrl, appNpub, limit: 200 }),
          this.refreshTowerPgWorkspaceMembers({ limit: 200 }),
        ]);
        const mappedGroups = (result.groups || [])
          .map((group) => mapTowerPgGroupEntry(group, { workspaceOwnerNpub }))
          .filter((group) => group.group_id);
        const groupsChanged = !sameListBySignature(this.groups, mappedGroups, groupSignature);
        if (groupsChanged) {
          this.groups = mappedGroups;
          const memberNpubs = new Set();
          for (const group of mappedGroups) {
            await upsertGroup({
              ...group,
              member_npubs: [...(group.member_npubs ?? [])],
            });
            for (const memberNpub of [
              ...(group.member_npubs ?? []),
              ...(group.effective_member_npubs ?? []),
            ]) {
              if (memberNpub) memberNpubs.add(String(memberNpub));
            }
          }
          if (memberNpubs.size > 0) {
            await this.rememberPeople([...memberNpubs], 'pg-group');
          }
        }
        this.lastGroupsRefreshAt = Date.now();
        this.validateSelectedBoardId();
        this.normalizeTaskFilterTags();
        if (typeof this.normalizeSettingsTab === 'function') this.normalizeSettingsTab();
        return this.groups;
      }
      const [result, keyResult] = await Promise.all([
        getGroups(viewerNpub),
        getGroupKeys(viewerNpub),
      ]);
      const groups = result.groups ?? [];
      const mappedGroups = groups.map((group) => mapGroupEntry(group))
        .filter((group) => !this.workspaceOwnerNpub || group.owner_npub === this.workspaceOwnerNpub);
      const bootstrapResult = await bootstrapWrappedGroupKeys(keyResult.keys ?? []);
      const workspaceGroupRefs = new Set(
        mappedGroups.flatMap((group) => [group.group_id, group.group_npub]).filter(Boolean)
      );
      const relevantFailures = (bootstrapResult.failures || [])
        .filter((entry) => workspaceGroupRefs.has(entry.group_id) || workspaceGroupRefs.has(entry.group_npub));
      if (relevantFailures.length > 0 || (mappedGroups.length > 0 && (bootstrapResult.loaded || 0) === 0)) {
        flightDeckLog('warn', 'groups', 'group-key bootstrap diagnostics', {
          viewerNpub,
          workspaceOwnerNpub: this.workspaceOwnerNpub || null,
          visibleGroupCount: mappedGroups.length,
          wrappedKeyCount: (keyResult.keys || []).length,
          bootstrap: getLastGroupKeyBootstrapDiagnostics(),
          relevantFailures,
        });
      } else {
        flightDeckLog('debug', 'groups', 'group-key bootstrap complete', {
          viewerNpub,
          workspaceOwnerNpub: this.workspaceOwnerNpub || null,
          visibleGroupCount: mappedGroups.length,
          wrappedKeyCount: (keyResult.keys || []).length,
          loadedKeyCount: bootstrapResult.loaded || 0,
        });
      }
      const groupsChanged = !sameListBySignature(this.groups, mappedGroups, groupSignature);
      if (groupsChanged) {
        this.groups = mappedGroups;
        const memberNpubs = new Set();
        for (const group of mappedGroups) {
          await upsertGroup({
            ...group,
            member_npubs: [...(group.member_npubs ?? [])],
          });
          for (const memberNpub of group.member_npubs ?? []) {
            if (memberNpub) memberNpubs.add(String(memberNpub));
          }
        }
        if (memberNpubs.size > 0) {
          await this.rememberPeople([...memberNpubs], 'group');
        }
        if (this.navSection === 'chat') {
          await this.refreshChannels();
        }
      }
      this.lastGroupsRefreshAt = Date.now();
      this.validateSelectedBoardId();
      this.normalizeTaskFilterTags();
      if (typeof this.normalizeSettingsTab === 'function') this.normalizeSettingsTab();
      return this.groups;
    } catch (error) {
      this.groupsLoadError = error?.message || 'Failed to load groups';
      flightDeckLog('error', 'groups', 'refreshGroups failed', {
        viewerNpub,
        workspaceOwnerNpub: this.workspaceOwnerNpub || null,
        error: error?.message || String(error),
      });
      console.debug('refreshGroups failed:', error?.message || error);
      return this.groups;
    }
  },

  async createEncryptedGroup(name, memberNpubs = []) {
    const wrappedByNpub = this.session?.npub;
    const ownerNpub = this.workspaceOwnerNpub;
    if (!wrappedByNpub || !ownerNpub) throw new Error('Sign in first');

    const uniqueMembers = deduplicateMembers(wrappedByNpub, memberNpubs);
    const groupIdentity = createGroupIdentity();
    const memberKeys = await buildWrappedMemberKeys(groupIdentity, uniqueMembers, wrappedByNpub);
    const response = await createGroup({
      owner_npub: ownerNpub,
      name,
      group_npub: groupIdentity.npub,
      member_keys: memberKeys,
    });

    const group = mapCreatedGroup(response, name, ownerNpub);

    await upsertGroup(group);
    await this.refreshGroups();
    // Keep the freshly created epoch-1 key locally even if the follow-up
    // /groups/keys bootstrap path lags or fails for this render cycle.
    cacheGroupKey({
      group_id: group.group_id,
      group_npub: group.group_npub,
      name: group.name,
      key_version: group.current_epoch ?? 1,
      nsec: groupIdentity.nsec,
    });
    await this.rememberPeople(uniqueMembers, 'group');
    return group;
  },

  async addEncryptedGroupMember(groupId, memberNpub, options = {}) {
    const ownerNpub = this.session?.npub;
    if (!ownerNpub) throw new Error('Sign in first');

    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (!group?.group_id) throw new Error('Group not found');

    await addGroupMember(group.group_id || groupId, await wrapKnownGroupKeyForMember(group.group_id || group.group_npub, memberNpub, ownerNpub));
    await this.rememberPeople([memberNpub], 'group');
    if (options.refresh !== false) {
      await this.refreshGroups();
    }
  },

  async removeEncryptedGroupMember(groupId, memberNpub, options = {}) {
    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (!group?.group_id) throw new Error('Group not found');

    await deleteGroupMember(group.group_id, memberNpub);
    if (options.refresh !== false) {
      await this.refreshGroups();
    }
  },

  async rotateEncryptedGroup(groupId, memberNpubs, options = {}) {
    const wrappedByNpub = this.session?.npub;
    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (!wrappedByNpub) throw new Error('Sign in first');
    if (!group?.group_id) throw new Error('Group not found');

    const nextMembers = [...new Set((memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))];
    const groupIdentity = createGroupIdentity();
    const memberKeys = await buildWrappedMemberKeys(groupIdentity, nextMembers, wrappedByNpub);
    const response = await rotateGroup(group.group_id, {
      group_npub: groupIdentity.npub,
      member_keys: memberKeys,
      name: options.name || group.name,
    });

    const updatedGroup = mapRotatedGroup(response, groupIdentity, group, nextMembers, options);

    await upsertGroup(updatedGroup);
    if (options.refresh !== false) {
      await this.refreshGroups();
    }
    cacheGroupKey({
      group_id: updatedGroup.group_id,
      group_npub: updatedGroup.group_npub,
      name: updatedGroup.name,
      key_version: updatedGroup.current_epoch ?? group.current_epoch + 1,
      nsec: groupIdentity.nsec,
    });
    return updatedGroup;
  },

  async updateSharingGroupName(groupId, newName, options = {}) {
    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (!group) throw new Error('Group not found');

    const trimmed = String(newName || '').trim();
    if (!trimmed) throw new Error('Group name is required');
    if (trimmed === group.name) return group;

    const response = await updateGroup(group.group_id || groupId, { name: trimmed });
    group.name = response?.name || trimmed;
    await upsertGroup({ ...toRaw(group) });
    if (options.refresh !== false) {
      await this.refreshGroups();
    }
    return group;
  },

  applyAddressBookPeople(people = []) {
    const nextPeople = Array.isArray(people) ? people : [];
    if (sameListBySignature(this.addressBookPeople, nextPeople, (person) => [
      String(person?.npub || ''),
      String(person?.label || ''),
      String(person?.avatar_url || ''),
      String(person?.last_used_at || ''),
    ].join('|'))) {
      return;
    }
    this.addressBookPeople = nextPeople;
  },

  async refreshAddressBook() {
    this.applyAddressBookPeople(await getAddressBookPeople());
  },

  async applyChannels(channels = [], options = {}) {
    const allChannels = Array.isArray(channels) ? channels : [];
    const pgChannelVisibilityAuthoritative = Boolean(isTowerPgBackendMode() || this.currentWorkspace?.pgBackendMode);
    const visibleChannels = pgChannelVisibilityAuthoritative
      ? allChannels
      : filterChannelsForViewer(allChannels, this.session?.npub, this.workspaceOwnerNpub, this.groups);
    const savedChannelOrder = Array.isArray(this.channelOrder)
      ? this.channelOrder.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    this.channelOrder = visibleChannels.length > 0
      ? normalizeChannelOrder(savedChannelOrder, visibleChannels)
      : savedChannelOrder;
    const nextChannels = sortChannelsByOrder(visibleChannels, this.channelOrder);
    if (!sameListBySignature(this.channels, nextChannels, (channel) => [
      String(channel?.record_id || ''),
      String(channel?.updated_at || ''),
      String(channel?.version ?? ''),
      String(channel?.record_state || ''),
    ].join('|'))) {
      this.channels = nextChannels;
    }

    const participantNpubs = new Set();
    for (const channel of nextChannels) {
      for (const participantNpub of this.getChannelParticipants(channel)) {
        if (participantNpub) participantNpubs.add(String(participantNpub));
      }
    }
    if (participantNpubs.size > 0) {
      await this.rememberPeople([...participantNpubs], 'chat');
    }

    const selectedPgBoard = parsePgTaskBoardId(this.selectedBoardId);
    const pgScopeHome = Boolean((this.currentWorkspace?.pgBackendMode || this.pgBackendMode) && selectedPgBoard.type === 'scope' && selectedPgBoard.scopeId);
    let nextSelectedChannelId = pgScopeHome ? null : this.selectedChannelId;
    if (nextSelectedChannelId && !nextChannels.some((channel) => channel.record_id === nextSelectedChannelId)) {
      nextSelectedChannelId = nextChannels[0]?.record_id || null;
    }
    if (!nextSelectedChannelId && !pgScopeHome && nextChannels.length > 0) {
      nextSelectedChannelId = nextChannels[0].record_id;
    }

    if (nextSelectedChannelId !== this.selectedChannelId) {
      this.selectedChannelId = nextSelectedChannelId;
      this.mainFeedVisibleCount = this.MAIN_FEED_PAGE_SIZE;
      this.chatFeedNearTop = false;
      this.expandedChatMessageIds = [];
      this.truncatedChatMessageIds = [];
      this.closeThread({ syncRoute: false });
      this.pendingChatScrollToLatest = Boolean(nextSelectedChannelId);
      this.startSelectedChannelLiveQuery();
      if (options.syncRoute !== false) this.syncRoute(true);
    }

    if (!nextSelectedChannelId) {
      await this.applyMessages([], { scrollToLatest: false });
    }

    if (this.navSection === 'chat' && !pgScopeHome) {
      this.ensureSelectedChatChannelInScope({ syncRoute: options.syncRoute !== false });
    }

    this.updatePageTitle();
  },

  startChannelTabDrag(recordId, event = null) {
    const sourceId = String(recordId || '').trim();
    if (!sourceId) return;
    this.channelDragSourceId = sourceId;
    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', sourceId);
    }
  },

  handleChannelTabDragOver(recordId, event = null) {
    const targetId = String(recordId || '').trim();
    if (!this.channelDragSourceId || !targetId || this.channelDragSourceId === targetId) return;
    event?.preventDefault?.();
    if (event?.dataTransfer) event.dataTransfer.dropEffect = 'move';
  },

  async dropChannelTab(recordId, event = null) {
    event?.preventDefault?.();
    const sourceId = String(this.channelDragSourceId || event?.dataTransfer?.getData?.('text/plain') || '').trim();
    const targetId = String(recordId || '').trim();
    this.channelDragSourceId = '';
    if (!sourceId || !targetId || sourceId === targetId) return;

    const nextOrder = moveChannelInOrder(this.channelOrder, this.channels, sourceId, targetId);
    this.channelOrder = nextOrder;
    this.channels = sortChannelsByOrder(this.channels, nextOrder);
    if (typeof this.saveWorkspaceChannelOrder === 'function') {
      try {
        await this.saveWorkspaceChannelOrder(nextOrder);
      } catch (error) {
        this.error = error?.message || 'Failed to sync channel order.';
        flightDeckLog('warn', 'settings', 'channel order save failed', {
          error: error?.message || String(error),
        });
      }
    }
  },

  endChannelTabDrag() {
    this.channelDragSourceId = '';
  },

  async selectChannel(recordId, options = {}) {
    const openDocument = this.navSection === 'docs'
      && this.docsEditorOpen
      && this.selectedDocument?.record_id
      && String(recordId || '').trim() !== String(this.selectedChannelId || '').trim()
      ? this.selectedDocument
      : null;
    if (openDocument && typeof this.resetOpenDocumentForContextChange === 'function') {
      await this.resetOpenDocumentForContextChange(openDocument, { syncRoute: false });
    }
    this.selectedChannelId = recordId;
    const selectedChannel = (this.channels || []).find((channel) => channel?.record_id === recordId) || null;
    const selectedChannelScopeId = getChannelScopeId(selectedChannel);
    const isPgWorkspace = Boolean(this.currentWorkspace?.pgBackendMode || this.pgBackendMode);
    const shouldPromoteScope = !isPgWorkspace && selectedChannelScopeId
      && this.selectedBoardId !== selectedChannelScopeId
      && (!this.selectedBoardId
        || this.selectedBoardId === '__all__'
        || this.selectedBoardId === '__recent__'
        || this.selectedBoardId === '__unscoped__');
    if (isPgWorkspace && selectedChannel?.record_id) {
      const nextBoardId = buildPgChannelTaskBoardId(selectedChannel.record_id);
      if (nextBoardId && this.selectedBoardId !== nextBoardId) {
        this.selectedBoardId = nextBoardId;
        this.persistSelectedBoardId?.(nextBoardId);
        this.showBoardDescendantTasks = false;
        this.normalizeTaskFilterTags?.();
      }
    }
    if (shouldPromoteScope) {
      this.selectBoard?.(selectedChannelScopeId);
    }
    this.mainFeedVisibleCount = this.MAIN_FEED_PAGE_SIZE;
    this.chatFeedNearTop = false;
    this.expandedChatMessageIds = [];
    this.truncatedChatMessageIds = [];
    this.closeThread({ syncRoute: false });
    await this.applyMessages?.([], { scrollToLatest: false });
    this.pendingChatScrollToLatest = options.scrollToLatest !== false;
    this.startSelectedChannelLiveQuery();
    await this.refreshMessages?.({ scrollToLatest: options.scrollToLatest });
    await this.refreshDailyNotes?.();
    if (options.syncRoute !== false) this.syncRoute();
    this.ensureBackgroundSync(true);
    const selectedChannelUnreadCutoff = await this.captureSelectedChannelUnreadSnapshot(recordId);
    this.selectedChannelUnreadChannelId = recordId || null;
    this.selectedChannelUnreadCutoff = selectedChannelUnreadCutoff || null;
    // Mark this channel (and the chat section) as read
    await this.markChannelRead(recordId);
  },

  // --- group modals ---

  resetNewGroupDraft() {
    this.newGroupName = '';
    this.newGroupMemberQuery = '';
    this.newGroupMembers = [];
  },

  resetEditGroupDraft() {
    this.editGroupId = '';
    this.editGroupName = '';
    this.editGroupMemberQuery = '';
    this.editGroupMembers = [];
  },

  openNewGroupModal() {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can create groups.';
      return;
    }
    if (this.groupActionsLocked) return;
    this.resetNewGroupDraft();
    this.error = null;
    this.showNewGroupModal = true;
  },

  closeNewGroupModal() {
    if (this.groupCreatePending) return;
    this.showNewGroupModal = false;
    this.resetNewGroupDraft();
  },

  openEditGroupModal(groupId) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can edit groups.';
      return;
    }
    if (this.groupActionsLocked) return;
    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (!group) return;

    this.error = null;
    this.editGroupId = group.group_id || group.group_npub;
    this.editGroupName = group.name || '';
    this.editGroupMemberQuery = '';
    this.editGroupMembers = this.mapGroupDraftMembers(group.member_npubs ?? []);
    this.showEditGroupModal = true;
  },

  closeEditGroupModal() {
    if (this.groupEditPending) return;
    this.showEditGroupModal = false;
    this.resetEditGroupDraft();
  },

  isGroupDeletePending(groupId) {
    return this.groupDeletePendingId === groupId;
  },

  canRemoveEditGroupMember(memberNpub) {
    const activeGroup = this.groups.find((item) => item.group_id === this.editGroupId || item.group_npub === this.editGroupId);
    return memberNpub !== this.session?.npub && memberNpub !== activeGroup?.owner_npub;
  },

  async openNewChannelModal(options = {}) {
    const requestedScopeId = String(options.scopeId || '').trim();
    if (isTowerPgBackendMode() && !requestedScopeId && !this.currentConcretePgScopeId && !this.canCreateDmInCurrentScope) {
      this.openNewChannelScopePicker();
      return;
    }
    this.showNewChannelScopePicker = false;
    this.newChannelScopeId = requestedScopeId || this.currentConcretePgScopeId || '';
    this.newChannelMode = this.canCreateDmInCurrentScope ? 'dm' : 'channel';
    this.newChannelDmNpub = '';
    this.newChannelName = '';
    this.newChannelDescription = '';
    this.newChannelBasePrompt = '';
    this.newChannelGroupId = '';
    this.newChannelAccessLoading = false;
    this.newChannelAccessError = '';
    this.resetNewChannelAccessRows();
    this.showNewChannelModal = true;
    if (isTowerPgBackendMode() && this.newChannelMode === 'channel') {
      this.newChannelAccessLoading = true;
      try {
        await Promise.all([
          this.refreshTowerPgWorkspaceMembers?.({ force: true, limit: 200 }) ?? Promise.resolve([]),
          this.refreshGroups?.({ force: true, minIntervalMs: 0 }) ?? Promise.resolve([]),
        ]);
      } catch (error) {
        this.newChannelAccessError = error?.message || 'Failed to load users and groups.';
      } finally {
        this.newChannelAccessLoading = false;
      }
      if (!this.newChannelAccessError) {
        this.resetNewChannelAccessRows();
      }
    } else if (isTowerPgBackendMode()) {
      await this.refreshTowerPgWorkspaceMembers?.({ force: true, limit: 200 }).catch(() => []);
    }
  },

  closeNewChannelModal() {
    this.showNewChannelModal = false;
    this.newChannelScopeId = '';
  },

  get newChannelDmSuggestions() {
    if (isTowerPgBackendMode()) {
      // DMs are member-to-member: suggest from the workspace member directory.
      const exclude = new Set(
        [this.session?.npub, this.newChannelDmNpub]
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      );
      const needle = String(this.newChannelDmNpub || '').trim().toLowerCase();
      return (this.pgWorkspaceMembers || [])
        .map((member) => String(member?.npub || '').trim())
        .filter((npub) => npub && !exclude.has(npub))
        .filter((npub) => !needle
          || npub.toLowerCase().includes(needle)
          || String(this.getSenderName?.(npub) || '').toLowerCase().includes(needle))
        .slice(0, 8)
        .map((npub) => ({
          npub,
          label: this.getSenderName?.(npub) || npub,
          subtitle: this.getSenderSecondaryLabel?.(npub) || '',
          avatarUrl: this.getSenderAvatar?.(npub) || '',
        }));
    }
    if (typeof this.findPeopleSuggestions !== 'function') return [];
    return this.findPeopleSuggestions(this.newChannelDmNpub, [this.session?.npub, this.newChannelDmNpub]);
  },

  async selectNewChannelDm(npub) {
    const nextNpub = String(npub || '').trim();
    this.newChannelDmNpub = nextNpub;
    if (nextNpub) {
      this.resolveChatProfile?.(nextNpub);
      await this.rememberPeople?.([nextNpub], 'chat');
    }
  },

  get newChannelGroupOptions() {
    const sourceGroups = Array.isArray(this.currentWorkspaceContentGroups) && this.currentWorkspaceContentGroups.length > 0
      ? this.currentWorkspaceContentGroups
      : this.groups;
    return (sourceGroups || [])
      .map((group) => ({
        groupId: group.group_id || group.group_npub,
        label: group.name || 'Group',
        subtitle: group.group_kind === 'private'
          ? 'Private group'
          : `${(group.member_npubs || []).length} members`,
      }))
      .filter((group) => group.groupId);
  },

  findNewChannelGroupSuggestions(query) {
    const needle = String(query || '').trim().toLowerCase();
    const selectedGroupId = this.resolveGroupId(this.newChannelGroupId);
    const availableGroups = this.newChannelGroupOptions
      .filter((group) => group.groupId !== selectedGroupId);
    if (!needle) return availableGroups;
    return availableGroups.filter((group) =>
      String(group.label || '').toLowerCase().includes(needle)
      || String(group.groupId || '').toLowerCase().includes(needle)
      || String(group.subtitle || '').toLowerCase().includes(needle)
    );
  },

  selectNewChannelGroup(groupId) {
    const nextGroupId = this.resolveGroupId(groupId);
    this.newChannelGroupId = nextGroupId || '';
  },

  clearNewChannelGroup() {
    this.newChannelGroupId = '';
  },

  getNewChannelGroupLabel(groupId) {
    const resolvedGroupId = this.resolveGroupId(groupId);
    if (!resolvedGroupId) return 'Group';
    return this.newChannelGroupOptions.find((group) => group.groupId === resolvedGroupId)?.label || resolvedGroupId;
  },

  getNewChannelGroupSubtitle(groupId) {
    const resolvedGroupId = this.resolveGroupId(groupId);
    if (!resolvedGroupId) return '';
    return this.newChannelGroupOptions.find((group) => group.groupId === resolvedGroupId)?.subtitle || resolvedGroupId;
  },

  async createDmChannel() {
    const ownerNpub = this.workspaceOwnerNpub;
    const memberNpub = this.session?.npub;
    const targetNpub = this.newChannelDmNpub.trim();
    if (!ownerNpub || !memberNpub || !targetNpub) return;
    if (!this.canCreateDmInCurrentScope) {
      this.error = 'Select the DMs scope before creating a direct message.';
      return;
    }

    try {
      const existing = findExistingDmChannel(this.channels, [memberNpub, targetNpub]);
      if (existing?.record_id) {
        if (isTowerPgBackendMode()) {
          await ensureTowerPgDmChannel(this, targetNpub);
        }
        await this.selectChannel(existing.record_id, { syncRoute: false });
        this.closeNewChannelModal();
        return;
      }
      const dmDescription = buildDmChannelDescription([memberNpub, targetNpub]);
      const name = `DM: ${targetNpub}`;
      if (isTowerPgBackendMode()) {
        const channelRow = await ensureTowerPgDmChannel(this, targetNpub);
        this.channels = [...this.channels.filter((channel) => channel.record_id !== channelRow.record_id), channelRow];
        await this.selectChannel(channelRow.record_id, { syncRoute: false });
        this.scheduleChannelsRefresh('PG DM channel create');
        this.closeNewChannelModal();
        return;
      }
      const group = await this.createEncryptedGroup(name, [targetNpub]);
      const groupId = group.group_id;
      await this.rememberPeople([ownerNpub, targetNpub], 'chat');

      const channelId = crypto.randomUUID();
      const now = new Date().toISOString();
      const channelRow = {
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        description: dmDescription,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        channel_type: 'dm',
        scope_id: this.dmScopeId,
        scope_l1_id: this.dmScopeId,
        record_state: 'active',
        version: 1,
        updated_at: now,
      };

      await upsertChannel(channelRow);

      const envelope = await outboundChannel({
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        description: dmDescription,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        channel_type: 'dm',
        scope_id: this.dmScopeId,
        scope_l1_id: this.dmScopeId,
        record_state: 'active',
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
      await this.selectChannel(channelId, { syncRoute: false });
      this.closeNewChannelModal();
    } catch (e) {
      if (e?.code === 'dm_participant_not_member') {
        this.error = 'They are not in this workspace yet — ask an admin to add them before starting a DM.';
      } else if (e?.code === 'permission_denied') {
        this.error = describePgPermissionDenied(e, 'create this direct message');
      } else {
        this.error = e.message;
      }
    }
  },

  async createNamedChannel() {
    const ownerNpub = this.workspaceOwnerNpub;
    const title = this.newChannelName.trim();
    const selectedGroupRef = this.newChannelGroupId;
    const groupId = this.resolveGroupId(selectedGroupRef);
    const initialGrants = buildChannelAccessGrantPayloads(this.newChannelAccessRows);
    if (isTowerPgBackendMode() && initialGrants.length === 0 && groupId) {
      initialGrants.push({
        principal_type: 'group',
        principal_id: groupId,
        access_level: 'contribute',
      });
    }
    if (!ownerNpub || !title || (!groupId && !isTowerPgBackendMode())) return;
    if (isTowerPgBackendMode() && initialGrants.length === 0) {
      this.error = 'Add at least one access row before creating a channel.';
      return;
    }

    try {
      if (isTowerPgBackendMode()) {
        const { workspaceId, workspaceOwnerNpub, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
        const boardScopeId = this.scopesMap?.has?.(this.selectedBoardId) ? this.selectedBoardId : '';
        const scopeId = String(this.newChannelScopeId || '').trim()
          || this.selectedBoardScope?.record_id
          || boardScopeId
          || this.selectedChannel?.scope_id
          || '';
        if (!workspaceId || !baseUrl || !scopeId) throw new Error('Select a PG scope before creating a channel.');
        const existing = findExistingNamedChannel(this.channels, title, scopeId);
        if (existing?.record_id) {
          await this.selectChannel(existing.record_id, { syncRoute: false });
          this.closeNewChannelModal();
          return;
        }
        const result = await createTowerPgScopeChannel(workspaceId, scopeId, {
          name: title,
          description: String(this.newChannelDescription || '').trim() || undefined,
          metadata: {
            basePrompt: String(this.newChannelBasePrompt || '').trim(),
          },
          kind: 'channel',
          grants: initialGrants,
        }, { baseUrl, appNpub });
        const channelRow = mapPgChannelToLocal(result.channel, { workspaceOwnerNpub });
        try {
          await upsertChannel(channelRow);
        } catch (cacheError) {
          flightDeckLog('warn', 'settings', 'PG channel cache write failed after create', {
            error: cacheError?.message || String(cacheError),
          });
        }
        this.channels = [...this.channels.filter((channel) => channel.record_id !== channelRow.record_id), channelRow];
        await this.selectChannel(channelRow.record_id, { syncRoute: false });
        this.scheduleChannelsRefresh('PG channel create');
        this.closeNewChannelModal();
        return;
      }
      const group = this.groups.find(g => g.group_id === groupId || g.group_npub === selectedGroupRef || g.group_npub === groupId);
      const participants = group?.member_npubs ?? [ownerNpub];

      const channelId = crypto.randomUUID();
      const now = new Date().toISOString();
      const channelRow = {
        record_id: channelId,
        owner_npub: ownerNpub,
        title,
        group_ids: [groupId],
        participant_npubs: [...new Set(participants)],
        record_state: 'active',
        version: 1,
        updated_at: now,
      };

      await upsertChannel(channelRow);

      const envelope = await outboundChannel({
        record_id: channelId,
        owner_npub: ownerNpub,
        title,
        group_ids: [groupId],
        participant_npubs: [...new Set(participants)],
        record_state: 'active',
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
      await this.selectChannel(channelId, { syncRoute: false });
      this.closeNewChannelModal();
    } catch (e) {
      if (isTowerPgBackendMode() && towerPgErrorCode(e) === 'duplicate_channel') {
        try {
          await hydrateTowerPgChannels(this);
          if (typeof this.refreshChannels === 'function') await this.refreshChannels();
          const boardScopeId = this.scopesMap?.has?.(this.selectedBoardId) ? this.selectedBoardId : '';
          const scopeId = String(this.newChannelScopeId || '').trim()
            || this.selectedBoardScope?.record_id
            || boardScopeId
            || this.selectedChannel?.scope_id
            || '';
          const existing = findExistingNamedChannel(this.channels, title, scopeId);
          if (existing?.record_id) {
            await this.selectChannel(existing.record_id, { syncRoute: false });
            this.closeNewChannelModal();
            return;
          }
        } catch {
          // Preserve the original duplicate-channel error below.
        }
        this.error = 'A channel with that name already exists in this scope.';
        return;
      }
      this.error = e.message;
    }
  },

  addPendingGroupMember(suggestion) {
    if (!suggestion || this.groupCreatePending) return;
    if (this.newGroupMembers.some((member) => member.npub === suggestion.npub)) return;
    this.newGroupMembers = [...this.newGroupMembers, suggestion];
    this.newGroupMemberQuery = '';
  },

  addGroupMemberFromQuery() {
    if (this.groupCreatePending) return;
    const { added, members } = this.consumeGroupMemberQuery(this.newGroupMemberQuery, this.newGroupMembers);
    if (added) {
      this.newGroupMembers = members;
      this.newGroupMemberQuery = '';
    }
  },

  removePendingGroupMember(npub) {
    if (this.groupCreatePending) return;
    this.newGroupMembers = this.newGroupMembers.filter((member) => member.npub !== npub);
  },

  addPendingEditGroupMember(suggestion) {
    if (!suggestion || this.groupEditPending) return;
    if (this.editGroupMembers.some((member) => member.npub === suggestion.npub)) return;
    this.editGroupMembers = [...this.editGroupMembers, suggestion];
    this.editGroupMemberQuery = '';
  },

  addEditGroupMemberFromQuery() {
    if (this.groupEditPending) return;
    const { added, members } = this.consumeGroupMemberQuery(this.editGroupMemberQuery, this.editGroupMembers);
    if (added) {
      this.editGroupMembers = members;
      this.editGroupMemberQuery = '';
    }
  },

  removePendingEditGroupMember(npub) {
    if (this.groupEditPending || !this.canRemoveEditGroupMember(npub)) return;
    this.editGroupMembers = this.editGroupMembers.filter((member) => member.npub !== npub);
  },

  async createSharingGroup() {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can create groups.';
      return;
    }
    if (this.groupCreatePending) return;
    this.error = null;
    const ownerNpub = this.session?.npub;
    if (!ownerNpub) {
      this.error = 'Sign in first';
      return;
    }
    if (!this.newGroupName.trim()) {
      this.error = 'Group name is required';
      return;
    }

    const { members } = this.consumeGroupMemberQuery(this.newGroupMemberQuery, this.newGroupMembers);
    this.newGroupMembers = members;
    this.newGroupMemberQuery = '';

    const memberNpubs = [...new Set([ownerNpub, ...members.map((member) => member.npub)])];
    this.groupCreatePending = true;

    try {
      if (isTowerPgBackendMode()) {
        const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
        if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
        const created = await createTowerPgWorkspaceGroup(workspaceId, {
          name: this.newGroupName.trim(),
          kind: 'custom',
        }, { baseUrl, appNpub });
        const groupId = created.group?.group_id || created.group?.id;
        if (!groupId) throw new Error('Tower PG did not return a group id');
        for (const memberNpub of [...new Set(members.map((member) => member.npub))]) {
          await createTowerPgWorkspaceMember(workspaceId, {
            member_npub: memberNpub,
            role: 'member',
            kind: 'human',
          }, { baseUrl, appNpub });
          await addTowerPgWorkspaceGroupMember(workspaceId, groupId, {
            member_npub: memberNpub,
          }, { baseUrl, appNpub });
          if (typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
            await this.publishPgOnboardingAnnouncementForGrant({
              recipientNpub: memberNpub,
              grantId: `${workspaceId}:${groupId}:${memberNpub}`,
              reason: 'added_to_workspace_or_group',
            });
          }
        }
        this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
        await this.rememberPeople(members.map((member) => member.npub), 'pg-group');
        this.showNewGroupModal = false;
        this.resetNewGroupDraft();
        return;
      }
      await this.createEncryptedGroup(this.newGroupName.trim(), memberNpubs);
      await this.rememberPeople(members.map((member) => member.npub), 'group');
      this.showNewGroupModal = false;
      this.resetNewGroupDraft();
    } catch (error) {
      this.error = towerPgErrorCode(error) === 'duplicate_group'
        ? 'A group with this name already exists.'
        : (error?.message || 'Failed to create group');
    } finally {
      this.groupCreatePending = false;
    }
  },

  async renameSharingGroup(groupId, newName) {
    this.error = null;
    try {
      await this.updateSharingGroupName(groupId, newName);
    } catch (error) {
      this.error = error?.message || 'Failed to rename group';
    }
  },

  async saveGroupEdits() {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can edit groups.';
      return;
    }
    if (this.groupEditPending) return;
    this.error = null;

    const group = this.groups.find((item) => item.group_id === this.editGroupId || item.group_npub === this.editGroupId);
    if (!group?.group_id) {
      this.error = 'Group not found';
      return;
    }

    const trimmedName = String(this.editGroupName || '').trim();
    if (!trimmedName) {
      this.error = 'Group name is required';
      return;
    }
    if (this.isProtectedWorkspaceGroup(group) && trimmedName !== group.name) {
      this.error = 'Protected system groups cannot be renamed.';
      return;
    }

    const { members } = this.consumeGroupMemberQuery(this.editGroupMemberQuery, this.editGroupMembers);
    this.editGroupMembers = members;
    this.editGroupMemberQuery = '';

    const desiredMembers = [...new Set(members.map((member) => String(member.npub || '').trim()).filter(Boolean))];
    if (desiredMembers.length === 0) {
      this.error = 'Group must have at least one member';
      return;
    }

    const existingMembers = [...new Set((group.member_npubs ?? []).map((member) => String(member || '').trim()).filter(Boolean))];
    const { membersToAdd, membersToRemove } = computeGroupMemberDiff(desiredMembers, existingMembers);

    if (trimmedName === group.name && membersToAdd.length === 0 && membersToRemove.length === 0) {
      this.closeEditGroupModal();
      return;
    }

    this.groupEditPending = true;

    try {
      if (isTowerPgBackendMode()) {
        if (trimmedName !== group.name) {
          throw new Error('PG group renaming is not available yet.');
        }
        const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
        if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
        const actorIdByNpub = new Map();
        for (const member of this.pgWorkspaceMembers || []) {
          if (member?.npub && member?.actor_id) actorIdByNpub.set(member.npub, member.actor_id);
        }
        for (const memberNpub of membersToAdd) {
          await createTowerPgWorkspaceMember(workspaceId, {
            member_npub: memberNpub,
            role: 'member',
            kind: 'human',
          }, { baseUrl, appNpub });
          await addTowerPgWorkspaceGroupMember(workspaceId, group.group_id, {
            member_npub: memberNpub,
          }, { baseUrl, appNpub });
          if (typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
            await this.publishPgOnboardingAnnouncementForGrant({
              recipientNpub: memberNpub,
              grantId: `${workspaceId}:${group.group_id}:${memberNpub}`,
              reason: 'added_to_workspace_or_group',
            });
          }
        }
        for (const memberNpub of membersToRemove) {
          const actorId = actorIdByNpub.get(memberNpub)
            || group.members?.find((member) => member.npub === memberNpub)?.actor_id
            || '';
          if (actorId) {
            await removeTowerPgWorkspaceGroupMember(workspaceId, group.group_id, actorId, { baseUrl, appNpub });
          }
        }
        await this.rememberPeople(desiredMembers, 'pg-group');
        this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
        this.showEditGroupModal = false;
        this.resetEditGroupDraft();
        return;
      }
      if (membersToRemove.length > 0) {
        await this.rotateEncryptedGroup(group.group_id, desiredMembers, {
          name: trimmedName,
          refresh: false,
        });
      } else {
        if (trimmedName !== group.name) {
          await this.updateSharingGroupName(group.group_id, trimmedName, { refresh: false });
        }
        for (const memberNpub of membersToAdd) {
          await this.addEncryptedGroupMember(group.group_id, memberNpub, { refresh: false });
        }
      }

      await this.rememberPeople(desiredMembers, 'group');
      await this.refreshGroups();
      this.showEditGroupModal = false;
      this.resetEditGroupDraft();
    } catch (error) {
      this.error = error?.message || 'Failed to update group';
    } finally {
      this.groupEditPending = false;
    }
  },

  async deleteSharingGroup(groupId) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can delete groups.';
      return;
    }
    if (this.groupDeletePendingId || this.groupCreatePending || this.groupEditPending) return;
    if (this.isProtectedWorkspaceGroup(groupId)) {
      this.error = 'Protected system groups cannot be deleted.';
      return;
    }
    if (isTowerPgBackendMode()) {
      this.error = 'PG group deletion is not available yet.';
      return;
    }
    const ownerNpub = this.session?.npub || this.ownerNpub;
    if (!ownerNpub || !groupId) {
      this.error = 'Select a group first';
      return;
    }

    const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete group "${group?.name || 'Untitled group'}"?`);
      if (!confirmed) return;
    }

    this.error = null;
    this.groupDeletePendingId = groupId;
    try {
      await deleteGroup(groupId);
      await deleteGroupById(groupId);
      this.groups = this.groups.filter((item) => item.group_id !== groupId && item.group_npub !== groupId);
      if (this.editGroupId === groupId) {
        this.showEditGroupModal = false;
        this.resetEditGroupDraft();
      }
    } catch (error) {
      this.error = error?.message || 'Failed to delete group';
    } finally {
      this.groupDeletePendingId = null;
    }
  },

  // --- Share invite link ---

  resetShareInvite() {
    this.shareInviteNpub = '';
    this.shareInviteGroupId = '';
    this.shareInviteUrl = '';
    this.shareInvitePending = false;
    this.shareInviteError = null;
    this.shareInviteCopied = false;
  },

  getPgWorkspaceMemberLabel(memberOrNpub) {
    const npub = typeof memberOrNpub === 'string'
      ? memberOrNpub
      : String(memberOrNpub?.npub || '').trim();
    if (!npub) return 'Unknown member';
    return this.getSenderName(npub) || npub;
  },

  getPgWorkspaceMemberActorId(npub) {
    const target = String(npub || '').trim();
    if (!target) return '';
    return String((this.pgWorkspaceMembers || []).find((member) => member.npub === target)?.actor_id || '').trim();
  },

  getPgChildGroupCandidates(parentGroupId) {
    const parentId = String(parentGroupId || '').trim();
    const parent = this.groups.find((group) => group.group_id === parentId);
    const existingChildren = new Set(parent?.child_group_ids || []);
    return (this.currentWorkspaceGroups || [])
      .filter((group) =>
        group.group_id
        && group.group_id !== parentId
        && !existingChildren.has(group.group_id)
      );
  },

  getPgGroupMemberCandidates(groupId) {
    const targetGroupId = String(groupId || '').trim();
    const group = this.groups.find((item) => item.group_id === targetGroupId || item.group_npub === targetGroupId);
    const existingMembers = new Set((group?.member_npubs || []).map((member) => String(member || '').trim()).filter(Boolean));
    return (this.pgWorkspaceMembers || [])
      .filter((member) => member?.npub && !existingMembers.has(member.npub))
      .map((member) => ({
        npub: member.npub,
        label: this.getPgWorkspaceMemberLabel(member),
        role: member.role || 'member',
      }));
  },

  getPgGroupLabel(groupId) {
    const id = String(groupId || '').trim();
    return this.groups.find((group) => group.group_id === id)?.name || id;
  },

  handlePgChildGroupSelection(parentGroupId, childGroupId) {
    this.pgChildGroupDrafts = {
      ...(this.pgChildGroupDrafts || {}),
      [parentGroupId]: String(childGroupId || '').trim(),
    };
  },

  handlePgGroupMemberSelection(groupId, memberNpub) {
    const id = String(groupId || '').trim();
    if (!id) return;
    this.pgGroupMemberDrafts = {
      ...(this.pgGroupMemberDrafts || {}),
      [id]: String(memberNpub || '').trim(),
    };
  },

  async addPgWorkspaceMember() {
    if (!isTowerPgBackendMode()) return;
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can add members.';
      return;
    }
    const memberNpub = String(this.pgWorkspaceMemberNpub || '').trim();
    if (!memberNpub || !FULL_NPUB_PATTERN.test(memberNpub)) {
      this.error = 'Enter a full valid npub.';
      return;
    }
    this.groupEditPending = true;
    this.error = null;
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await createTowerPgWorkspaceMember(workspaceId, {
        member_npub: memberNpub,
        role: 'member',
        kind: 'human',
      }, { baseUrl, appNpub });
      if (typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
        await this.publishPgOnboardingAnnouncementForGrant({
          recipientNpub: memberNpub,
          grantId: `${workspaceId}:workspace:${memberNpub}`,
          reason: 'added_to_workspace_or_group',
        });
      }
      this.pgWorkspaceMemberNpub = '';
      this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
    } catch (error) {
      this.error = error?.message || 'Failed to add workspace member';
    } finally {
      this.groupEditPending = false;
    }
  },

  async addPgGroupMember(groupId) {
    if (!isTowerPgBackendMode()) return;
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can add group members.';
      return;
    }
    const targetGroupId = String(groupId || '').trim();
    const memberNpub = String(this.pgGroupMemberDrafts?.[targetGroupId] || '').trim();
    if (!targetGroupId || !memberNpub) return;
    this.groupEditPending = true;
    this.error = null;
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await addTowerPgWorkspaceGroupMember(workspaceId, targetGroupId, {
        member_npub: memberNpub,
      }, { baseUrl, appNpub });
      if (typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
        await this.publishPgOnboardingAnnouncementForGrant({
          recipientNpub: memberNpub,
          grantId: `${workspaceId}:${targetGroupId}:${memberNpub}`,
          reason: 'added_to_workspace_or_group',
        });
      }
      this.pgGroupMemberDrafts = { ...(this.pgGroupMemberDrafts || {}), [targetGroupId]: '' };
      this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
    } catch (error) {
      this.error = error?.message || 'Failed to add group member';
    } finally {
      this.groupEditPending = false;
    }
  },

  async addPgChildGroup(parentGroupId) {
    if (!isTowerPgBackendMode()) return;
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can nest groups.';
      return;
    }
    const parentId = String(parentGroupId || '').trim();
    const childGroupId = String(this.pgChildGroupDrafts?.[parentId] || '').trim();
    if (!parentId || !childGroupId) return;
    this.groupEditPending = true;
    this.error = null;
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await addTowerPgWorkspaceChildGroup(workspaceId, parentId, {
        child_group_id: childGroupId,
      }, { baseUrl, appNpub });
      this.pgChildGroupDrafts = { ...(this.pgChildGroupDrafts || {}), [parentId]: '' };
      this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
    } catch (error) {
      this.error = error?.message || 'Failed to nest group';
    } finally {
      this.groupEditPending = false;
    }
  },

  async removePgChildGroup(parentGroupId, childGroupId) {
    if (!isTowerPgBackendMode()) return;
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can update group nesting.';
      return;
    }
    this.groupEditPending = true;
    this.error = null;
    try {
      const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
      if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
      await removeTowerPgWorkspaceChildGroup(workspaceId, parentGroupId, childGroupId, { baseUrl, appNpub });
      this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
    } catch (error) {
      this.error = error?.message || 'Failed to remove nested group';
    } finally {
      this.groupEditPending = false;
    }
  },

  async generateShareLink() {
    if (!this.canAdminWorkspace) {
      this.shareInviteError = 'Only workspace admins can generate invite links.';
      return;
    }
    const inviteeNpub = String(this.shareInviteNpub || '').trim();
    const groupId = String(this.shareInviteGroupId || '').trim();

    if (!inviteeNpub || !FULL_NPUB_PATTERN.test(inviteeNpub)) {
      this.shareInviteError = 'Enter a full valid npub for the invitee';
      return;
    }
    if (!groupId) {
      this.shareInviteError = 'Select a group';
      return;
    }
    if (!this.session?.npub) {
      this.shareInviteError = 'Sign in first';
      return;
    }

    this.shareInvitePending = true;
    this.shareInviteError = null;
    this.shareInviteUrl = '';
    this.shareInviteCopied = false;

    try {
      const group = this.groups.find((g) => g.group_id === groupId || g.group_npub === groupId);
      if (!group) throw new Error('Group not found');

      const alreadyMember = (group.member_npubs || []).includes(inviteeNpub);
      if (!alreadyMember) {
        if (isTowerPgBackendMode()) {
          const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
          if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
          await createTowerPgWorkspaceMember(workspaceId, {
            member_npub: inviteeNpub,
            role: 'member',
            kind: 'human',
          }, { baseUrl, appNpub });
          await addTowerPgWorkspaceGroupMember(workspaceId, groupId, {
            member_npub: inviteeNpub,
          }, { baseUrl, appNpub });
          let announcementStatus = null;
          if (typeof this.publishPgOnboardingAnnouncementForGrant === 'function') {
            announcementStatus = await this.publishPgOnboardingAnnouncementForGrant({
              recipientNpub: inviteeNpub,
              grantId: `${workspaceId}:${groupId}:${inviteeNpub}`,
              reason: 'added_to_workspace_or_group',
            });
          }
          this.scheduleGroupsRefresh({ force: true, minIntervalMs: 0 }, 'PG group write');
          this.shareInviteUrl = announcementStatus?.status === 'published'
            ? 'Member added to this PG workspace and onboarding announcement published.'
            : 'Member added to this PG workspace and group. Onboarding announcement needs retry.';
          return;
        }
        await this.addEncryptedGroupMember(groupId, inviteeNpub);
      }

      const workspace = this.currentWorkspace;
      const token = workspace?.connectionToken || buildSuperBasedConnectionToken({
        directHttpsUrl: this.backendUrl,
        serviceNpub: workspace?.serviceNpub || this.connectHostServiceNpub || '',
        towerName: workspace?.towerName || this.superbasedConnectionConfig?.towerName || '',
        towerDescription: workspace?.towerDescription || this.superbasedConnectionConfig?.towerDescription || '',
        workspaceOwnerNpub: this.workspaceOwnerNpub,
        appNpub: workspace?.appNpub || APP_NPUB,
      });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      this.shareInviteUrl = `${origin}?token=${encodeURIComponent(token)}`;
    } catch (error) {
      this.shareInviteError = error?.message || 'Failed to generate share link';
    } finally {
      this.shareInvitePending = false;
    }
  },

  async copyShareLink() {
    if (!this.shareInviteUrl) return;
    try {
      await navigator.clipboard.writeText(this.shareInviteUrl);
      this.shareInviteCopied = true;
      setTimeout(() => { this.shareInviteCopied = false; }, 2000);
    } catch {
      this.shareInviteError = 'Failed to copy link';
    }
  },
};
