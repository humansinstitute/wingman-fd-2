import {
  createTowerPgChannelAudioNote,
  createTowerPgChannelDoc,
  createTowerPgChannelFile,
  createTowerPgChannelMessage,
  createTowerPgChannelTask,
  createTowerPgTaskComment,
  deleteTowerPgDoc,
  updateTowerPgDoc,
  updateTowerPgTask,
  updateTowerPgTaskState,
} from './api.js';
import {
  mapPgAudioNoteToLocal,
  mapPgDocToLocal,
  mapPgFileToLocalDocument,
  mapPgMessageToLocal,
  mapPgTaskToLocal,
  mapPgTaskCommentToLocal,
  resolveTowerPgWorkspaceContext,
} from './pg-read-hydrator.js';
import { recordFamilyHash } from './translators/chat.js';
import {
  getPgChannelScopeId,
  resolvePgRecordContext,
} from './pg-record-context.js';
import { addPgEditLeaseToSaveBody } from './pg-edit-session.js';
import { buildAgentInstructionSignature } from './message-instruction-signatures.js';

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

function resolveTowerPgChannelForRecord(store, record = {}) {
  const recordContext = resolvePgRecordContext(store, {
    scopeId: record.scope_id || record.scope_l1_id,
    channelId: record.pg_channel_id || record.channel_id,
    threadId: record.pg_thread_id || record.thread_id,
    includeActiveThread: false,
  });
  return {
    recordContext,
    channel: recordContext.channel,
  };
}

function pgMetadataWithThread(metadata = {}, threadId = null) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {};
  if (threadId) base.thread_id = threadId;
  return base;
}

