import {
  assignTowerPgTask,
  createTowerPgChannelAudioNote,
  createTowerPgChannelDoc,
  createTowerPgChannelFile,
  createTowerPgChannelMessage,
  createTowerPgChannelTask,
  archiveTowerPgThread,
  createTowerPgDocComment,
  createTowerPgTaskComment,
  deleteTowerPgDocComment,
  deleteTowerPgDoc,
  deleteTowerPgMessage,
  deleteTowerPgTask,
  deleteTowerPgThread,
  updateTowerPgDoc,
  updateTowerPgDocComment,
  updateTowerPgFile,
  updateTowerPgTask,
  updateTowerPgTaskState,
  unassignTowerPgTask,
} from './api.js';
import {
  mapPgAudioNoteToLocal,
  mapPgDocToLocal,
  mapPgFileToLocalDocument,
  mapPgMessageToLocal,
  mapPgDocCommentToLocal,
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

function isMissingPgMessageDeleteError(error) {
  if (!error || error.status !== 404) return false;
  const responseText = String(error.responseText || error.message || '');
  return error.code === 'message_not_found'
    || responseText.includes('"code":"message_not_found"')
    || responseText.includes('Flight Deck PG message not found');
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
  else delete base.thread_id;
  return base;
}

function pgTaskMetadata(task = {}) {
  const base = task.pg_metadata && typeof task.pg_metadata === 'object' && !Array.isArray(task.pg_metadata)
    ? { ...task.pg_metadata }
    : task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? { ...task.metadata }
      : {};
  base.board_order = task.board_order ?? null;
  base.tags = typeof task.tags === 'string' ? task.tags : '';
  base.scheduled_for = task.scheduled_for || null;
  delete base.assigned_to_npub;
  delete base.assigned_to_npubs;
  base.predecessor_task_ids = Array.isArray(task.predecessor_task_ids)
    ? task.predecessor_task_ids
    : null;
  base.flow_id = task.flow_id || null;
  base.flow_run_id = task.flow_run_id || null;
  base.flow_step = task.flow_step || null;
  base.source_links = Array.isArray(task.source_links) ? task.source_links : [];
  base.references = Array.isArray(task.references) ? task.references : [];
  base.deliverable_links = Array.isArray(task.deliverable_links) ? task.deliverable_links : [];
  return base;
}

function isMetadataTaskPatch(patch = {}) {
  return [
    'board_order',
    'tags',
    'scheduled_for',
    'predecessor_task_ids',
    'flow_id',
    'flow_run_id',
    'flow_step',
    'source_links',
    'references',
    'deliverable_links',
  ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

function normalizeTaskAssigneeNpubs(task = {}) {
  return [...new Set((Array.isArray(task?.assigned_to_npubs) ? task.assigned_to_npubs : [])
    .map((npub) => trimText(npub))
    .filter(Boolean))];
}

function resolvePgAssignmentActorId(store = {}, npub = '') {
  const target = trimText(npub);
  if (!target) return '';
  const explicit = typeof store.getPgWorkspaceMemberActorId === 'function'
    ? trimText(store.getPgWorkspaceMemberActorId(target))
    : '';
  if (explicit) return explicit;
  const currentActor = store?.currentWorkspace?.pgMe?.actor || store?.currentWorkspace?.pg_me?.actor || {};
  if (trimText(currentActor.npub) === target) return trimText(currentActor.actor_id || currentActor.id);
  const member = (Array.isArray(store.pgWorkspaceMembers) ? store.pgWorkspaceMembers : [])
    .find((entry) => trimText(entry?.npub) === target || trimText(entry?.actor?.npub) === target);
  return trimText(member?.actor_id || member?.id || member?.actor?.actor_id || member?.actor?.id);
}

async function syncTowerPgTaskAssignmentsFromLocal(store, context, task, previousTask = null) {
  const nextAssignees = normalizeTaskAssigneeNpubs(task);
  const previousAssignees = normalizeTaskAssigneeNpubs(previousTask);
  const added = nextAssignees.filter((npub) => !previousAssignees.includes(npub));
  const removed = previousAssignees.filter((npub) => !nextAssignees.includes(npub));
  for (const npub of removed) {
    const actorId = resolvePgAssignmentActorId(store, npub);
    if (!actorId) throw new Error(`Tower PG actor id not found for task assignee ${npub}`);
    await unassignTowerPgTask(context.workspaceId, task.record_id, actorId, pgRequestOptions(context));
  }
  for (const npub of added) {
    const actorId = resolvePgAssignmentActorId(store, npub);
    if (!actorId) throw new Error(`Tower PG actor id not found for task assignee ${npub}`);
    await assignTowerPgTask(context.workspaceId, task.record_id, actorId, pgRequestOptions(context));
  }
}

function withAssignedNpubs(task = {}, npubs = []) {
  const assigned_to_npubs = [...new Set((Array.isArray(npubs) ? npubs : [])
    .map((npub) => trimText(npub))
    .filter(Boolean))];
  return {
    ...task,
    assigned_to_npubs,
    assigned_to_npub: assigned_to_npubs[0] || null,
  };
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
    metadata: pgTaskMetadata(task),
  }, pgRequestOptions(context));
  let acceptedTask = mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
  const desiredAssignees = normalizeTaskAssigneeNpubs(task);
  if (desiredAssignees.length > 0) {
    await syncTowerPgTaskAssignmentsFromLocal(store, context, {
      ...acceptedTask,
      assigned_to_npubs: desiredAssignees,
    }, null);
    acceptedTask = withAssignedNpubs(acceptedTask, desiredAssignees);
  }
  return acceptedTask;
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
    channel_id: document.pg_channel_id || document.channel_id || undefined,
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

export async function updateTowerPgFileFromLocal(store, file, previous = null) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !file?.record_id) throw new Error('Tower PG file is not ready');
  const { recordContext, channel } = resolveTowerPgChannelForRecord(store, file);
  if (!channel?.record_id) throw new Error('Selected PG channel does not match the file scope');
  const result = await updateTowerPgFile(context.workspaceId, file.record_id, {
    row_version: previous?.version || file.version || undefined,
    channel_id: channel.record_id,
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
  const targetId = trimText(audioNote.target_record_id);
  const title = trimText(audioNote.title);
  const transcriptPreview = typeof audioNote.transcript_preview === 'string' ? audioNote.transcript_preview : '';
  const summary = typeof audioNote.summary === 'string' ? audioNote.summary : '';
  const durationSeconds = Number(audioNote.duration_seconds);
  const audioBody = {
    storage_object_id: audioNote.storage_object_id,
    mime_type: audioNote.mime_type || 'audio/webm;codecs=opus',
    ...(title ? { title } : {}),
    ...(recordContext.threadId ? { thread_id: recordContext.threadId } : {}),
    ...(targetType && targetId ? { target_type: targetType, target_id: targetId } : {}),
    ...(Number.isFinite(durationSeconds) ? { duration_seconds: durationSeconds } : {}),
    size_bytes: audioNote.size_bytes ?? 0,
    media_encryption: audioNote.media_encryption || {},
    waveform_preview: audioNote.waveform_preview || [],
    transcript_status: audioNote.transcript_status || 'not_requested',
    ...(transcriptPreview ? { transcript_preview: transcriptPreview } : {}),
    ...(summary ? { summary } : {}),
    record_state: audioNote.record_state || 'active',
    metadata: audioNote.pg_metadata || audioNote.metadata || {},
  };
  const result = await createTowerPgChannelAudioNote(context.workspaceId, channel.record_id, audioBody, pgRequestOptions(context));
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
  const assignmentPatch = Object.prototype.hasOwnProperty.call(patch, 'assigned_to_npubs')
    || Object.prototype.hasOwnProperty.call(patch, 'assigned_to_npub');
  const nonAssignmentPatchKeys = patchKeys.filter((key) => key !== 'assigned_to_npubs' && key !== 'assigned_to_npub');
  const onlyState = nonAssignmentPatchKeys.length === 1 && Object.prototype.hasOwnProperty.call(patch, 'state');
  const onlyAssignment = assignmentPatch && nonAssignmentPatchKeys.length === 0;
  let acceptedTask = null;
  if (Object.prototype.hasOwnProperty.call(patch, 'state')) {
    const result = await updateTowerPgTaskState(context.workspaceId, task.record_id, {
      ...addPgEditLeaseToSaveBody(store, previousTask || task, 'task', body),
      state: task.state,
    }, pgRequestOptions(context));
    acceptedTask = mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
    if (onlyState) {
      await syncTowerPgTaskAssignmentsFromLocal(store, context, task, previousTask);
      return withAssignedNpubs(acceptedTask, normalizeTaskAssigneeNpubs(task));
    }
  }
  if (onlyAssignment) {
    await syncTowerPgTaskAssignmentsFromLocal(store, context, task, previousTask);
    return withAssignedNpubs(previousTask || task, normalizeTaskAssigneeNpubs(task));
  }
  const patchBody = {
    row_version: acceptedTask?.version || body.row_version,
  };
  const patchTask = acceptedTask ? { ...task, version: acceptedTask.version } : task;
  const previousForPatch = acceptedTask || previousTask || task;
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) patchBody.title = task.title;
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) patchBody.description = task.description || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'priority')) patchBody.priority = task.priority || 'sand';
  if (nonAssignmentPatchKeys.length === 0 || isMetadataTaskPatch(patch)) patchBody.metadata = pgTaskMetadata(task);
  const result = await updateTowerPgTask(
    context.workspaceId,
    task.record_id,
    addPgEditLeaseToSaveBody(store, { ...patchTask, ...previousForPatch }, 'task', patchBody),
    pgRequestOptions(context),
  );
  acceptedTask = mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
  await syncTowerPgTaskAssignmentsFromLocal(store, context, task, previousTask);
  return withAssignedNpubs(acceptedTask, normalizeTaskAssigneeNpubs(task));
}

