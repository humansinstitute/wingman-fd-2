import {
  createTowerPgChannelMessage,
  createTowerPgChannelTask,
  updateTowerPgTask,
  updateTowerPgTaskState,
} from './api.js';
import {
  mapPgMessageToLocal,
  mapPgTaskToLocal,
  resolveTowerPgWorkspaceContext,
} from './pg-read-hydrator.js';
import {
  getPgChannelScopeId,
  resolvePgRecordContext,
} from './pg-record-context.js';

function trimText(value) {
  return String(value ?? '').trim();
}

export function resolveTowerPgTaskChannel(store, task = {}) {
  const explicitChannelId = trimText(task.pg_channel_id || task.channel_id);
  const channels = Array.isArray(store?.channels) ? store.channels : [];
  const scopeId = trimText(task.scope_id || task.scope_l1_id);
  const matchesScope = (channel) => {
    if (!channel?.record_id || channel.record_state === 'deleted') return false;
    const channelScopeId = getPgChannelScopeId(channel);
    return !scopeId || channelScopeId === scopeId;
  };
  if (explicitChannelId) {
    const channel = channels.find((entry) => entry?.record_id === explicitChannelId) || null;
    return matchesScope(channel) ? channel : null;
  }
  const selectedId = trimText(store?.selectedChannelId);
  const selected = channels.find((channel) => channel?.record_id === selectedId) || null;
  return matchesScope(selected) ? selected : null;
}

function pgRequestOptions(context) {
  return {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  };
}

export async function createTowerPgTaskFromLocal(store, task) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) throw new Error('Tower PG workspace is not ready');
  const recordContext = resolvePgRecordContext(store, {
    scopeId: task.scope_id || task.scope_l1_id,
    channelId: task.pg_channel_id || task.channel_id,
    threadId: task.pg_thread_id || task.thread_id,
    includeActiveThread: false,
  });
  const channel = resolveTowerPgTaskChannel(store, {
    ...task,
    pg_channel_id: recordContext.channelId,
    scope_id: recordContext.scopeId,
  });
  if (!channel?.record_id) throw new Error('Selected PG channel does not match the task scope');
  const result = await createTowerPgChannelTask(context.workspaceId, channel.record_id, {
    title: task.title,
    description: task.description || null,
    state: task.state || 'new',
    priority: task.priority || 'sand',
    thread_id: recordContext.threadId || null,
    metadata: {
      board_order: task.board_order ?? null,
      tags: task.tags || '',
    },
  }, pgRequestOptions(context));
  return mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function updateTowerPgTaskFromLocal(store, task, previousTask = null, patch = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !task?.record_id) throw new Error('Tower PG task is not ready');
  const body = {
    row_version: previousTask?.version || task.version || undefined,
  };
  const patchKeys = Object.keys(patch || {});
  const onlyState = patchKeys.length === 1 && Object.prototype.hasOwnProperty.call(patch, 'state');
  if (onlyState) {
    const result = await updateTowerPgTaskState(context.workspaceId, task.record_id, {
      ...body,
      state: task.state,
    }, pgRequestOptions(context));
    return mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) body.title = task.title;
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) body.description = task.description || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'priority')) body.priority = task.priority || 'sand';
  body.metadata = {
    board_order: task.board_order ?? null,
    tags: task.tags || '',
  };
  const result = await updateTowerPgTask(context.workspaceId, task.record_id, body, pgRequestOptions(context));
  return mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function createTowerPgMessageFromLocal(store, message, options = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !message?.channel_id) throw new Error('Tower PG chat is not ready');
  const parentMessage = options.parentMessage || null;
  const threadId = trimText(options.threadId || parentMessage?.pg_thread_id);
  const result = await createTowerPgChannelMessage(context.workspaceId, message.channel_id, {
    body: message.body,
    ...(threadId ? { thread_id: threadId } : { create_thread: true, thread_title: message.body.slice(0, 80) }),
  }, pgRequestOptions(context));
  const threadById = new Map();
  if (result.thread?.id) threadById.set(String(result.thread.id), result.thread);
  return mapPgMessageToLocal(result.message, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
    threadById,
  });
}
