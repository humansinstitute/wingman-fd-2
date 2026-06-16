import {
  getPgChannelScopeId,
  parsePgTaskBoardId,
} from './pg-record-context.js';
import { resolveChannelLabel } from './channel-labels.js';
import { recordFamilyHash } from './translators/chat.js';

const UNSCOPED_SCOPE_ID = '__unscoped__';
const ALL_SCOPE_ID = 'all';
const ALL_CHANNEL_ID = 'all';
const OPEN_COMMENT_STATUSES = new Set(['', 'open', 'unresolved', 'active']);
const TASK_FAMILY = recordFamilyHash('task');
const DOCUMENT_FAMILY = recordFamilyHash('document');

function normalizeString(value) {
  return String(value || '').trim();
}

function timestampMs(value) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : 0;
}

function newestIso(left, right) {
  return timestampMs(left) >= timestampMs(right) ? (left || '') : (right || '');
}

function recordScopeId(row = {}) {
  return normalizeString(
    row.scope_id
    || row.scope_l5_id
    || row.scope_l4_id
    || row.scope_l3_id
    || row.scope_l2_id
    || row.scope_l1_id
    || ''
  );
}

function isFileBackedDocument(row = {}) {
  return normalizeString(row.pg_record_type) === 'file'
    || Boolean(normalizeString(row.pg_storage_object_id));
}

function isDocumentBodyStorageRow(row = {}) {
  return normalizeString(row.source_type) === 'document'
    && normalizeString(row.kind) === 'document';
}

function scopeMatches(rowScopeId, selectedScopeId, scopesMap) {
  const selected = normalizeString(selectedScopeId);
  const rowScope = normalizeString(rowScopeId);
  if (!selected || selected === ALL_SCOPE_ID || selected === '__all__') return true;
  if (selected === UNSCOPED_SCOPE_ID) return !rowScope;
  if (!rowScope) return false;
  if (rowScope === selected) return true;
  const scope = scopesMap?.get?.(rowScope);
  if (!scope) return false;
  return [
    scope.l1_id,
    scope.l2_id,
    scope.l3_id,
    scope.l4_id,
    scope.l5_id,
    scope.parent_id,
  ].some((value) => normalizeString(value) === selected);
}

function buildOverviewContext({ selectedScopeId = ALL_SCOPE_ID, selectedChannelId = ALL_CHANNEL_ID } = {}) {
  const scopeId = normalizeString(selectedScopeId);
  const channelId = normalizeString(selectedChannelId);
  const hasScope = Boolean(scopeId && scopeId !== ALL_SCOPE_ID && scopeId !== '__all__' && scopeId !== '__recent__');
  const hasChannel = Boolean(channelId && channelId !== ALL_CHANNEL_ID);
  if (!hasScope && !hasChannel) {
    return { mode: 'all', scopeId: ALL_SCOPE_ID, channelId: ALL_CHANNEL_ID };
  }
  return {
    mode: 'context',
    scopeId: hasScope ? scopeId : '',
    channelId: hasChannel ? channelId : '',
  };
}

function rowMatchesContext(row = {}, context = {}, scopesMap = null) {
  if (context.mode === 'all') return { matches: true, missing: false };
  const rowScope = recordScopeId(row);
  const rowChannel = normalizeString(row.channel_id || row.pg_channel_id || '');
  const hasScope = Boolean(rowScope);
  const hasChannel = Boolean(rowChannel);
  const wantsScope = Boolean(context.scopeId);
  const wantsChannel = Boolean(context.channelId);
  const scopeOk = !wantsScope || scopeMatches(rowScope, context.scopeId, scopesMap);
  const channelOk = !wantsChannel || rowChannel === context.channelId;
  return {
    matches: scopeOk && channelOk,
    missing: (wantsScope && !hasScope) || (wantsChannel && !hasChannel),
  };
}

function channelLabel(channel = {}) {
  return normalizeString(channel.title || channel.name || channel.label) || 'Chat';
}

function overviewChannelLabel(channel = {}, options = {}) {
  if (typeof options.getChannelLabel === 'function') {
    const label = normalizeString(options.getChannelLabel(channel));
    if (label) return label;
  }
  return resolveChannelLabel(channel, {
    sessionNpub: options.sessionNpub,
    getParticipants: options.getParticipants,
    getSenderName: options.getSenderName,
  }) || channelLabel(channel);
}

function readableTitle(row = {}, fallback = 'Untitled') {
  return normalizeString(row.title || row.name || row.subject || row.display_name || row.body) || fallback;
}

