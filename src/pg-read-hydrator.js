import { FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';
import {
  getTowerPgChannelAudioNotes,
  getTowerPgChannelDocs,
  getTowerPgChannelFiles,
  getTowerPgDailyNotes,
  getTowerPgDoc,
  getTowerPgDocBody,
  getTowerPgDocComments,
  getTowerPgChannelMessages,
  getTowerPgReactions,
  getTowerPgChannelTasks,
  getTowerPgTask,
  getTowerPgTaskComments,
  getTowerPgChannelThreads,
  getTowerPgScopeChannels,
  getTowerPgScopeTasks,
  getTowerPgWorkspaceMembers,
  getTowerPgWorkspaceScopes,
  downloadStorageObject,
} from './api.js';
import {
  replaceAudioNotesForOwner,
  replaceChannelsForOwner,
  replaceDailyNotesForOwner,
  replaceDocumentsForOwner,
  replacePgAudioNotesForChannel,
  replacePgCommentsForTarget,
  replacePgDailyNotesForChannelAndDate,
  replacePgDocumentsForChannel,
  replacePgMessagesForChannel,
  replacePgReactionsForTarget,
  replacePgTasksForChannel,
  replaceTasksForOwner,
  replaceScopesForOwner,
  upsertDocument,
  upsertTask,
} from './db.js';
import { recordFamilyHash } from './translators/chat.js';
import { recordFamilyHash as taskFamilyHash } from './translators/tasks.js';

function trimText(value) {
  return String(value ?? '').trim();
}

function normalizeTextArray(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => trimText(entry))
    .filter(Boolean))];
}

function isoTimestamp(value) {
  return trimText(value) || new Date().toISOString();
}

function rowVersion(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || '').trim());
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function pgMetadataThreadId(record = {}) {
  const metadata = record?.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata
    : {};
  return trimText(record?.thread_id || metadata.thread_id || metadata.pg_thread_id) || null;
}

function resolveActorId(record = {}) {
  return trimText(
    record?.sender_actor_id
    || record?.created_by_actor_id
    || record?.updated_by_actor_id
    || record?.actor_id,
  );
}

function resolveSenderNpub(record = {}, actorNpubByActorId = new Map()) {
  const directSender = trimText(
    record?.sender_npub
    || record?.npub
    || record?.creator?.npub
    || record?.created_by?.npub
    || record?.createdBy?.npub
    || record?.signature_actor?.npub
    || record?.signature_npub
    || record?.creator_npub
    || record?.creatorNpub
    || record?.created_by_npub
    || record?.createdByNpub
    || record?.actor_npub
    || record?.actorNpub
    || record?.actor?.npub
    || record?.sender?.npub
    || record?.senderNpub
    || record?.created_by_actor_npub
    || record?.createdByActorNpub
    || record?.metadata?.sender_npub
    || record?.metadata?.created_by_npub
    || record?.metadata?.actor_npub
    || record?.owner_npub,
  );
  if (directSender) return directSender;
  const actorId = resolveActorId(record);
  if (!actorId) return '';
  return trimText(actorNpubByActorId.get(actorId));
}

function normalizeActorEntry(entry = {}) {
  const actor = entry?.actor && typeof entry.actor === 'object' ? entry.actor : entry;
  const actorId = trimText(actor?.actor_id || actor?.id || entry?.actor_id || entry?.id);
  const npub = trimText(actor?.npub || entry?.npub);
  if (!actorId || !npub) return null;
  return [actorId, npub];
}

function resolveActorNpubByActorId(store = {}) {
  return new Map(
    (Array.isArray(store?.pgWorkspaceMembers) ? store.pgWorkspaceMembers : [])
      .filter((member) => trimText(member?.npub))
      .map((member) => [
        trimText(member?.actor_id || member?.id),
        trimText(member?.npub),
      ])
      .filter(([actorId, npub]) => actorId && npub),
  );
}

async function resolveActorNpubByActorIdWithFallback(store = {}, deps = {}, context = {}) {
  const actorNpubByActorId = resolveActorNpubByActorId(store);
  if (actorNpubByActorId.size > 0 || !context.workspaceId || !context.baseUrl) {
    return actorNpubByActorId;
  }
  const readWorkspaceMembers = deps.getTowerPgWorkspaceMembers || getTowerPgWorkspaceMembers;
  try {
    const membersResult = await readWorkspaceMembers(context.workspaceId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    const members = Array.isArray(membersResult?.members) ? membersResult.members : [];
    const refreshed = new Map(
      members
        .map((member) => normalizeActorEntry(member))
        .filter(Boolean),
    );
    if (typeof store === 'object' && store !== null && members.length > 0) {
      store.pgWorkspaceMembers = members
        .map((member) => {
          const actor = member?.actor && typeof member.actor === 'object' ? member.actor : member;
          const actorId = trimText(actor?.actor_id || actor?.id || member?.actor_id || member?.id);
          const npub = trimText(actor?.npub || member?.npub);
          if (!actorId || !npub) return null;
          return {
            actor_id: actorId,
            id: actorId,
            npub,
          };
        })
        .filter(Boolean);
    }
    if (refreshed.size > 0) return new Map([...actorNpubByActorId, ...refreshed]);
  } catch {
    return actorNpubByActorId;
  }
  return actorNpubByActorId;
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.map((value) => trimText(value)).filter(Boolean))];
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
    workspace.workspaceOwnerNpub
    || identity.workspace_owner_npub
    || identity.workspaceOwnerNpub
    || store.workspaceOwnerNpub
  );
  const baseUrl = normalizeBackendUrl(workspace.directHttpsUrl || descriptor.tower_base_url || descriptor.towerBaseUrl || store.backendUrl);
  const appNpub = trimText(workspace.appNpub || identity.app_npub || identity.appNpub || FLIGHT_DECK_PG_APP_NPUB);
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
    metadata: channel?.metadata && typeof channel.metadata === 'object' && !Array.isArray(channel.metadata)
      ? channel.metadata
      : {},
    channel_type: trimText(channel?.kind),
    group_ids: normalizeTextArray(channel?.group_ids || channel?.groupIds),
    participant_npubs: normalizeTextArray(channel?.participant_npubs || channel?.participantNpubs),
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