export async function deleteTowerPgTaskFromLocal(store, task) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !task?.record_id) throw new Error('Tower PG task is not ready');
  const result = await deleteTowerPgTask(context.workspaceId, task.record_id, {
    rowVersion: task.version || undefined,
    ...pgRequestOptions(context),
  });
  return mapPgTaskToLocal(result.task, { workspaceOwnerNpub: context.workspaceOwnerNpub });
}

export async function createTowerPgTaskCommentFromLocal(store, comment, contextOverride = null) {
  const context = contextOverride || resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !comment?.target_record_id) throw new Error('Tower PG task comments are not ready');
  const result = await createTowerPgTaskComment(context.workspaceId, comment.target_record_id, {
    body: comment.body,
    ...(comment.pg_thread_id ? { thread_id: comment.pg_thread_id } : {}),
  }, pgRequestOptions(context));
  return mapPgTaskCommentToLocal(result.comment, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: context.sessionNpub || store?.session?.npub,
  });
}

export async function createTowerPgDocCommentFromLocal(store, comment) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !comment?.target_record_id) throw new Error('Tower PG document comments are not ready');
  const metadata = comment.pg_metadata && typeof comment.pg_metadata === 'object' && !Array.isArray(comment.pg_metadata)
    ? { ...comment.pg_metadata }
    : {};
  if (comment.anchor_block_id) metadata.anchor_block_id = comment.anchor_block_id;
  if (Number.isFinite(Number(comment.anchor_line_number))) metadata.anchor_line_number = Number(comment.anchor_line_number);
  metadata.comment_status = comment.comment_status || metadata.comment_status || 'open';
  const body = {
    body: comment.body,
    ...(comment.parent_comment_id ? { parent_comment_id: comment.parent_comment_id } : {}),
    metadata,
  };
  const result = await createTowerPgDocComment(context.workspaceId, comment.target_record_id, body, pgRequestOptions(context));
  return mapPgDocCommentToLocal(result.comment, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
  });
}