function commentIsOpen(comment = {}) {
  const status = normalizeString(comment.comment_status || comment.status).toLowerCase();
  return OPEN_COMMENT_STATUSES.has(status);
}

function mergeComments(...sources) {
  const rows = new Map();
  for (const source of sources) {
    for (const row of Array.isArray(source) ? source : []) {
      if (!row?.record_id) continue;
      rows.set(row.record_id, row);
    }
  }
  return [...rows.values()];
}

function findActiveChannel(channels = [], channelId = '') {
  const id = normalizeString(channelId);
  if (!id) return null;
  return (Array.isArray(channels) ? channels : [])
    .find((channel) => channel?.record_id === id && channel.record_state !== 'deleted') || null;
}

function resolveOverviewChannelId(store = {}) {
  const board = parsePgTaskBoardId(store.selectedBoardId);
  if (board.type === 'scope') {
    const scopeId = normalizeString(board.scopeId);
    if (scopeId === ALL_SCOPE_ID || scopeId === '__all__' || scopeId === '__recent__') return '';
  }
  return normalizeString(
    store.pgContextSelectedChannelId
    || board.channelId
    || store.selectedChannelId
    || ''
  );
}

function resolveOverviewScopeId(store = {}) {
  const board = parsePgTaskBoardId(store.selectedBoardId);
  if (board.type === 'scope') {
    const scopeId = normalizeString(board.scopeId);
    if (scopeId === ALL_SCOPE_ID || scopeId === '__all__' || scopeId === '__recent__') return '';
    if (scopeId && scopeId !== ALL_SCOPE_ID && scopeId !== '__all__' && scopeId !== '__recent__') return scopeId;
  }
  const channel = findActiveChannel(store.channels, resolveOverviewChannelId(store));
  return getPgChannelScopeId(channel) || '';
}

