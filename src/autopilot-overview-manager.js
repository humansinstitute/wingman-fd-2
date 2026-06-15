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
  if (!scopeId || scopeId === ALL_SCOPE_ID || scopeId === '__all__') {
    return { mode: 'all', scopeId: ALL_SCOPE_ID, channelId: ALL_CHANNEL_ID };
  }
  return {
    mode: 'scope_channel',
    scopeId,
    channelId: channelId && channelId !== ALL_CHANNEL_ID ? channelId : '',
  };
}

function rowMatchesContext(row = {}, context = {}, scopesMap = null) {
  if (context.mode !== 'scope_channel') return { matches: true, missing: false };
  const rowScope = recordScopeId(row);
  const rowChannel = normalizeString(row.channel_id || row.pg_channel_id || '');
  const hasScope = Boolean(rowScope);
  const hasChannel = Boolean(rowChannel);
  const scopeOk = scopeMatches(rowScope, context.scopeId, scopesMap);
  const channelOk = Boolean(context.channelId) && rowChannel === context.channelId;
  return {
    matches: scopeOk && channelOk,
    missing: !hasScope || !hasChannel,
  };
}

function channelLabel(channel = {}) {
  return normalizeString(channel.title || channel.name || channel.label) || 'Chat';
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

export function buildAutopilotOverviewThreads({
  channels = [],
  messages = [],
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
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
        channelLabel: channelLabel(channel),
        scopeId: channelScopeId || null,
        title: rootTitle || '(empty thread)',
        latestMessage: normalizeString(message.body),
        latestMessageUpdatedAt: message.updated_at || '',
        latestMessageSender: message.sender_npub || '',
        messageCount: 1,
        rootRecordId: isThreadRoot ? message.record_id : threadId,
      });
      continue;
    }

    existing.messageCount += 1;
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
    const ts = timestampMs(right.updated_at) - timestampMs(left.updated_at);
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
      selectedScopeId: this.autopilotOverviewScopeFilter,
      selectedChannelId: this.autopilotOverviewChannelFilter,
    });
  },

  get autopilotOverviewIsScoped() {
    return this.autopilotOverviewContext.mode === 'scope_channel';
  },

  get autopilotOverviewContextLabel() {
    if (!this.autopilotOverviewIsScoped) return 'All workspace activity';
    const scope = this.autopilotOverviewScopeOptions.find((option) => option.id === this.autopilotOverviewScopeFilter);
    const channel = this.autopilotOverviewChannelOptions.find((option) => option.id === this.autopilotOverviewChannelFilter);
    if (!this.autopilotOverviewContext.channelId) return `${scope?.label || 'Selected scope'} has no chat channel`;
    return `${scope?.label || 'Selected scope'} / ${channel?.label || 'Selected chat'}`;
  },

  get autopilotOverviewGreeting() {
    const npub = normalizeString(this.session?.npub || this.signingNpub || this.workspaceOwnerNpub);
    const name = normalizeString(this.getSenderName?.(npub));
    const fallback = npub ? `${npub.slice(0, 10)}...` : 'there';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    return `${greeting}, ${name && name !== npub ? name : fallback}`;
  },

  get autopilotOverviewScopeOptions() {
    const options = [{ id: ALL_SCOPE_ID, label: 'All scopes' }, { id: UNSCOPED_SCOPE_ID, label: 'Unscoped' }];
    const seen = new Set(options.map((option) => option.id));
    for (const option of this.fileScopeOptions || []) {
      const id = normalizeString(option.id);
      if (!id || seen.has(id) || id === '__all__') continue;
      seen.add(id);
      options.push({ id, label: option.label || id });
    }
    return options;
  },

  get autopilotOverviewChannelOptions() {
    const context = this.autopilotOverviewContext;
    const options = context.mode === 'all' ? [{ id: ALL_CHANNEL_ID, label: 'All chats' }] : [];
    const channels = (this.channels || [])
      .filter((channel) => {
        if (!channel?.record_id || channel.record_state === 'deleted') return false;
        if (context.mode !== 'scope_channel') return true;
        return scopeMatches(recordScopeId(channel), context.scopeId, this.scopesMap);
      })
      .map((channel) => ({
        id: channel.record_id,
        label: this.getChannelLabel ? this.getChannelLabel(channel) : channelLabel(channel),
      }))
      .sort((left, right) => String(left.label || '').localeCompare(String(right.label || '')));
    return [...options, ...channels];
  },

  get autopilotOverviewComments() {
    return mergeComments(this.fileComments, this.docComments, this.taskComments);
  },

  get autopilotOverviewThreads() {
    return buildAutopilotOverviewThreads({
      channels: this.channels,
      messages: this.fileMessages?.length ? this.fileMessages : this.messages,
      selectedScopeId: this.autopilotOverviewScopeFilter,
      selectedChannelId: this.autopilotOverviewChannelFilter,
      scopesMap: this.scopesMap,
    });
  },

  get autopilotOverviewFiles() {
    return buildAutopilotOverviewFiles(this.fileBrowserRows, {
      selectedScopeId: this.autopilotOverviewScopeFilter,
      selectedChannelId: this.autopilotOverviewChannelFilter,
      scopesMap: this.scopesMap,
    });
  },

  get autopilotOverviewTasks() {
    return buildAutopilotOverviewTasks({
      tasks: this.tasks,
      comments: this.autopilotOverviewComments,
      selectedScopeId: this.autopilotOverviewScopeFilter,
      selectedChannelId: this.autopilotOverviewChannelFilter,
      scopesMap: this.scopesMap,
    });
  },

  get autopilotOverviewDocuments() {
    return buildAutopilotOverviewDocuments({
      documents: this.documents,
      comments: this.autopilotOverviewComments,
      selectedScopeId: this.autopilotOverviewScopeFilter,
      selectedChannelId: this.autopilotOverviewChannelFilter,
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
        return scopeId === context.scopeId && channelId === context.channelId;
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

  get autopilotOverviewUnresolvedDocCommentCount() {
    return this.autopilotOverviewDocuments.reduce((total, row) => total + Number(row.count || 0), 0);
  },

  get autopilotOverviewStats() {
    return {
      threads: this.autopilotOverviewThreads.length,
      tasks: this.autopilotOverviewTasks.length,
      documents: this.autopilotOverviewDocuments.length,
      unresolvedDocComments: this.autopilotOverviewUnresolvedDocCommentCount,
      files: this.autopilotOverviewFiles.length,
    };
  },

  get autopilotOverviewDiagnostics() {
    return [
      ...(this.autopilotOverviewTasks.diagnostics || []),
      ...(this.autopilotOverviewDocuments.diagnostics || []),
      ...(this.autopilotOverviewFiles.diagnostics || []),
    ];
  },

  handleAutopilotOverviewScopeChange() {
    if (!this.autopilotOverviewScopeFilter || this.autopilotOverviewScopeFilter === ALL_SCOPE_ID) {
      this.autopilotOverviewChannelFilter = ALL_CHANNEL_ID;
      return;
    }
    const firstChannel = this.autopilotOverviewChannelOptions[0];
    this.autopilotOverviewChannelFilter = firstChannel?.id || '';
  },

  openAutopilotOverviewThread(thread = {}) {
    if (!thread?.channelId) return;
    this.navigateTo('chat');
    this.selectChannel(thread.channelId);
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