export async function updateTowerPgDocCommentFromLocal(store, comment) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !comment?.target_record_id || !comment?.record_id) throw new Error('Tower PG document comments are not ready');
  const metadata = comment.pg_metadata && typeof comment.pg_metadata === 'object' && !Array.isArray(comment.pg_metadata)
    ? { ...comment.pg_metadata }
    : {};
  if (comment.anchor_block_id) metadata.anchor_block_id = comment.anchor_block_id;
  if (Number.isFinite(Number(comment.anchor_line_number))) metadata.anchor_line_number = Number(comment.anchor_line_number);
  metadata.comment_status = comment.comment_status || metadata.comment_status || 'open';
  const result = await updateTowerPgDocComment(context.workspaceId, comment.target_record_id, comment.record_id, {
    comment_status: metadata.comment_status,
    row_version: comment.previous_version || comment.version || undefined,
  }, pgRequestOptions(context));
  return mapPgDocCommentToLocal(result.comment, {
    workspaceOwnerNpub: context.workspaceOwnerNpub,
    senderNpub: store?.session?.npub,
  });
}

export async function deleteTowerPgDocCommentFromLocal(store, comment) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !comment?.target_record_id || !comment?.record_id) throw new Error('Tower PG document comments are not ready');
  const result = await deleteTowerPgDocComment(context.workspaceId, comment.target_record_id, comment.record_id, {
    rowVersion: comment.version || undefined,
    ...pgRequestOptions(context),
  });
  return {
    ...mapPgDocCommentToLocal(result.comment, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: store?.session?.npub,
    }),
    record_state: 'deleted',
  };
}

