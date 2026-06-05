import { APP_NPUB } from './app-identity.js';
import {
  getTowerPgChannelMessages,
  getTowerPgChannelTasks,
  getTowerPgChannelThreads,
  getTowerPgScopeChannels,
  getTowerPgScopeTasks,
  getTowerPgWorkspaceScopes,
} from './api.js';
import {
  replaceChannelsForOwner,
  replacePgMessagesForChannel,
  replaceTasksForOwner,
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

export function mapPgMessageToLocal(message, { workspaceOwnerNpub, senderNpub, threadById = new Map() } = {}) {
  const recordId = trimText(message?.id || message?.record_id);
  const threadId = trimText(message?.thread_id);
  const thread = threadId ? threadById.get(threadId) || null : null;
  const sourceMessageId = trimText(thread?.source_message_id);
  const updatedAt = isoTimestamp(message?.updated_at || message?.created_at);
  return {
    record_id: recordId,
    channel_id: trimText(message?.channel_id),
    parent_message_id: threadId && sourceMessageId && sourceMessageId !== recordId ? sourceMessageId : null,
    body: trimText(message?.body),
    attachments: [],
    sender_npub: trimText(senderNpub) || trimText(workspaceOwnerNpub),
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(message?.row_version || message?.version),
    created_at: isoTimestamp(message?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'message',
    pg_workspace_id: trimText(message?.workspace_id),
    pg_scope_id: trimText(message?.scope_id),
    pg_thread_id: threadId || null,
    pg_created_by_actor_id: trimText(message?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(message?.updated_by_actor_id),
  };
}

export function mapPgTaskToLocal(task, { workspaceOwnerNpub } = {}) {
  const scopeId = trimText(task?.scope_id);
  const updatedAt = isoTimestamp(task?.updated_at || task?.created_at);
  const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? task.metadata
    : {};
  return {
    record_id: trimText(task?.id || task?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    title: trimText(task?.title) || 'Untitled task',
    description: trimText(task?.description),
    state: trimText(task?.state) || 'new',
    priority: trimText(task?.priority) || 'sand',
    board_order: Number.isFinite(Number(metadata.board_order)) ? Number(metadata.board_order) : null,
    parent_task_id: null,
    board_group_id: null,
    assigned_to_npub: null,
    scheduled_for: null,
    tags: typeof metadata.tags === 'string' ? metadata.tags : '',
    scope_id: scopeId || null,
    scope_l1_id: scopeId || null,
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    scope_policy_group_ids: null,
    predecessor_task_ids: null,
    flow_id: null,
    flow_run_id: null,
    flow_step: null,
    source_links: [],
    references: [],
    deliverable_links: [],
    shares: [],
    group_ids: [],
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(task?.row_version || task?.version),
    created_at: isoTimestamp(task?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'task',
    pg_workspace_id: trimText(task?.workspace_id),
    pg_channel_id: trimText(task?.channel_id),
    pg_thread_id: trimText(task?.thread_id) || null,
    pg_created_by_actor_id: trimText(task?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(task?.updated_by_actor_id),
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
  const readMessages = deps.getTowerPgChannelMessages || getTowerPgChannelMessages;
  const replaceChannels = deps.replaceChannelsForOwner || replaceChannelsForOwner;
  const replaceMessages = deps.replacePgMessagesForChannel || replacePgMessagesForChannel;

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
    const rawThreads = Array.isArray(result?.threads) ? result.threads : [];
    const threadById = new Map(rawThreads.map((thread) => [trimText(thread?.id), thread]).filter(([id]) => id));
    const messagesResult = await readMessages(context.workspaceId, channel.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    const rawMessages = Array.isArray(messagesResult?.messages) ? messagesResult.messages : [];
    const sourceMessageIds = new Set(rawThreads.map((thread) => trimText(thread?.source_message_id)).filter(Boolean));
    const messageRows = rawMessages
      .map((message) => mapPgMessageToLocal(message, {
        workspaceOwnerNpub: context.workspaceOwnerNpub,
        senderNpub,
        threadById,
      }))
      .filter((message) => message.record_id && message.channel_id);
    const messageIds = new Set(messageRows.map((message) => message.record_id));
    const fallbackThreads = rawThreads
      .filter((thread) => {
        const sourceMessageId = trimText(thread?.source_message_id);
        return !sourceMessageId || !messageIds.has(sourceMessageId);
      })
      .map((thread) => mapPgThreadToLocal(thread, {
        workspaceOwnerNpub: context.workspaceOwnerNpub,
        senderNpub,
      }))
      .filter((thread) => thread.record_id && thread.channel_id);
    const rows = [
      ...messageRows,
      ...fallbackThreads.filter((thread) => !sourceMessageIds.has(thread.record_id)),
    ];
    await replaceMessages(channel.record_id, rows);
  }

  if (store.selectedChannelId && typeof store.refreshMessages === 'function') {
    await store.refreshMessages({ scrollToLatest: false });
  }

  return channels;
}

export async function hydrateTowerPgTasks(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readChannelTasks = deps.getTowerPgChannelTasks || getTowerPgChannelTasks;
  const readScopeTasks = deps.getTowerPgScopeTasks || getTowerPgScopeTasks;
  const replaceTasks = deps.replaceTasksForOwner || replaceTasksForOwner;

  let channels = Array.isArray(store.channels) ? store.channels : [];
  if (channels.length === 0 && typeof store.refreshChannels === 'function') {
    const refreshed = await store.refreshChannels();
    channels = Array.isArray(refreshed) ? refreshed : (Array.isArray(store.channels) ? store.channels : []);
  }
  let scopes = Array.isArray(store.scopes) ? store.scopes : [];
  if (scopes.length === 0 && typeof store.refreshScopes === 'function') {
    const refreshed = await store.refreshScopes();
    scopes = Array.isArray(refreshed) ? refreshed : (Array.isArray(store.scopes) ? store.scopes : []);
  }

  const taskById = new Map();
  for (const channel of channels.filter((entry) => entry?.record_id && entry.record_state !== 'deleted')) {
    const result = await readChannelTasks(context.workspaceId, channel.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    for (const task of (Array.isArray(result?.tasks) ? result.tasks : [])) {
      const row = mapPgTaskToLocal(task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
      if (row.record_id) taskById.set(row.record_id, row);
    }
  }
  for (const scope of scopes.filter((entry) => entry?.record_id && entry.record_state !== 'deleted')) {
    const result = await readScopeTasks(context.workspaceId, scope.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    for (const task of (Array.isArray(result?.tasks) ? result.tasks : [])) {
      const row = mapPgTaskToLocal(task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
      if (row.record_id) taskById.set(row.record_id, row);
    }
  }

  const tasks = [...taskById.values()];
  await replaceTasks(context.workspaceOwnerNpub, tasks);
  if (typeof store.applyTasks === 'function') await store.applyTasks(tasks);
  return tasks;
}