export function mapPgThreadToLocal(thread, {
  workspaceOwnerNpub,
  senderNpub,
  actorNpubByActorId = new Map(),
} = {}) {
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
    sender_npub: resolveSenderNpub(thread, actorNpubByActorId)
      || trimText(senderNpub),
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

export function mapPgMessageToLocal(message, {
  workspaceOwnerNpub,
  senderNpub,
  actorNpubByActorId = new Map(),
  threadById = new Map(),
} = {}) {
  const recordId = trimText(message?.id || message?.record_id);
  const threadId = trimText(message?.thread_id);
  const thread = threadId ? threadById.get(threadId) || null : null;
  const sourceMessageId = trimText(thread?.source_message_id || message?.thread_source_message_id || message?.source_message_id);
  const updatedAt = isoTimestamp(message?.updated_at || message?.created_at);
  return {
    record_id: recordId,
    channel_id: trimText(message?.channel_id),
    parent_message_id: threadId && sourceMessageId && sourceMessageId !== recordId ? sourceMessageId : null,
    body: trimText(message?.body),
    attachments: [],
    sender_npub: resolveSenderNpub(message, actorNpubByActorId)
      || trimText(senderNpub),
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

export function mergePgHydratedTasksWithLocal(hydratedTasks = [], localTasks = []) {
  const mergedById = new Map();
  for (const task of Array.isArray(hydratedTasks) ? hydratedTasks : []) {
    if (task?.record_id) mergedById.set(task.record_id, task);
  }

  for (const localTask of Array.isArray(localTasks) ? localTasks : []) {
    const recordId = trimText(localTask?.record_id);
    if (!recordId || localTask?.pg_backend !== true || localTask?.record_state === 'deleted') continue;
    const hydratedTask = mergedById.get(recordId);
    if (!hydratedTask) continue;

    const localVersion = Number(localTask.version ?? 0) || 0;
    const hydratedVersion = Number(hydratedTask.version ?? 0) || 0;
    if (localVersion > hydratedVersion) {
      mergedById.set(recordId, localTask);
    }
  }

  return [...mergedById.values()];
}

export function mapPgTaskCommentToLocal(comment, {
  workspaceOwnerNpub,
  senderNpub,
  actorNpubByActorId = new Map(),
} = {}) {
  const updatedAt = isoTimestamp(comment?.updated_at || comment?.created_at);
  return {
    record_id: trimText(comment?.id || comment?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    target_record_id: trimText(comment?.task_id || comment?.target_record_id),
    target_record_family_hash: taskFamilyHash('task'),
    parent_comment_id: null,
    body: trimText(comment?.body),
    attachments: [],
    sender_npub: resolveSenderNpub(comment, actorNpubByActorId)
      || trimText(senderNpub),
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(comment?.row_version || comment?.version),
    created_at: isoTimestamp(comment?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'task_comment',
    pg_workspace_id: trimText(comment?.workspace_id),
    pg_scope_id: trimText(comment?.scope_id),
    pg_channel_id: trimText(comment?.channel_id),
    pg_thread_id: trimText(comment?.thread_id) || null,
    pg_created_by_actor_id: trimText(comment?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(comment?.updated_by_actor_id),
  };
}

export function mapPgDocCommentToLocal(comment, {
  workspaceOwnerNpub,
  senderNpub,
  actorNpubByActorId = new Map(),
} = {}) {
  const updatedAt = isoTimestamp(comment?.updated_at || comment?.created_at);
  const metadata = comment?.metadata && typeof comment.metadata === 'object' && !Array.isArray(comment.metadata)
    ? comment.metadata
    : {};
  const anchorLine = Number(metadata.anchor_line_number);
  return {
    record_id: trimText(comment?.id || comment?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    target_record_id: trimText(comment?.doc_id || comment?.target_record_id),
    target_record_family_hash: recordFamilyHash('document'),
    parent_comment_id: trimText(comment?.parent_comment_id) || null,
    anchor_block_id: trimText(metadata.anchor_block_id) || null,
    anchor_line_number: Number.isFinite(anchorLine) && anchorLine > 0 ? anchorLine : 1,
    comment_status: trimText(metadata.comment_status) || 'open',
    body: trimText(comment?.body),
    attachments: [],
    sender_npub: resolveSenderNpub(comment, actorNpubByActorId)
      || trimText(senderNpub),
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(comment?.row_version || comment?.version),
    created_at: isoTimestamp(comment?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'doc_comment',
    pg_workspace_id: trimText(comment?.workspace_id),
    pg_scope_id: trimText(comment?.scope_id),
    pg_channel_id: trimText(comment?.channel_id),
    pg_created_by_actor_id: trimText(comment?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(comment?.updated_by_actor_id),
    pg_client_record_id: trimText(metadata.client_record_id),
    pg_metadata: metadata,
  };
}

export function mapPgDocToLocal(doc, { workspaceOwnerNpub } = {}) {
  const scopeId = trimText(doc?.scope_id);
  const updatedAt = isoTimestamp(doc?.updated_at || doc?.created_at);
  const storageObjectId = trimText(doc?.storage_object_id || doc?.body?.object_id);
  const storageObject = doc?.body?.storage_object && typeof doc.body.storage_object === 'object'
    ? doc.body.storage_object
    : {};
  return {
    record_id: trimText(doc?.id || doc?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    title: trimText(doc?.title) || 'Untitled document',
    content: trimText(doc?.summary),
    content_format: null,
    content_blocks: [],
    content_storage_object_id: storageObjectId || null,
    content_storage_format: storageObjectId ? 'flightdeck_pg_doc_body' : null,
    content_storage_content_type: trimText(storageObject.content_type),
    content_size_bytes: Number.isFinite(Number(storageObject.size_bytes)) ? Number(storageObject.size_bytes) : null,
    content_sha256_hex: trimText(storageObject.sha256_hex),
    content_storage_status: storageObjectId ? 'remote' : null,
    content_storage_error: null,
    parent_directory_id: null,
    scope_id: scopeId || null,
    scope_l1_id: scopeId || null,
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    scope_policy_group_ids: null,
    source_links: [],
    references: [],
    deliverable_links: [],
    shares: [],
    group_ids: [],
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(doc?.row_version || doc?.version),
    created_at: isoTimestamp(doc?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'doc',
    pg_workspace_id: trimText(doc?.workspace_id),
    pg_channel_id: trimText(doc?.channel_id),
    pg_thread_id: pgMetadataThreadId(doc),
    pg_body_route: trimText(doc?.body?.route),
    pg_created_by_actor_id: trimText(doc?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(doc?.updated_by_actor_id),
  };
}

function resolveStoredDocumentContent(raw, fallback = {}) {
  try {
    const parsed = JSON.parse(raw);
    const model = parsed?.content_model && typeof parsed.content_model === 'object'
      ? parsed.content_model
      : parsed;
    if (typeof model?.content === 'string') {
      return {
        content: model.content,
        content_format: model.content_format ?? fallback.content_format ?? null,
        content_blocks: Array.isArray(model.content_blocks)
          ? model.content_blocks
          : (Array.isArray(fallback.content_blocks) ? fallback.content_blocks : []),
      };
    }
  } catch {
    // Older PG agent helpers wrote raw Markdown. Treat it as the document body.
  }
  return {
    content: raw,
    content_format: fallback.content_format ?? null,
    content_blocks: Array.isArray(fallback.content_blocks) ? fallback.content_blocks : [],
  };
}

async function hydratePgDocStorageContent(row, deps = {}) {
  const objectId = trimText(row?.content_storage_object_id);
  if (!objectId || row?.pg_record_type !== 'doc') return row;
  const readStorageObject = deps.downloadStorageObject || downloadStorageObject;
  try {
    const bytes = await readStorageObject(objectId);
    const raw = new TextDecoder().decode(bytes);
    const resolved = resolveStoredDocumentContent(raw, row);
    return {
      ...row,
      ...resolved,
      content_storage_status: 'loaded',
      content_storage_error: null,
    };
  } catch (error) {
    return {
      ...row,
      content_storage_status: 'error',
      content_storage_error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function hydratePgDocStorageContents(rows, deps = {}) {
  return Promise.all((Array.isArray(rows) ? rows : []).map((row) => hydratePgDocStorageContent(row, deps)));
}

async function hydratePgDocBodyContent(row, bodyResult = null) {
  const encoded = trimText(bodyResult?.body?.base64_data);
  if (!encoded) return hydratePgDocStorageContent(row);
  try {
    const raw = new TextDecoder().decode(base64ToBytes(encoded));
    const resolved = resolveStoredDocumentContent(raw, row);
    return {
      ...row,
      ...resolved,
      content_storage_status: 'loaded',
      content_storage_error: null,
      content_storage_object_id: trimText(bodyResult?.body?.object_id) || row.content_storage_object_id,
      content_storage_content_type: trimText(bodyResult?.body?.content_type) || row.content_storage_content_type,
      content_size_bytes: Number.isFinite(Number(bodyResult?.body?.size_bytes))
        ? Number(bodyResult.body.size_bytes)
        : row.content_size_bytes,
      content_sha256_hex: trimText(bodyResult?.body?.sha256_hex) || row.content_sha256_hex,
    };
  } catch (error) {
    return {
      ...row,
      content_storage_status: 'error',
      content_storage_error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function mapPgFileToLocalDocument(file, { workspaceOwnerNpub } = {}) {
  const scopeId = trimText(file?.scope_id);
  const updatedAt = isoTimestamp(file?.updated_at || file?.created_at);
  const storageObjectId = trimText(file?.storage_object_id || file?.object?.object_id);
  const displayName = trimText(file?.display_name || file?.object?.storage_object?.file_name) || 'File';
  const storageObject = file?.object?.storage_object && typeof file.object.storage_object === 'object'
    ? file.object.storage_object
    : {};
  return {
    record_id: trimText(file?.id || file?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    title: displayName,
    content: storageObjectId ? `[${displayName}](storage://${storageObjectId})` : trimText(file?.description),
    content_format: null,
    content_blocks: [],
    content_storage_object_id: null,
    content_storage_format: null,
    content_storage_content_type: trimText(storageObject.content_type),
    content_size_bytes: Number.isFinite(Number(storageObject.size_bytes)) ? Number(storageObject.size_bytes) : null,
    content_sha256_hex: trimText(storageObject.sha256_hex),
    content_storage_status: storageObjectId ? 'remote' : null,
    content_storage_error: null,
    parent_directory_id: null,
    scope_id: scopeId || null,
    scope_l1_id: scopeId || null,
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    scope_policy_group_ids: null,
    source_links: [],
    references: [],
    deliverable_links: [],
    shares: [],
    group_ids: [],
    sync_status: 'synced',
    record_state: 'active',
    version: rowVersion(file?.row_version || file?.version),
    created_at: isoTimestamp(file?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'file',
    pg_workspace_id: trimText(file?.workspace_id),
    pg_channel_id: trimText(file?.channel_id),
    pg_thread_id: pgMetadataThreadId(file),
    pg_storage_object_id: storageObjectId || null,
    pg_object_route: trimText(file?.object?.route),
    pg_created_by_actor_id: trimText(file?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(file?.updated_by_actor_id),
  };
}

function pgAudioTargetFamily(targetType) {
  const normalized = trimText(targetType);
  if (normalized === 'message') return recordFamilyHash('chat_message');
  if (normalized === 'task') return recordFamilyHash('task');
  if (normalized === 'doc') return recordFamilyHash('document');
  if (normalized === 'file') return recordFamilyHash('document');
  if (normalized === 'task_comment') return recordFamilyHash('comment');
  if (normalized === 'audio_note') return recordFamilyHash('audio_note');
  return null;
}

export function mapPgAudioNoteToLocal(audioNote, {
  workspaceOwnerNpub,
  senderNpub,
  actorNpubByActorId = new Map(),
} = {}) {
  const updatedAt = isoTimestamp(audioNote?.updated_at || audioNote?.created_at);
  const targetType = trimText(audioNote?.target_type);
  return {
    record_id: trimText(audioNote?.id || audioNote?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    target_record_id: trimText(audioNote?.target_id) || null,
    target_record_family_hash: pgAudioTargetFamily(targetType),
    title: trimText(audioNote?.title) || 'Voice note',
    storage_object_id: trimText(audioNote?.storage_object_id || audioNote?.media?.object_id) || null,
    mime_type: trimText(audioNote?.mime_type) || 'audio/webm;codecs=opus',
    duration_seconds: Number.isFinite(Number(audioNote?.duration_seconds)) ? Number(audioNote.duration_seconds) : null,
    size_bytes: Number.isFinite(Number(audioNote?.size_bytes)) ? Number(audioNote.size_bytes) : 0,
    media_encryption: audioNote?.media_encryption || null,
    waveform_preview: Array.isArray(audioNote?.waveform_preview) ? audioNote.waveform_preview : [],
    transcript_status: trimText(audioNote?.transcript_status) || 'not_requested',
    transcript_preview: trimText(audioNote?.transcript_preview) || null,
    transcript: trimText(audioNote?.transcript) || null,
    summary: trimText(audioNote?.summary) || null,
    sender_npub: resolveSenderNpub(audioNote, actorNpubByActorId)
      || trimText(senderNpub),
    group_ids: [],
    sync_status: 'synced',
    record_state: trimText(audioNote?.record_state) || 'active',
    version: rowVersion(audioNote?.row_version || audioNote?.version),
    created_at: isoTimestamp(audioNote?.created_at || updatedAt),
    updated_at: updatedAt,
    pg_backend: true,
    pg_record_type: 'audio_note',
    pg_workspace_id: trimText(audioNote?.workspace_id),
    pg_channel_id: trimText(audioNote?.channel_id),
    pg_thread_id: trimText(audioNote?.thread_id) || null,
    pg_media_route: trimText(audioNote?.media?.route),
    pg_created_by_actor_id: trimText(audioNote?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(audioNote?.updated_by_actor_id),
  };
}

export function mapPgDailyNoteToLocal(note, { workspaceOwnerNpub } = {}) {
  return {
    record_id: trimText(note?.id),
    owner_npub: trimText(workspaceOwnerNpub),
    note_date: trimText(note?.note_date),
    title: trimText(note?.title) || 'Daily note',
    body: trimText(note?.body),
    focus: trimText(note?.focus),
    items: Array.isArray(note?.items) ? note.items : [],
    status: trimText(note?.status) || 'active',
    metadata: note?.metadata && typeof note.metadata === 'object' && !Array.isArray(note.metadata) ? note.metadata : {},
    sync_status: 'synced',
    record_state: note?.deleted_at ? 'deleted' : 'active',
    version: rowVersion(note?.row_version || note?.version),
    created_at: isoTimestamp(note?.created_at),
    updated_at: isoTimestamp(note?.updated_at),
    pg_backend: true,
    pg_record_type: 'daily_note',
    pg_workspace_id: trimText(note?.workspace_id),
    pg_owner_actor_id: trimText(note?.owner_actor_id),
    pg_scope_id: trimText(note?.scope_id),
    pg_channel_id: trimText(note?.channel_id),
    pg_created_by_actor_id: trimText(note?.created_by_actor_id),
    pg_updated_by_actor_id: trimText(note?.updated_by_actor_id),
  };
}

export function mapPgReactionToLocal(reaction, {
  workspaceOwnerNpub,
  targetType,
  targetId,
} = {}) {
  const now = new Date().toISOString();
  const resolvedTargetType = trimText(targetType || reaction?.target_type);
  return {
    record_id: trimText(reaction?.id || reaction?.record_id),
    owner_npub: trimText(workspaceOwnerNpub),
    target_record_id: trimText(targetId || reaction?.target_id),
    target_record_family_hash: pgAudioTargetFamily(resolvedTargetType),
    emoji: trimText(reaction?.emoji),
    emoji_shortcode: trimText(reaction?.emoji_shortcode),
    reactor_npub: trimText(reaction?.reactor_npub || reaction?.reactor_actor_id),
    sender_npub: trimText(reaction?.reactor_npub || reaction?.reactor_actor_id),
    record_state: trimText(reaction?.record_state) || 'active',
    version: rowVersion(reaction?.row_version || reaction?.version),
    created_at: isoTimestamp(reaction?.created_at || reaction?.updated_at || now),
    updated_at: isoTimestamp(reaction?.updated_at || reaction?.created_at || now),
    pg_backend: true,
    pg_record_type: 'reaction',
    pg_workspace_id: trimText(reaction?.workspace_id),
    pg_channel_id: trimText(reaction?.channel_id),
    pg_thread_id: trimText(reaction?.thread_id) || null,
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
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);

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
        senderNpub: '',
        threadById,
        actorNpubByActorId,
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
        senderNpub: '',
        actorNpubByActorId,
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

export async function hydrateTowerPgChannelMessages(store, channelId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const targetChannelId = trimText(channelId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !targetChannelId) return [];

  const readThreads = deps.getTowerPgChannelThreads || getTowerPgChannelThreads;
  const readMessages = deps.getTowerPgChannelMessages || getTowerPgChannelMessages;
  const replaceMessages = deps.replacePgMessagesForChannel || replacePgMessagesForChannel;
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);

  const result = await readThreads(context.workspaceId, targetChannelId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const rawThreads = Array.isArray(result?.threads) ? result.threads : [];
  const threadById = new Map(rawThreads.map((thread) => [trimText(thread?.id), thread]).filter(([id]) => id));
  const messagesResult = await readMessages(context.workspaceId, targetChannelId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const rawMessages = Array.isArray(messagesResult?.messages) ? messagesResult.messages : [];
  const sourceMessageIds = new Set(rawThreads.map((thread) => trimText(thread?.source_message_id)).filter(Boolean));
  const messageRows = rawMessages
    .map((message) => mapPgMessageToLocal(message, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: '',
      threadById,
      actorNpubByActorId,
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
      senderNpub: '',
      actorNpubByActorId,
    }))
    .filter((thread) => thread.record_id && thread.channel_id);
  const rows = [
    ...messageRows,
    ...fallbackThreads.filter((thread) => !sourceMessageIds.has(thread.record_id)),
  ];
  await replaceMessages(targetChannelId, rows);

  if (store.selectedChannelId === targetChannelId && typeof store.refreshMessages === 'function') {
    await store.refreshMessages({ scrollToLatest: false });
  }

  return rows;
}

function mergeStoreChannelRows(store, collectionName, applyName, channelId, rows = []) {
  const existing = Array.isArray(store?.[collectionName]) ? store[collectionName] : [];
  const nextRows = [
    ...existing.filter((row) => !(row?.pg_backend === true && row?.pg_channel_id === channelId)),
    ...rows,
  ];
  if (typeof store?.[applyName] === 'function') return store[applyName](nextRows);
  return null;
}

function mergeStoreDailyRows(store, channelId, noteDate, rows = []) {
  const existing = Array.isArray(store?.dailyNotes) ? store.dailyNotes : [];
  const nextRows = [
    ...existing.filter((row) => !(
      row?.pg_backend === true
      && row?.pg_channel_id === channelId
      && row?.note_date === noteDate
    )),
    ...rows,
  ];
  if (typeof store?.applyDailyNotes === 'function') return store.applyDailyNotes(nextRows);
  return null;
}

function mergeStoreReactionRows(store, targetFamilyHash, targetId, rows = []) {
  const existing = Array.isArray(store?.reactionRows) ? store.reactionRows : [];
  const nextRows = [
    ...existing.filter((row) => !(
      row?.pg_backend === true
      && row?.target_record_family_hash === targetFamilyHash
      && row?.target_record_id === targetId
    )),
    ...rows,
  ];
  if (typeof store?.applyReactions === 'function') return store.applyReactions(nextRows);
  return null;
}

export async function hydrateTowerPgChannelTasks(store, channelId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const targetChannelId = trimText(channelId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !targetChannelId) return [];

  const readChannelTasks = deps.getTowerPgChannelTasks || getTowerPgChannelTasks;
  const replaceTasks = deps.replacePgTasksForChannel || replacePgTasksForChannel;
  const result = await readChannelTasks(context.workspaceId, targetChannelId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const tasks = (Array.isArray(result?.tasks) ? result.tasks : [])
    .map((task) => mapPgTaskToLocal(task, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
    .filter((task) => task.record_id);
  await replaceTasks(targetChannelId, tasks);
  await mergeStoreChannelRows(store, 'tasks', 'applyTasks', targetChannelId, tasks);
  return tasks;
}

export async function hydrateTowerPgTask(store, taskId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const recordId = trimText(taskId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !recordId) return null;

  const readTask = deps.getTowerPgTask || getTowerPgTask;
  const writeTask = deps.upsertTask || upsertTask;
  const result = await readTask(context.workspaceId, recordId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const sourceTask = result?.task || result;
  const task = mapPgTaskToLocal(sourceTask, { workspaceOwnerNpub: context.workspaceOwnerNpub });
  if (!task.record_id) return null;

  await writeTask(task);
  if (typeof store.applyTasks === 'function') {
    const existing = Array.isArray(store.tasks) ? store.tasks : [];
    await store.applyTasks([
      ...existing.filter((item) => item?.record_id !== task.record_id),
      task,
    ]);
  }
  return task;
}

export async function hydrateTowerPgChannelDocumentsAndFiles(store, channelId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const targetChannelId = trimText(channelId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !targetChannelId) return [];

  const readDocs = deps.getTowerPgChannelDocs || getTowerPgChannelDocs;
  const readFiles = deps.getTowerPgChannelFiles || getTowerPgChannelFiles;
  const replaceDocuments = deps.replacePgDocumentsForChannel || replacePgDocumentsForChannel;
  const [docsResult, filesResult] = await Promise.all([
    readDocs(context.workspaceId, targetChannelId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    }),
    readFiles(context.workspaceId, targetChannelId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    }),
  ]);
  const docRows = await hydratePgDocStorageContents(
    (Array.isArray(docsResult?.docs) ? docsResult.docs : [])
      .map((doc) => mapPgDocToLocal(doc, { workspaceOwnerNpub: context.workspaceOwnerNpub })),
    deps,
  );
  const documents = [
    ...docRows,
    ...(Array.isArray(filesResult?.files) ? filesResult.files : [])
      .map((file) => mapPgFileToLocalDocument(file, { workspaceOwnerNpub: context.workspaceOwnerNpub })),
  ].filter((doc) => doc.record_id);
  await replaceDocuments(targetChannelId, documents);
  await mergeStoreChannelRows(store, 'documents', 'applyDocuments', targetChannelId, documents);
  return documents;
}

export async function hydrateTowerPgDoc(store, docId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const recordId = trimText(docId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !recordId) return null;

  const readDoc = deps.getTowerPgDoc || getTowerPgDoc;
  const readDocBody = deps.getTowerPgDocBody || getTowerPgDocBody;
  let result = null;
  let doc = null;
  try {
    result = await readDocBody(context.workspaceId, recordId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    doc = result?.doc || null;
  } catch (bodyError) {
    result = null;
    const fallback = await readDoc(context.workspaceId, recordId, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    doc = fallback?.doc || null;
  }

  if (!doc) return null;
  const row = mapPgDocToLocal(doc, { workspaceOwnerNpub: context.workspaceOwnerNpub });
  if (!row.record_id) return null;
  const hydrated = result?.body
    ? await hydratePgDocBodyContent(row, result)
    : await hydratePgDocStorageContent(row, deps);

  await (deps.upsertDocument || upsertDocument)(hydrated);
  if (typeof store.patchDocumentLocal === 'function') {
    store.patchDocumentLocal(hydrated);
  } else if (typeof store.applyDocuments === 'function') {
    const existing = Array.isArray(store.documents) ? store.documents : [];
    store.applyDocuments([
      ...existing.filter((item) => item?.record_id !== hydrated.record_id),
      hydrated,
    ]);
  }
  if (
    typeof store.applySelectedDocument === 'function'
    && store.selectedDocType === 'document'
    && store.selectedDocId === hydrated.record_id
  ) {
    await store.applySelectedDocument(hydrated);
  }
  return hydrated;
}

export async function hydrateTowerPgChannelAudioNotes(store, channelId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const targetChannelId = trimText(channelId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !targetChannelId) return [];

  const readAudioNotes = deps.getTowerPgChannelAudioNotes || getTowerPgChannelAudioNotes;
  const replaceAudioNotes = deps.replacePgAudioNotesForChannel || replacePgAudioNotesForChannel;
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);
  const result = await readAudioNotes(context.workspaceId, targetChannelId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const audioNotes = (Array.isArray(result?.audio_notes) ? result.audio_notes : [])
    .map((audioNote) => mapPgAudioNoteToLocal(audioNote, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: '',
      actorNpubByActorId,
    }))
    .filter((audioNote) => audioNote.record_id);
  await replaceAudioNotes(targetChannelId, audioNotes);
  await mergeStoreChannelRows(store, 'audioNotes', 'applyAudioNotes', targetChannelId, audioNotes);
  return audioNotes;
}

export async function hydrateTowerPgDailyNoteTarget(store, channelId, noteDate, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const targetChannelId = trimText(channelId);
  const targetNoteDate = trimText(noteDate);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !targetChannelId || !targetNoteDate) return [];

  const readDailyNotes = deps.getTowerPgDailyNotes || getTowerPgDailyNotes;
  const replaceDailyNotes = deps.replacePgDailyNotesForChannelAndDate || replacePgDailyNotesForChannelAndDate;
  const result = await readDailyNotes(context.workspaceId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
    channelId: targetChannelId,
    noteDate: targetNoteDate,
    limit: deps.limit || 10,
  });
  const dailyNotes = (Array.isArray(result?.daily_notes) ? result.daily_notes : [])
    .map((note) => mapPgDailyNoteToLocal(note, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
    .filter((note) => note.record_id);
  await replaceDailyNotes(targetChannelId, targetNoteDate, dailyNotes);
  await mergeStoreDailyRows(store, targetChannelId, targetNoteDate, dailyNotes);
  return dailyNotes;
}

export async function hydrateTowerPgReactionTarget(store, targetType, targetId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const resolvedTargetType = trimText(targetType);
  const resolvedTargetId = trimText(targetId);
  const targetFamilyHash = pgAudioTargetFamily(resolvedTargetType);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !resolvedTargetType || !resolvedTargetId || !targetFamilyHash) return [];

  const readReactions = deps.getTowerPgReactions || getTowerPgReactions;
  const replaceReactions = deps.replacePgReactionsForTarget || replacePgReactionsForTarget;
  const result = await readReactions(context.workspaceId, {
    targetType: resolvedTargetType,
    targetId: resolvedTargetId,
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const reactions = (Array.isArray(result?.reactions) ? result.reactions : [])
    .map((reaction) => mapPgReactionToLocal(reaction, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      targetType: resolvedTargetType,
      targetId: resolvedTargetId,
    }))
    .filter((reaction) => reaction.record_id && reaction.target_record_family_hash && reaction.target_record_id);
  await replaceReactions(targetFamilyHash, resolvedTargetId, reactions);
  await mergeStoreReactionRows(store, targetFamilyHash, resolvedTargetId, reactions);
  return reactions;
}

export async function hydrateTowerPgEventUpdates(store, events = [], deps = {}) {
  const pgEvents = Array.isArray(events) ? events : [];
  const messageChannels = new Set();
  const taskChannels = new Set();
  const taskIds = new Set();
  const documentChannels = new Set();
  const audioChannels = new Set();
  const taskCommentTargets = new Set();
  const dailyTargets = new Map();
  const reactionTargets = new Map();
  let fallbackEvents = 0;

  for (const event of pgEvents) {
    const entityType = trimText(event?.entity_type);
    const channelId = trimText(event?.channel_id || event?.payload?.channel_id);
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};

    if (['message', 'thread'].includes(entityType) && channelId) {
      messageChannels.add(channelId);
    } else if (['task', 'task_assignment'].includes(entityType)) {
      const taskId = trimText(event?.entity_id || payload.task_id || payload.id);
      if (taskId) taskIds.add(taskId);
      else if (channelId) taskChannels.add(channelId);
      else fallbackEvents += 1;
    } else if (['doc', 'file'].includes(entityType) && channelId) {
      documentChannels.add(channelId);
    } else if (entityType === 'audio_note' && channelId) {
      audioChannels.add(channelId);
    } else if (entityType === 'task_comment' && trimText(payload.task_id)) {
      taskCommentTargets.add(trimText(payload.task_id));
    } else if (entityType === 'daily_note' && channelId && trimText(payload.note_date)) {
      const noteDate = trimText(payload.note_date);
      dailyTargets.set(`${channelId}:${noteDate}`, { channelId, noteDate });
    } else if (entityType === 'reaction' && trimText(payload.target_type) && trimText(payload.target_id)) {
      const targetType = trimText(payload.target_type);
      const targetId = trimText(payload.target_id);
      reactionTargets.set(`${targetType}:${targetId}`, { targetType, targetId });
    } else {
      fallbackEvents += 1;
    }
  }

  const jobs = [
    ...[...messageChannels].map((channelId) => hydrateTowerPgChannelMessages(store, channelId, deps)),
    ...[...taskIds].map((taskId) => hydrateTowerPgTask(store, taskId, deps)),
    ...[...taskChannels].map((channelId) => hydrateTowerPgChannelTasks(store, channelId, deps)),
    ...[...documentChannels].map((channelId) => hydrateTowerPgChannelDocumentsAndFiles(store, channelId, deps)),
    ...[...audioChannels].map((channelId) => hydrateTowerPgChannelAudioNotes(store, channelId, deps)),
    ...[...taskCommentTargets].map((taskId) => hydrateTowerPgTaskComments(store, taskId, deps)),
    ...[...dailyTargets.values()].map(({ channelId, noteDate }) => hydrateTowerPgDailyNoteTarget(store, channelId, noteDate, deps)),
    ...[...reactionTargets.values()].map(({ targetType, targetId }) => hydrateTowerPgReactionTarget(store, targetType, targetId, deps)),
  ];

  await Promise.all(jobs);
  return {
    channels: messageChannels.size,
    appliedTargets: jobs.length,
    fallbackEvents,
    events: pgEvents.length,
  };
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

  const tasks = mergePgHydratedTasksWithLocal([...taskById.values()], store.tasks);
  await replaceTasks(context.workspaceOwnerNpub, tasks);
  if (typeof store.applyTasks === 'function') await store.applyTasks(tasks);
  return tasks;
}

export async function hydrateTowerPgTaskComments(store, taskId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const recordId = trimText(taskId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !recordId) return [];
  const readTaskComments = deps.getTowerPgTaskComments || getTowerPgTaskComments;
  const replaceComments = deps.replacePgCommentsForTarget || replacePgCommentsForTarget;
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);
  const result = await readTaskComments(context.workspaceId, recordId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const comments = (Array.isArray(result?.comments) ? result.comments : [])
    .map((comment) => mapPgTaskCommentToLocal(comment, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: '',
      actorNpubByActorId,
    }))
    .filter((comment) => comment.record_id && comment.target_record_id);
  await replaceComments(recordId, comments);
  if (typeof store.applyTaskComments === 'function') await store.applyTaskComments(comments);
  return comments;
}

export async function hydrateTowerPgDocComments(store, docId, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  const recordId = trimText(docId);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl || !recordId) return [];
  const readDocComments = deps.getTowerPgDocComments || getTowerPgDocComments;
  const replaceComments = deps.replacePgCommentsForTarget || replacePgCommentsForTarget;
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);
  const result = await readDocComments(context.workspaceId, recordId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
  });
  const comments = (Array.isArray(result?.comments) ? result.comments : [])
    .map((comment) => mapPgDocCommentToLocal(comment, {
      workspaceOwnerNpub: context.workspaceOwnerNpub,
      senderNpub: '',
      actorNpubByActorId,
    }))
    .filter((comment) => comment.record_id && comment.target_record_id);
  await replaceComments(recordId, comments);
  if (typeof store.applyDocComments === 'function') await store.applyDocComments(comments);
  return comments;
}

export async function hydrateTowerPgDailyNotes(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readDailyNotes = deps.getTowerPgDailyNotes || getTowerPgDailyNotes;
  const replaceDailyNotes = deps.replaceDailyNotesForOwner || replaceDailyNotesForOwner;
  const scopeMetadata = typeof store.getDailyNoteScopeMetadata === 'function'
    ? store.getDailyNoteScopeMetadata()
    : {};
  const result = await readDailyNotes(context.workspaceId, {
    baseUrl: context.baseUrl,
    appNpub: context.appNpub,
    noteDate: deps.noteDate || null,
    scopeId: deps.scopeId || scopeMetadata.scope_id || null,
    channelId: deps.channelId || scopeMetadata.channel_id || null,
    limit: deps.limit || 30,
  });
  const dailyNotes = (Array.isArray(result?.daily_notes) ? result.daily_notes : [])
    .map((note) => mapPgDailyNoteToLocal(note, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
    .filter((note) => note.record_id);
  await replaceDailyNotes(context.workspaceOwnerNpub, dailyNotes);
  if (typeof store.applyDailyNotes === 'function') await store.applyDailyNotes(dailyNotes);
  return dailyNotes;
}

export async function hydrateTowerPgDocumentsAndFiles(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readDocs = deps.getTowerPgChannelDocs || getTowerPgChannelDocs;
  const readFiles = deps.getTowerPgChannelFiles || getTowerPgChannelFiles;
  const replaceDocuments = deps.replaceDocumentsForOwner || replaceDocumentsForOwner;
  let channels = Array.isArray(store.channels) ? store.channels : [];
  if (channels.length === 0 && typeof store.refreshChannels === 'function') {
    const refreshed = await store.refreshChannels();
    channels = Array.isArray(refreshed) ? refreshed : (Array.isArray(store.channels) ? store.channels : []);
  }

  const documents = [];
  for (const channel of channels.filter((entry) => entry?.record_id && entry.record_state !== 'deleted')) {
    const [docsResult, filesResult] = await Promise.all([
      readDocs(context.workspaceId, channel.record_id, { baseUrl: context.baseUrl, appNpub: context.appNpub }),
      readFiles(context.workspaceId, channel.record_id, { baseUrl: context.baseUrl, appNpub: context.appNpub }),
    ]);
    const docRows = await hydratePgDocStorageContents(
      (Array.isArray(docsResult?.docs) ? docsResult.docs : [])
        .map((doc) => mapPgDocToLocal(doc, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
        .filter((doc) => doc.record_id),
      deps,
    );
    documents.push(
      ...docRows,
      ...(Array.isArray(filesResult?.files) ? filesResult.files : [])
        .map((file) => mapPgFileToLocalDocument(file, { workspaceOwnerNpub: context.workspaceOwnerNpub }))
        .filter((doc) => doc.record_id),
    );
  }

  await replaceDocuments(context.workspaceOwnerNpub, documents);
  if (typeof store.applyDocuments === 'function') store.applyDocuments(documents);
  return documents;
}

export async function hydrateTowerPgAudioNotes(store, deps = {}) {
  const context = resolveTowerPgWorkspaceContext(store);
  if (!context.workspaceId || !context.workspaceOwnerNpub || !context.baseUrl) return [];
  const readAudioNotes = deps.getTowerPgChannelAudioNotes || getTowerPgChannelAudioNotes;
  const replaceAudioNotes = deps.replaceAudioNotesForOwner || replaceAudioNotesForOwner;
  const actorNpubByActorId = await resolveActorNpubByActorIdWithFallback(store, deps, context);
  let channels = Array.isArray(store.channels) ? store.channels : [];
  if (channels.length === 0 && typeof store.refreshChannels === 'function') {
    const refreshed = await store.refreshChannels();
    channels = Array.isArray(refreshed) ? refreshed : (Array.isArray(store.channels) ? store.channels : []);
  }

  const audioNotes = [];
  for (const channel of channels.filter((entry) => entry?.record_id && entry.record_state !== 'deleted')) {
    const result = await readAudioNotes(context.workspaceId, channel.record_id, {
      baseUrl: context.baseUrl,
      appNpub: context.appNpub,
    });
    audioNotes.push(
      ...(Array.isArray(result?.audio_notes) ? result.audio_notes : [])
        .map((audioNote) => mapPgAudioNoteToLocal(audioNote, {
          workspaceOwnerNpub: context.workspaceOwnerNpub,
          senderNpub: '',
          actorNpubByActorId,
        }))
        .filter((audioNote) => audioNote.record_id),
    );
  }

  await replaceAudioNotes(context.workspaceOwnerNpub, audioNotes);
  if (typeof store.applyAudioNotes === 'function') await store.applyAudioNotes(audioNotes);
  return audioNotes;
}