export async function createTowerPgMessageFromLocal(store, message, options = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !message?.channel_id) throw new Error('Tower PG chat is not ready');
  const parentMessage = options.parentMessage || null;
  const threadId = trimText(options.threadId || parentMessage?.pg_thread_id);
  const metadata = message?.pg_metadata && typeof message.pg_metadata === 'object' && !Array.isArray(message.pg_metadata)
    ? { ...message.pg_metadata }
    : {};
  const clientRecordId = trimText(message?.pg_client_record_id || message?.record_id);
  if (clientRecordId) metadata.client_record_id = clientRecordId;
  const messageSignature = await buildAgentInstructionSignature({
    body: message.body,
    workspaceId: context.workspaceId,
    channelId: message.channel_id,
    threadId,
  });
  const result = await createTowerPgChannelMessage(context.workspaceId, message.channel_id, {
    body: message.body,
    message_signature: messageSignature,
    ...(Object.keys(metadata).length ? { metadata } : {}),
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

export async function deleteTowerPgMessageFromLocal(store, message) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !message?.record_id) throw new Error('Tower PG message is not ready');
  const deleteMessage = async (targetMessage) => deleteTowerPgMessage(context.workspaceId, targetMessage.record_id, {
    rowVersion: targetMessage.version || undefined,
    ...pgRequestOptions(context),
  });
  let result;
  try {
    result = await deleteMessage(message);
  } catch (error) {
    if (isMissingPgMessageDeleteError(error)) {
      const acceptedMessage = Array.isArray(store?.messages)
        ? store.messages.find((candidate) => (
          candidate?.pg_backend === true
          && candidate.record_state !== 'deleted'
          && candidate.record_id !== message.record_id
          && trimText(candidate.pg_client_record_id) === message.record_id
        ))
        : null;
      if (acceptedMessage?.record_id) {
        const retryResult = await deleteMessage(acceptedMessage);
        return {
          ...mapPgMessageToLocal(retryResult.message, {
            workspaceOwnerNpub: context.workspaceOwnerNpub,
            senderNpub: store?.session?.npub,
          }),
          record_state: 'deleted',
        };
      }
      const now = new Date().toISOString();
      return {
        ...message,
        owner_npub: message.owner_npub || context.workspaceOwnerNpub,
        record_state: 'deleted',
        sync_status: 'synced',
        version: (Number(message.version) || 1) + 1,
        updated_at: now,
        pg_backend: true,
        pg_record_type: message.pg_record_type || 'message',
        pg_workspace_id: message.pg_workspace_id || context.workspaceId,
      };
    }
    throw error;
  }
  return {
    ...mapPgMessageToLocal(result.message, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: store?.session?.npub,
    }),
    record_state: 'deleted',
  };
}

export async function deleteTowerPgThreadFromLocal(store, parentMessage) {
  const context = resolveTowerPgWorkspaceContext(store);
  const threadId = trimText(parentMessage?.pg_thread_id);
  if (!context.workspaceId || !threadId) throw new Error('Tower PG thread is not ready');
  const result = await deleteTowerPgThread(context.workspaceId, threadId, {
    ...pgRequestOptions(context),
  });
  return result.thread;
}

export async function archiveTowerPgThreadFromLocal(store, parentMessage, archived = true) {
  const context = resolveTowerPgWorkspaceContext(store);
  const threadId = trimText(parentMessage?.pg_thread_id || parentMessage?.record_id);
  if (!context.workspaceId || !threadId) throw new Error('Tower PG thread is not ready');
  const result = await archiveTowerPgThread(context.workspaceId, threadId, {
    archived,
    ...pgRequestOptions(context),
  });
  return result.thread;
}