export function buildAutopilotOverviewThreads({
  channels = [],
  messages = [],
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
  getChannelLabel = null,
  getParticipants = null,
  getSenderName = null,
  sessionNpub = '',
  unreadChannelMap = {},
} = {}) {
  const context = buildOverviewContext({ selectedScopeId, selectedChannelId });
  const channelById = new Map(
    (Array.isArray(channels) ? channels : [])
      .filter((channel) => channel?.record_id && channel.record_state !== 'deleted')
      .map((channel) => [channel.record_id, channel])
  );
  const threadRows = new Map();

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.record_id || message.record_state === 'deleted') continue;
    const channel = channelById.get(message.channel_id);
    if (!channel) continue;
    const channelScopeId = recordScopeId(channel);
    const match = rowMatchesContext({ ...message, scope_id: channelScopeId }, context, scopesMap);
    if (!match.matches) continue;

    const threadId = normalizeString(message.pg_thread_id || message.parent_message_id || message.record_id);
    const existing = threadRows.get(threadId);
    const messageTs = timestampMs(message.updated_at);
    const existingTs = timestampMs(existing?.latestMessageUpdatedAt);
    const isThreadRoot = !message.parent_message_id || message.record_id === threadId || message.pg_record_type === 'thread';
    const rootTitle = normalizeString(message.title || message.subject || message.body);

    if (!existing) {
      threadRows.set(threadId, {
        id: threadId,
        channelId: message.channel_id,
        channelLabel: overviewChannelLabel(channel, { getChannelLabel, getParticipants, getSenderName, sessionNpub }),
        scopeId: channelScopeId || null,
        title: rootTitle || '(empty thread)',
        latestMessage: normalizeString(message.body),
        latestMessageUpdatedAt: message.updated_at || '',
        latestMessageSender: message.sender_npub || '',
        messageCount: 1,
        rootRecordId: isThreadRoot ? message.record_id : threadId,
        isUnread: unreadChannelMap?.[message.channel_id] === true,
      });
      continue;
    }

    existing.messageCount += 1;
    existing.isUnread = existing.isUnread || unreadChannelMap?.[message.channel_id] === true;
    if (isThreadRoot && rootTitle) {
      existing.title = rootTitle;
      existing.rootRecordId = message.record_id;
    }
    if (messageTs > existingTs || (messageTs === existingTs && String(message.record_id).localeCompare(String(existing.id)) > 0)) {
      existing.latestMessage = normalizeString(message.body);
      existing.latestMessageUpdatedAt = message.updated_at || '';
      existing.latestMessageSender = message.sender_npub || '';
    }
  }

  return [...threadRows.values()].sort((left, right) => {
    const ts = timestampMs(right.latestMessageUpdatedAt) - timestampMs(left.latestMessageUpdatedAt);
    if (ts !== 0) return ts;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function buildAutopilotOverviewTasks({
  tasks = [],
  comments = [],
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
  unreadTaskMap = {},
} = {}) {
  const context = buildOverviewContext({ selectedScopeId, selectedChannelId });
  const taskComments = new Map();

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment?.record_id || comment.record_state === 'deleted') continue;
    if (normalizeString(comment.target_record_family_hash) !== TASK_FAMILY) continue;
    const targetId = normalizeString(comment.target_record_id);
    if (!targetId) continue;
    const bucket = taskComments.get(targetId) || [];
    bucket.push(comment);
    taskComments.set(targetId, bucket);
  }

  const rows = [];
  let hiddenMissingContext = 0;

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.record_id || task.record_state === 'deleted') continue;
    const match = rowMatchesContext(task, context, scopesMap);
    if (!match.matches) {
      if (match.missing) hiddenMissingContext += 1;
      continue;
    }
    const commentsForTask = taskComments.get(task.record_id) || [];
    const latestComment = commentsForTask.reduce((latest, comment) => (
      timestampMs(comment.updated_at) > timestampMs(latest?.updated_at) ? comment : latest
    ), null);
    const taskUpdatedAt = task.updated_at || '';
    const latestCommentAt = latestComment?.updated_at || '';
    const activityAt = newestIso(taskUpdatedAt, latestCommentAt);
    if (!activityAt) continue;
    const commentDrove = timestampMs(latestCommentAt) > timestampMs(taskUpdatedAt);
    rows.push({
      id: `task:${task.record_id}`,
      kind: 'task',
      recordId: task.record_id,
      title: readableTitle(task, 'Untitled task'),
      subtitle: task.status || task.state || 'Task',
      reason: commentDrove
        ? `${commentsForTask.length} recent ${commentsForTask.length === 1 ? 'comment' : 'comments'}`
        : 'Task updated',
      activityAt,
      actorNpub: latestComment?.sender_npub || task.updated_by_npub || task.sender_npub || '',
      count: commentsForTask.length,
      isUnread: unreadTaskMap?.[task.record_id] === true,
      context: {
        scopeId: recordScopeId(task) || null,
        channelId: task.pg_channel_id || task.channel_id || null,
      },
      hrefTarget: { section: 'tasks', recordId: task.record_id, focusId: latestComment?.record_id || null },
    });
  }

  rows.sort((left, right) => {
    const ts = timestampMs(right.activityAt) - timestampMs(left.activityAt);
    if (ts !== 0) return ts;
    return String(left.recordId || '').localeCompare(String(right.recordId || ''));
  });
  rows.diagnostics = hiddenMissingContext > 0
    ? [`${hiddenMissingContext} task ${hiddenMissingContext === 1 ? 'record is' : 'records are'} hidden because scope/channel is missing.`]
    : [];
  return rows;
}

export function buildAutopilotOverviewDocuments({
  documents = [],
  comments = [],
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
  unreadDocumentMap = {},
} = {}) {
  const context = buildOverviewContext({ selectedScopeId, selectedChannelId });
  const commentsByDocument = new Map();

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment?.record_id || comment.record_state === 'deleted') continue;
    if (normalizeString(comment.target_record_family_hash) !== DOCUMENT_FAMILY) continue;
    if (!commentIsOpen(comment)) continue;
    const targetId = normalizeString(comment.target_record_id);
    if (!targetId) continue;
    const bucket = commentsByDocument.get(targetId) || [];
    bucket.push(comment);
    commentsByDocument.set(targetId, bucket);
  }

  const rows = [];
  let hiddenMissingContext = 0;

  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.record_id || document.record_state === 'deleted') continue;
    if (isFileBackedDocument(document)) continue;
    const match = rowMatchesContext(document, context, scopesMap);
    if (!match.matches) {
      if (match.missing) hiddenMissingContext += 1;
      continue;
    }
    const commentsForDocument = commentsByDocument.get(document.record_id) || [];
    const latestComment = commentsForDocument.reduce((latest, comment) => (
      timestampMs(comment.updated_at) > timestampMs(latest?.updated_at) ? comment : latest
    ), null);
    const documentUpdatedAt = document.updated_at || '';
    const latestCommentAt = latestComment?.updated_at || '';
    const activityAt = newestIso(documentUpdatedAt, latestCommentAt);
    if (!activityAt) continue;
    const commentDrove = timestampMs(latestCommentAt) > timestampMs(documentUpdatedAt);
    rows.push({
      id: `document:${document.record_id}`,
      kind: 'document',
      recordId: document.record_id,
      title: readableTitle(document, 'Untitled document'),
      subtitle: document.summary || document.content || 'Document',
      reason: commentsForDocument.length > 0
        ? `${commentsForDocument.length} unresolved ${commentsForDocument.length === 1 ? 'comment' : 'comments'}`
        : 'Document updated',
      activityAt,
      actorNpub: latestComment?.sender_npub || document.updated_by_npub || document.sender_npub || '',
      count: commentsForDocument.length,
      latestCommentAt,
      commentDrove,
      isUnread: unreadDocumentMap?.[document.record_id] === true,
      context: {
        scopeId: recordScopeId(document) || null,
        channelId: document.pg_channel_id || document.channel_id || null,
      },
      hrefTarget: { section: 'docs', recordId: document.record_id, focusId: latestComment?.record_id || null },
    });
  }

  rows.sort((left, right) => {
    const ts = timestampMs(right.activityAt) - timestampMs(left.activityAt);
    if (ts !== 0) return ts;
    return String(left.recordId || '').localeCompare(String(right.recordId || ''));
  });
  rows.diagnostics = hiddenMissingContext > 0
    ? [`${hiddenMissingContext} document ${hiddenMissingContext === 1 ? 'record is' : 'records are'} hidden because scope/channel is missing.`]
    : [];
  return rows;
}

