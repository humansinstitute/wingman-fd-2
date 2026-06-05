import { downloadStorageObjectBlob } from './api.js';
import { recordFamilyHash } from './translators/chat.js';

const UNSCOPED_TASK_BOARD_ID = '__unscoped__';
const STORAGE_REF_RE = /storage:\/\/([A-Za-z0-9-]+)/g;
const MARKDOWN_STORAGE_REF_RE = /(!?)\[([^\]]*)\]\(storage:\/\/([A-Za-z0-9-]+)(?:\s+["'][^"']*["'])?\)/g;

function normalizeString(value) {
  return String(value || '').trim();
}

function uniqueStorageRefs(value = '') {
  const refs = [];
  const seen = new Set();
  const source = String(value || '');
  let match;
  while ((match = MARKDOWN_STORAGE_REF_RE.exec(source)) !== null) {
    const objectId = normalizeString(match[3]);
    if (!objectId || seen.has(objectId)) continue;
    const isImage = match[1] === '!';
    seen.add(objectId);
    refs.push({
      objectId,
      offset: match.index,
      kind: isImage ? 'image' : 'file',
      name: normalizeString(match[2] || '') || (isImage ? 'Image' : 'File'),
      contentType: isImage ? 'image' : '',
    });
  }

  while ((match = STORAGE_REF_RE.exec(source)) !== null) {
    const objectId = normalizeString(match[1]);
    if (!objectId || seen.has(objectId)) continue;
    seen.add(objectId);
    refs.push({
      objectId,
      offset: match.index,
      kind: 'file',
      name: extractStorageRefLabel(source, match.index) || 'File',
      contentType: '',
    });
  }
  return refs;
}

function extractStorageRefLabel(source, hrefIndex) {
  const prefix = source.slice(Math.max(0, hrefIndex - 160), hrefIndex);
  const match = prefix.match(/!?\[([^\]]*)\]\([^)]*$/);
  return normalizeString(match?.[1] || '');
}

function getRecordScopeId(row = {}) {
  return normalizeString(
    row.scope_id
    || row.scope_l5_id
    || row.scope_l4_id
    || row.scope_l3_id
    || row.scope_l2_id
    || row.scope_l1_id
    || ''
  ) || null;
}

