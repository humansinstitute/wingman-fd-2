import { recordFamilyHash } from './translators/chat.js';

const UNSCOPED_SCOPE_ID = '__unscoped__';
const ALL_SCOPE_ID = 'all';
const ALL_CHANNEL_ID = 'all';
const OPEN_COMMENT_STATUSES = new Set(['', 'open', 'unresolved', 'active']);

function normalizeString(value) {
  return String(value || '').trim();
}

function timestampMs(value) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : 0;
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

function channelLabel(channel = {}) {
  return normalizeString(channel.title || channel.name || channel.label) || 'Chat';
}

export function buildAutopilotOverviewThreads({
  channels = [],
  messages = [],
  selectedScopeId = ALL_SCOPE_ID,
  selectedChannelId = ALL_CHANNEL_ID,
  scopesMap = null,
} = {}) {
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
    if (!scopeMatches(channelScopeId, selectedScopeId, scopesMap)) continue;
    if (selectedChannelId && selectedChannelId !== ALL_CHANNEL_ID && message.channel_id !== selectedChannelId) continue;

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
    return String(left.title || '').localeCompare(String(right.title || ''));
  });
}

export function countUnresolvedDocumentComments({ documents = [], comments = [] } = {}) {
  const documentIds = new Set(
    (Array.isArray(documents) ? documents : [])
      .filter((document) => document?.record_id && document.record_state !== 'deleted')
      .map((document) => document.record_id)
  );
  const documentFamily = recordFamilyHash('document');
  let count = 0;

  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!comment?.record_id || comment.record_state === 'deleted') continue;
    if (comment.parent_comment_id) continue;
    if (!documentIds.has(comment.target_record_id)) continue;
    if (normalizeString(comment.target_record_family_hash) !== documentFamily) continue;
    const status = normalizeString(comment.comment_status || comment.status).toLowerCase();
    if (OPEN_COMMENT_STATUSES.has(status)) count += 1;
  }
  return count;
}

export function buildAutopilotOverviewFiles(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const ts = timestampMs(right.updated_at) - timestampMs(left.updated_at);
    if (ts !== 0) return ts;
    const name = String(left.name || '').localeCompare(String(right.name || ''));
    if (name !== 0) return name;
    return String(left.object_id || '').localeCompare(String(right.object_id || ''));
  });
}

export const autopilotOverviewManagerMixin = {
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
    return [
      { id: ALL_CHANNEL_ID, label: 'All chats' },
      ...(this.channels || [])
        .filter((channel) => channel?.record_id && channel.record_state !== 'deleted')
        .map((channel) => ({
          id: channel.record_id,
          label: this.getChannelLabel ? this.getChannelLabel(channel) : channelLabel(channel),
        }))
        .sort((left, right) => String(left.label || '').localeCompare(String(right.label || ''))),
    ];
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
    return buildAutopilotOverviewFiles(this.fileBrowserRows);
  },

  get autopilotOverviewUnresolvedDocCommentCount() {
    return countUnresolvedDocumentComments({
      documents: this.documents,
      comments: this.docComments?.length ? this.docComments : this.fileComments,
    });
  },

  get autopilotOverviewStats() {
    return {
      threads: this.autopilotOverviewThreads.length,
      documents: (this.documents || []).filter((document) => document?.record_state !== 'deleted').length,
      unresolvedDocComments: this.autopilotOverviewUnresolvedDocCommentCount,
      files: this.autopilotOverviewFiles.length,
    };
  },

  openAutopilotOverviewThread(thread = {}) {
    if (!thread?.channelId) return;
    this.navigateTo('chat');
    this.selectChannel(thread.channelId);
  },
};
