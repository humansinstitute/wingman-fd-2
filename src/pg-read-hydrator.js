import { APP_NPUB } from './app-identity.js';
import {
  getTowerPgChannelThreads,
  getTowerPgScopeChannels,
  getTowerPgWorkspaceScopes,
} from './api.js';
import {
  replaceChannelsForOwner,
  replacePgThreadsForChannel,
  replaceScopesForOwner,
} from './db.js';

function trimText(value) {
  return String(value ?? '').trim();
}

function isoTimestamp(value) {
  return trimText(value) || new Date().toISOString();
}

function rowVersion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function descriptorLinks(workspace = {}) {
  const descriptor = workspace.pgDescriptor && typeof workspace.pgDescriptor === 'object'
    ? workspace.pgDescriptor
    : {};
  return descriptor.links && typeof descriptor.links === 'object' ? descriptor.links : {};
}

export function resolveTowerPgWorkspaceContext(store = {}) {
  const workspace = store.currentWorkspace || {};
  const descriptor = workspace.pgDescriptor && typeof workspace.pgDescriptor === 'object'
    ? workspace.pgDescriptor
    : {};
  const identity = descriptor.identity && typeof descriptor.identity === 'object'
    ? descriptor.identity
    : {};
  const workspaceId = trimText(workspace.workspaceId || identity.workspace_id || identity.workspaceId);
  const workspaceOwnerNpub = trimText(
    store.workspaceOwnerNpub
    || workspace.workspaceOwnerNpub
    || identity.workspace_owner_npub
    || identity.workspaceOwnerNpub
  );
  const baseUrl = trimText(workspace.directHttpsUrl || descriptor.tower_base_url || descriptor.towerBaseUrl || store.backendUrl);
  const appNpub = trimText(workspace.appNpub || identity.app_npub || identity.appNpub || APP_NPUB || 'flightdeck_pg');
  return {
    workspace,
    workspaceId,
    workspaceOwnerNpub,
    baseUrl,
    appNpub,
    links: descriptorLinks(workspace),
  };
}

export function mapPgScopeToLocal(scope, { workspaceOwnerNpub } = {}) {
  const recordId = trimText(scope?.id || scope?.record_id);
  const ownerNpub = trimText(workspaceOwnerNpub);
  const updatedAt = isoTimestamp(scope?.updated_at || scope?.created_at);
  const groupId = trimText(scope?.owner_group_id);
  return {
    record_id: recordId,
    owner_npub: ownerNpub,
    title: trimText(scope?.name || scope?.title) || 'Untitled scope',
    description: trimText(scope?.description),
    level: 'l1',
    parent_id: null,
    l1_id: null,
    l2_id: null,
    l3_id: null,
    l4_id: null,
    l5_id: null,
    group_ids: groupId ? [groupId] : [],
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(scope?.row_version || scope?.version),
    created_at: isoTimestamp(scope?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'scope',
    pg_kind: trimText(scope?.kind),
    pg_workspace_id: trimText(scope?.workspace_id),
  };
}

export function mapPgChannelToLocal(channel, { workspaceOwnerNpub } = {}) {
  const recordId = trimText(channel?.id || channel?.record_id);
  const scopeId = trimText(channel?.scope_id);
  const ownerNpub = trimText(workspaceOwnerNpub);
  const updatedAt = isoTimestamp(channel?.updated_at || channel?.created_at);
  return {
    record_id: recordId,
    owner_npub: ownerNpub,
    title: trimText(channel?.name || channel?.title) || 'Untitled channel',
    description: trimText(channel?.description),
    group_ids: [],
    participant_npubs: [],
    scope_id: scopeId || null,
    scope_l1_id: scopeId || null,
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(channel?.row_version || channel?.version),
    created_at: isoTimestamp(channel?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'channel',
    pg_kind: trimText(channel?.kind),
    pg_workspace_id: trimText(channel?.workspace_id),
  };
}

export function mapPgThreadToLocal(thread, { workspaceOwnerNpub, senderNpub } = {}) {
  const recordId = trimText(thread?.id || thread?.record_id);
  const updatedAt = isoTimestamp(thread?.updated_at || thread?.created_at);
  const title = trimText(thread?.title);
  const latest = trimText(thread?.latest);
  return {
    record_id: recordId,
    channel_id: trimText(thread?.channel_id),
    parent_message_id: null,
    body: title || latest || 'Untitled thread',
    attachments: [],
    sender_npub: trimText(senderNpub) || trimText(workspaceOwnerNpub),
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(thread?.row_version || thread?.version),
    created_at: isoTimestamp(thread?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'thread',
    pg_workspace_id: trimText(thread?.workspace_id),
    pg_scope_id: trimText(thread?.scope_id),
    pg_source_message_id: trimText(thread?.source_message_id) || null,
  };
}

export async function hydrateTowerPgScopes(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readScopes = deps.getTowerPgWorkspaceScopes || getTowerPgWorkspaceScopes;
  const replaceScopes = deps.replaceScopesForOwner || replaceScopesForOwner;
  const result = await readScopes(context.workspaceId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
    path: context.links.scopes || null,
  });
  const scopes = (Array.isArray(result?.scopes) ? result.scopes : [])
    .map((scope) => mapPgScopeToLocal(scope, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
    .filter((scope) => scope.record_id);
  await replaceScopes(context.workspaceOwnerNpub, scopes);
  if (typeof store.applyScopes === 'function') await store.applyScopes(scopes);
  return scopes;
}

export async function hydrateTowerPgChannels(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readChannels = deps.getTowerPgScopeChannels || getTowerPgScopeChannels;
  const readThreads = deps.getTowerPgChannelThreads || getTowerPgChannelThreads;
  const replaceChannels = deps.replaceChannelsForOwner || replaceChannelsForOwner;
  const replaceThreads = deps.replacePgThreadsForChannel || replacePgThreadsForChannel;

  let scopes = Array.isArray(store.scopes) ? store.scopes : [];
  if (scopes.length === 0 && typeof store.refreshScopes === 'function') {
    const refreshed = await store.refreshScopes();
    scopes = Array.isArray(refreshed) ? refreshed : (Array.isArray(store.scopes) ? store.scopes : []);
  }

  const channels = [];
  for (const scope of scopes.filter((entry) => entry?.record_id && entry.record_state !== 'deleted')) {
    const result = await readChannels(context.workspaceId, scope.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    const mapped = (Array.isArray(result?.channels) ? result.channels : [])
      .map((channel) => mapPgChannelToLocal(channel, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
      .filter((channel) => channel.record_id);
    channels.push(...mapped);
  }

  await replaceChannels(context.workspaceOwnerNpub, channels);
  if (typeof store.applyChannels === 'function') await store.applyChannels(channels);

  const senderNpub = trimText(store.session?.npub) || context.workspaceOwnerNpub;
  for (const channel of channels) {
    const result = await readThreads(context.workspaceId, channel.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    const threads = (Array.isArray(result?.threads) ? result.threads : [])
      .map((thread) => mapPgThreadToLocal(thread, {
        workspaceOwnerNpub: context.workspaceOwnerNpub,
        senderNpub,
      }))
      .filter((thread) => thread.record_id && thread.channel_id);
    await replaceThreads(channel.record_id, threads);
  }

  if (store.selectedChannelId && typeof store.refreshMessages === 'function') {
    await store.refreshMessages({ scrollToLatest: false });
  }

  return channels;
}