export function countUnresolvedDocumentComments({ documents = [], comments = [] } = {}) {
  const documentIds = new Set(
    (Array.isArray(documents) ? documents : [])
      .filter((document) => document?.record_id && document.record_state !== 'deleted')
      .map((document) => document.record_id)
  );
  let count = 0;
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment?.record_id || comment.record_state === 'deleted') continue;
    if (!documentIds.has(comment.target_record_id)) continue;
    if (normalizeString(comment.target_record_family_hash) !== DOCUMENT_FAMILY) continue;
    if (commentIsOpen(comment)) count += 1;
  }
  return count;
}

export function buildAutopilotOverviewFiles(rows = [], {
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
} = {}) {
  const context = buildOverviewContext({ selectedScopeId, selectedChannelId });
  const diagnostics = [];
  const filtered = [];
  let hiddenMissingContext = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isDocumentBodyStorageRow(row)) continue;
    const match = rowMatchesContext(row, context, scopesMap);
    if (match.matches) {
      filtered.push({
        ...row,
        activityAt: row.updated_at || row.created_at || row.uploaded_at || '',
        reason: row.updated_at ? 'Edited file' : 'Uploaded file',
      });
    } else if (match.missing) {
      hiddenMissingContext += 1;
    }
  }
  if (hiddenMissingContext > 0) {
    diagnostics.push(`${hiddenMissingContext} file ${hiddenMissingContext === 1 ? 'record is' : 'records are'} hidden because scope/channel is missing.`);
  }
  const sorted = filtered.sort((left, right) => {
    const ts = timestampMs(right.activityAt) - timestampMs(left.activityAt);
    if (ts !== 0) return ts;
    const name = String(left.name || '').localeCompare(String(right.name || ''));
    if (name !== 0) return name;
    return String(left.object_id || '').localeCompare(String(right.object_id || ''));
  });
  sorted.diagnostics = diagnostics;
  return sorted;
}