function pgAudioTargetType(familyHash) {
  const family = trimText(familyHash);
  if (family === recordFamilyHash('chat_message')) return 'message';
  if (family === recordFamilyHash('task')) return 'task';
  if (family === recordFamilyHash('document')) return 'doc';
  return null;
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

export async function createTowerPgDocFromLocal(store, document) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) throw new Error('Tower PG workspace is not ready');
  const { recordContext, channel } = resolveTowerPgChannelForRecord(store, document);
  if (!channel?.record_id) throw new Error('Selected PG channel does not match the document scope');
  const result = await createTowerPgChannelDoc(context.workspaceId, channel.record_id, {
    title: document.title || 'Untitled document',
    storage_object_id: document.content_storage_object_id || document.storage_object_id,
    summary: document.content || null,
    metadata: pgMetadataWithThread(document.pg_metadata || document.metadata, recordContext.threadId),
  }, pgRequestOptions(context));
  return mapPgDocToLocal(result.doc, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function updateTowerPgDocFromLocal(store, document, previousDocument = null) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !document?.record_id) throw new Error('Tower PG doc is not ready');
  const body = addPgEditLeaseToSaveBody(store, previousDocument || document, 'document', {
    row_version: previousDocument?.version || document.version || undefined,
    title: document.title || 'Untitled document',
    storage_object_id: document.content_storage_object_id || document.storage_object_id,
    summary: document.content || null,
    metadata: pgMetadataWithThread(document.pg_metadata || document.metadata, document.pg_thread_id || document.thread_id),
  });
  const result = await updateTowerPgDoc(context.workspaceId, document.record_id, body, pgRequestOptions(context));
  return mapPgDocToLocal(result.doc, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function deleteTowerPgDocFromLocal(store, document) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !document?.record_id) throw new Error('Tower PG doc is not ready');
  const result = await deleteTowerPgDoc(context.workspaceId, document.record_id, {
    rowVersion: document.version || undefined,
    ...pgRequestOptions(context),
  });
  return mapPgDocToLocal(result.doc, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function createTowerPgFileFromLocal(store, file) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) throw new Error('Tower PG workspace is not ready');
  const { recordContext, channel } = resolveTowerPgChannelForRecord(store, file);
  if (!channel?.record_id) throw new Error('Selected PG channel does not match the file scope');
  const result = await createTowerPgChannelFile(context.workspaceId, channel.record_id, {
    storage_object_id: file.storage_object_id || file.content_storage_object_id,
    display_name: file.display_name || file.title || null,
    description: file.description || file.content || null,
    metadata: pgMetadataWithThread(file.pg_metadata || file.metadata, recordContext.threadId),
  }, pgRequestOptions(context));
  return mapPgFileToLocalDocument(result.file, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function createTowerPgAudioNoteFromLocal(store, audioNote) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) throw new Error('Tower PG workspace is not ready');
  const { recordContext, channel } = resolveTowerPgChannelForRecord(store, audioNote);
  if (!channel?.record_id) throw new Error('Selected PG channel does not match the audio note scope');
  const targetType = pgAudioTargetType(audioNote.target_record_family_hash);
  const result = await createTowerPgChannelAudioNote(context.workspaceId, channel.record_id, {
    storage_object_id: audioNote.storage_object_id,
    mime_type: audioNote.mime_type || 'audio/webm;codecs=opus',
    title: audioNote.title || null,
    thread_id: recordContext.threadId || null,
    target_type: targetType,
    target_id: targetType ? audioNote.target_record_id || null : null,
    duration_seconds: audioNote.duration_seconds ?? null,
    size_bytes: audioNote.size_bytes ?? 0,
    media_encryption: audioNote.media_encryption || {},
    waveform_preview: audioNote.waveform_preview || [],
    transcript_status: audioNote.transcript_status || 'not_requested',
    transcript_preview: audioNote.transcript_preview || null,
    summary: audioNote.summary || null,
    record_state: audioNote.record_state || 'active',
    metadata: audioNote.pg_metadata || audioNote.metadata || {},
  }, pgRequestOptions(context));
  return mapPgAudioNoteToLocal(result.audio_note, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
  });
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
      ...addPgEditLeaseToSaveBody(store, previousTask || task, 'task', body),
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
  const result = await updateTowerPgTask(
    context.workspaceId,
    task.record_id,
    addPgEditLeaseToSaveBody(store, { ...task, ...(previousTask || {}) }, 'task', body),
    pgRequestOptions(context),
  );
  return mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function createTowerPgTaskCommentFromLocal(store, comment) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !comment?.target_record_id) throw new Error('Tower PG task comments are not ready');
  const result = await createTowerPgTaskComment(context.workspaceId, comment.target_record_id, {
    body: comment.body,
    ...(comment.pg_thread_id ? { thread_id: comment.pg_thread_id } : {}),
  }, pgRequestOptions(context));
  return mapPgTaskCommentToLocal(result.comment, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
  });
}

export async function createTowerPgMessageFromLocal(store, message, options = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !message?.channel_id) throw new Error('Tower PG chat is not ready');
  const parentMessage = options.parentMessage || null;
  const threadId = trimText(options.threadId || parentMessage?.pg_thread_id);
  const messageSignature = await buildAgentInstructionSignature({
    body: message.body,
    workspaceId: context.workspaceId,
    channelId: message.channel_id,
    threadId,
  });
  const result = await createTowerPgChannelMessage(context.workspaceId, message.channel_id, {
    body: message.body,
    message_signature: messageSignature,
    ...(threadId ? { thread_id: threadId } : { create_thread: true, thread_title: message.body.slice(0, 80) }),
  }, pgRequestOptions(context));
  const threadById = new Map();
  const returnedThreadId = trimText(result.thread?.id);
  if (returnedThreadId) {
    threadById.set(returnedThreadId, {
      ...result.thread,
      source_message_id: trimText(result.thread?.source_message_id) || trimText(parentMessage?.record_id),
    });
  }
  if (threadId && parentMessage?.record_id && !threadById.has(threadId)) {
    threadById.set(threadId, {
      id: threadId,
      source_message_id: parentMessage.record_id,
    });
  }
  const messageForMapping = threadId && !trimText(result.message?.thread_id)
    ? { ...result.message, thread_id: threadId }
    : result.message;
  return mapPgMessageToLocal(messageForMapping, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
    threadById,
  });
}