function matchesScope(rowScopeId, selectedScopeId, scopesMap) {
  const selected = normalizeString(selectedScopeId);
  const rowScope = normalizeString(rowScopeId);
  if (!selected || selected === 'all' || selected === '__all__') return true;
  if (selected === UNSCOPED_TASK_BOARD_ID) return !rowScope;
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

function sortRows(rows = []) {
  return [...rows].sort((a, b) => {
    const ts = String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    if (ts !== 0) return ts;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function kindFromContentType(contentType = '') {
  const normalized = normalizeString(contentType).toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.includes('pdf') || normalized.includes('document') || normalized.includes('text/')) return 'document';
  return 'file';
}

function baseRow({
  object_id,
  kind,
  name,
  source_type,
  source_label,
  source_record_id,
  scope_id = null,
  channel_id = null,
  content_type = '',
  size_bytes = null,
  updated_at = '',
  preview = '',
}) {
  const objectId = normalizeString(object_id);
  return {
    id: `${source_type}:${source_record_id || 'record'}:${objectId}`,
    object_id: objectId,
    kind,
    name: normalizeString(name) || objectId || 'File',
    source_type,
    source_label: normalizeString(source_label) || 'Flight Deck',
    source_record_id: source_record_id || null,
    scope_id: scope_id || null,
    channel_id: channel_id || null,
    content_type: normalizeString(content_type),
    size_bytes: Number.isFinite(Number(size_bytes)) ? Number(size_bytes) : null,
    updated_at: updated_at || '',
    preview: normalizeString(preview),
  };
}

function commentTargetContext(comment, context) {
  const targetId = normalizeString(comment?.target_record_id);
  const family = normalizeString(comment?.target_record_family_hash);
  if (!targetId) return {};

  if (family === recordFamilyHash('document')) {
    const document = context.documentById.get(targetId);
    return {
      scope_id: getRecordScopeId(document),
      source_label: `Comment on ${document?.title || 'document'}`,
    };
  }

  if (family === recordFamilyHash('task')) {
    const task = context.taskById.get(targetId);
    return {
      scope_id: getRecordScopeId(task),
      source_label: `Comment on ${task?.title || 'task'}`,
    };
  }

  if (family === recordFamilyHash('chat_message')) {
    const message = context.messageById.get(targetId);
    const channel = context.channelById.get(message?.channel_id);
    return {
      channel_id: message?.channel_id || null,
      source_label: `Comment in ${channel?.title || 'chat'}`,
    };
  }

  return {};
}

function audioTargetContext(note, context) {
  const targetId = normalizeString(note?.target_record_id);
  const family = normalizeString(note?.target_record_family_hash);
  if (!targetId) return {};

  if (family === recordFamilyHash('chat_message')) {
    const message = context.messageById.get(targetId);
    const channel = context.channelById.get(message?.channel_id);
    return {
      channel_id: message?.channel_id || null,
      source_label: channel?.title ? `Audio in ${channel.title}` : 'Chat audio',
    };
  }

  if (family === recordFamilyHash('document')) {
    const document = context.documentById.get(targetId);
    return {
      scope_id: getRecordScopeId(document),
      source_label: document?.title ? `Audio on ${document.title}` : 'Document audio',
    };
  }

  if (family === recordFamilyHash('task')) {
    const task = context.taskById.get(targetId);
    return {
      scope_id: getRecordScopeId(task),
      source_label: task?.title ? `Audio on ${task.title}` : 'Task audio',
    };
  }

  return {};
}

export function buildFileBrowserRows(store = {}) {
  const documents = Array.isArray(store.documents) ? store.documents : [];
  const tasks = Array.isArray(store.tasks) ? store.tasks : [];
  const channels = Array.isArray(store.channels) ? store.channels : [];
  const messages = Array.isArray(store.fileMessages) ? store.fileMessages : [];
  const comments = Array.isArray(store.fileComments) ? store.fileComments : [];
  const audioNotes = Array.isArray(store.audioNotes) ? store.audioNotes : [];

  const context = {
    documentById: new Map(documents.map((document) => [document.record_id, document])),
    taskById: new Map(tasks.map((task) => [task.record_id, task])),
    channelById: new Map(channels.map((channel) => [channel.record_id, channel])),
    messageById: new Map(messages.map((message) => [message.record_id, message])),
  };

  const rows = [];

  for (const document of documents) {
    const scopeId = getRecordScopeId(document);
    if (document.content_storage_object_id) {
      rows.push(baseRow({
        object_id: document.content_storage_object_id,
        kind: 'document',
        name: document.title || 'Document content',
        source_type: 'document',
        source_label: document.title || 'Untitled document',
        source_record_id: document.record_id,
        scope_id: scopeId,
        content_type: document.content_storage_content_type,
        size_bytes: document.content_size_bytes,
        updated_at: document.updated_at,
      }));
    }
    for (const ref of uniqueStorageRefs(document.content)) {
      rows.push(baseRow({
        object_id: ref.objectId,
        kind: ref.kind,
        name: ref.name,
        source_type: 'document',
        source_label: document.title || 'Untitled document',
        source_record_id: document.record_id,
        scope_id: scopeId,
        content_type: ref.contentType,
        updated_at: document.updated_at,
      }));
    }
  }

  for (const task of tasks) {
    const scopeId = getRecordScopeId(task);
    for (const ref of uniqueStorageRefs(task.description)) {
      rows.push(baseRow({
        object_id: ref.objectId,
        kind: ref.kind,
        name: ref.name,
        source_type: 'task',
        source_label: task.title || 'Untitled task',
        source_record_id: task.record_id,
        scope_id: scopeId,
        content_type: ref.contentType,
        updated_at: task.updated_at,
      }));
    }
  }

  for (const message of messages) {
    const channel = context.channelById.get(message.channel_id);
    for (const ref of uniqueStorageRefs(message.body)) {
      rows.push(baseRow({
        object_id: ref.objectId,
        kind: ref.kind,
        name: ref.name,
        source_type: 'chat',
        source_label: channel?.title || 'Chat',
        source_record_id: message.record_id,
        channel_id: message.channel_id || null,
        content_type: ref.contentType,
        updated_at: message.updated_at,
        preview: message.body,
      }));
    }
  }

  for (const comment of comments) {
    const target = commentTargetContext(comment, context);
    for (const ref of uniqueStorageRefs(comment.body)) {
      rows.push(baseRow({
        object_id: ref.objectId,
        kind: ref.kind,
        name: ref.name,
        source_type: 'comment',
        source_label: target.source_label || 'Comment',
        source_record_id: comment.record_id,
        scope_id: target.scope_id || null,
        channel_id: target.channel_id || null,
        content_type: ref.contentType,
        updated_at: comment.updated_at,
        preview: comment.body,
      }));
    }
  }

  for (const note of audioNotes) {
    if (!note.storage_object_id) continue;
    const target = audioTargetContext(note, context);
    rows.push(baseRow({
      object_id: note.storage_object_id,
      kind: 'audio',
      name: note.title || 'Voice note',
      source_type: 'audio',
      source_label: target.source_label || 'Audio note',
      source_record_id: note.record_id,
      scope_id: target.scope_id || null,
      channel_id: target.channel_id || null,
      content_type: note.mime_type || 'audio/webm',
      size_bytes: note.size_bytes,
      updated_at: note.updated_at || note.created_at,
      preview: note.transcript_preview || note.summary || '',
    }));
  }

  const deduped = new Map();
  for (const row of rows) {
    if (!row.object_id) continue;
    const key = `${row.object_id}:${row.source_type}:${row.source_record_id || ''}`;
    deduped.set(key, row);
  }
  return sortRows([...deduped.values()]);
}

export function filterFileBrowserRows(rows = [], {
  query = '',
  type = 'all',
  source = 'all',
  scopeId = 'all',
  channelId = 'all',
  scopesMap = null,
} = {}) {
  const normalizedQuery = normalizeString(query).toLowerCase();
  const normalizedType = normalizeString(type) || 'all';
  const normalizedSource = normalizeString(source) || 'all';
  const normalizedChannel = normalizeString(channelId) || 'all';

  return rows.filter((row) => {
    if (normalizedType !== 'all' && row.kind !== normalizedType) return false;
    if (normalizedSource !== 'all' && row.source_type !== normalizedSource) return false;
    if (normalizedChannel !== 'all' && row.channel_id !== normalizedChannel) return false;
    if (!matchesScope(row.scope_id, scopeId, scopesMap)) return false;
    if (!normalizedQuery) return true;
    return [
      row.name,
      row.source_label,
      row.object_id,
      row.content_type,
      row.preview,
    ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
  });
}

export const filesManagerMixin = {
  applyFileMessages(messages = []) {
    this.fileMessages = Array.isArray(messages) ? messages : [];
  },

  applyFileComments(comments = []) {
    this.fileComments = Array.isArray(comments) ? comments : [];
  },

  get fileBrowserRows() {
    return buildFileBrowserRows(this);
  },

  get filteredFileBrowserRows() {
    return filterFileBrowserRows(this.fileBrowserRows, {
      query: this.fileSearch,
      type: this.fileTypeFilter,
      source: this.fileSourceFilter,
      scopeId: this.fileScopeFilter,
      channelId: this.fileChannelFilter,
      scopesMap: this.scopesMap,
    });
  },

  get fileScopeOptions() {
    const options = [
      { id: 'all', label: 'All scopes' },
      { id: UNSCOPED_TASK_BOARD_ID, label: 'Unscoped' },
    ];
    for (const option of this.flightDeckScopeOptions || []) {
      if (!option?.id || option.id === UNSCOPED_TASK_BOARD_ID || option.id === 'all' || option.id === '__all__') continue;
      options.push({ id: option.id, label: option.label || option.id });
    }
    return options;
  },

  get fileChannelOptions() {
    return [
      { id: 'all', label: 'All chats' },
      ...(this.channels || [])
        .filter((channel) => channel?.record_state !== 'deleted')
        .map((channel) => ({
          id: channel.record_id,
          label: this.getChannelLabel ? this.getChannelLabel(channel) : (channel.title || 'Chat'),
        })),
    ];
  },

  getFileKindLabel(row = {}) {
    if (row.kind === 'image') return 'Image';
    if (row.kind === 'audio') return 'Audio';
    if (row.kind === 'document') return 'Document';
    return 'File';
  },

  formatFileSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  },

  fileUpdatedLabel(row = {}) {
    if (!row.updated_at) return '';
    const date = new Date(row.updated_at);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  async downloadStorageObjectAsFile(objectId, fileName = '', fallbackKind = '') {
    const normalizedObjectId = normalizeString(objectId);
    if (!normalizedObjectId || typeof document === 'undefined') return;
    try {
      const blob = await downloadStorageObjectBlob(normalizedObjectId);
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = this.fileDownloadName({
        object_id: normalizedObjectId,
        name: normalizeString(fileName) || normalizedObjectId,
        kind: normalizeString(fallbackKind) || kindFromContentType(blob.type),
      });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error) {
      this.error = error?.message || 'Could not download file.';
    }
  },

  async downloadFileBrowserRow(row = {}) {
    const objectId = normalizeString(row.object_id);
    if (!objectId) return;
    await this.downloadStorageObjectAsFile(objectId, row.name || objectId, row.kind || 'file');
  },

  fileDownloadName(row = {}) {
    const rawName = normalizeString(row.name) || normalizeString(row.object_id) || 'file';
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
    if (safeName.includes('.')) return safeName;
    if (row.kind === 'image') return `${safeName}.png`;
    if (row.kind === 'audio') return `${safeName}.webm`;
    if (row.kind === 'document') return `${safeName}.json`;
    return safeName;
  },

  openFileBrowserSource(row = {}) {
    if (row.source_type === 'document' && row.source_record_id) {
      this.navigateTo('docs');
      this.openDoc(row.source_record_id);
      return;
    }
    if (row.source_type === 'task' && row.source_record_id) {
      this.navigateTo('tasks');
      this.openTaskDetail(row.source_record_id);
      return;
    }
    if (row.source_type === 'chat') {
      this.navigateTo('chat');
      if (row.channel_id) this.selectChannel(row.channel_id);
      return;
    }
    if (row.source_type === 'comment') {
      this.navigateTo('docs');
      return;
    }
    if (row.source_type === 'audio') {
      if (row.channel_id) {
        this.navigateTo('chat');
        this.selectChannel(row.channel_id);
      }
    }
  },
};