export const autopilotOverviewManagerMixin = {
  get autopilotOverviewContext() {
    return buildOverviewContext({
      selectedScopeId: resolveOverviewScopeId(this),
      selectedChannelId: resolveOverviewChannelId(this),
    });
  },

  get autopilotOverviewIsScoped() {
    return this.autopilotOverviewContext.mode !== 'all';
  },

  get autopilotOverviewContextLabel() {
    if (!this.autopilotOverviewIsScoped) return 'All workspace activity';
    const context = this.autopilotOverviewContext;
    const scope = context.scopeId ? this.scopesMap?.get?.(context.scopeId) : null;
    const channel = findActiveChannel(this.channels, context.channelId);
    const scopeLabel = scope ? (this.getScopeBreadcrumb?.(scope.record_id) || scope.title || 'Selected scope') : '';
    const channelLabelText = channel ? (this.getChannelLabel ? this.getChannelLabel(channel) : channelLabel(channel)) : '';
    if (scopeLabel && channelLabelText) return `${scopeLabel} / ${channelLabelText}`;
    return channelLabelText || scopeLabel || 'Selected context';
  },

  get autopilotOverviewGreeting() {
    const npub = normalizeString(this.session?.npub || this.signingNpub || this.workspaceOwnerNpub);
    const name = normalizeString(this.getSenderName?.(npub));
    const fallback = npub ? `${npub.slice(0, 10)}...` : 'there';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return `${greeting}, ${name && name !== npub ? name : fallback}`;
  },

  get autopilotOverviewComments() {
    return mergeComments(this.fileComments, this.docComments, this.taskComments);
  },

  get autopilotOverviewThreads() {
    return buildAutopilotOverviewThreads({
      channels: this.channels,
      messages: this.fileMessages?.length ? this.fileMessages : this.messages,
      selectedScopeId: this.autopilotOverviewContext.scopeId,
      selectedChannelId: this.autopilotOverviewContext.channelId,
      scopesMap: this.scopesMap,
      getChannelLabel: this.getChannelLabel?.bind?.(this),
      getParticipants: this.getChannelParticipants?.bind?.(this),
      getSenderName: this.getSenderName?.bind?.(this),
      sessionNpub: this.session?.npub || this.signingNpub || '',
      unreadChannelMap: this._unreadChannels || {},
    });
  },

  get autopilotOverviewFiles() {
    return buildAutopilotOverviewFiles(this.fileBrowserRows, {
      selectedScopeId: this.autopilotOverviewContext.scopeId,
      selectedChannelId: this.autopilotOverviewContext.channelId,
      scopesMap: this.scopesMap,
      unreadTaskMap: this._unreadTaskItems || {},
    });
  },

  get autopilotOverviewTasks() {
    return buildAutopilotOverviewTasks({
      tasks: this.tasks,
      comments: this.autopilotOverviewComments,
      selectedScopeId: this.autopilotOverviewContext.scopeId,
      selectedChannelId: this.autopilotOverviewContext.channelId,
      scopesMap: this.scopesMap,
      unreadDocumentMap: this._unreadDocItems || {},
    });
  },

  get autopilotOverviewDocuments() {
    return buildAutopilotOverviewDocuments({
      documents: this.documents,
      comments: this.autopilotOverviewComments,
      selectedScopeId: this.autopilotOverviewContext.scopeId,
      selectedChannelId: this.autopilotOverviewContext.channelId,
      scopesMap: this.scopesMap,
    });
  },

  get autopilotOverviewDailyNote() {
    const today = this.getTodayDateKey?.() || new Date().toISOString().slice(0, 10);
    const context = this.autopilotOverviewContext;
    const notes = (this.dailyNotes || [])
      .filter((note) => note?.record_state !== 'deleted' && String(note.note_date || '') === today)
      .filter((note) => {
        if (context.mode === 'all') return !note.pg_scope_id && !note.pg_channel_id && !note.metadata?.scope_id && !note.metadata?.channel_id;
        const scopeId = note.metadata?.scope_id || note.pg_scope_id || '';
        const channelId = note.metadata?.channel_id || note.pg_channel_id || '';
        return (!context.scopeId || scopeId === context.scopeId) && (!context.channelId || channelId === context.channelId);
      })
      .sort((left, right) => {
        const ts = timestampMs(right.updated_at) - timestampMs(left.updated_at);
        if (ts !== 0) return ts;
        return String(left.record_id || '').localeCompare(String(right.record_id || ''));
      });
    const note = notes[0] || null;
    return {
      note,
      duplicateCount: Math.max(0, notes.length - 1),
      title: note?.title || 'No Daily Scope yet',
      body: note?.focus || note?.body || 'Create or record a daily note for this context.',
      source: note?.metadata?.source || note?.source || 'manual note',
      updatedAt: note?.updated_at || '',
    };
  },

  async openAutopilotOverviewThread(thread = {}) {
    const threadId = thread?.rootRecordId || thread?.id;
    if (!thread?.channelId || !threadId) return;
    this.navigateTo('chat');
    await this.selectChannel(thread.channelId, { syncRoute: false, scrollToLatest: false });
    this.focusMessageId = threadId;
    this.openThread(threadId, { scrollToLatest: false });
  },

  openAutopilotOverviewTask(row = {}) {
    if (!row?.recordId) return;
    this.navigateTo('tasks');
    this.openTaskDetail(row.recordId);
  },

  openAutopilotOverviewDocument(row = {}) {
    if (!row?.recordId) return;
    this.openDoc(row.recordId, {
      commentId: row.hrefTarget?.focusId || null,
      showComments: Boolean(row.count),
    });
  },

  openAutopilotOverviewDailyNote() {
    void this.openDailyNoteEditor?.();
  },
};
