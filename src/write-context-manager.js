import { isTowerPgBackendMode } from './backend-mode.js';
import {
  getPgChannelScopeId,
  parsePgTaskBoardId,
  resolvePgThreadId,
} from './pg-record-context.js';

const SYSTEM_SCOPE_IDS = new Set(['__all__', '__recent__', '__unscoped__']);

function cleanId(value) {
  return String(value || '').trim();
}

function isActiveChannel(channel) {
  return Boolean(channel?.record_id && channel.record_state !== 'deleted');
}

function getConcreteBoardScopeId(boardId) {
  const board = parsePgTaskBoardId(boardId);
  if (board.type !== 'scope' || !board.scopeId || SYSTEM_SCOPE_IDS.has(board.scopeId)) return '';
  return board.scopeId;
}

function isSystemScopeBoard(board) {
  return board.type === 'scope' && (!board.scopeId || SYSTEM_SCOPE_IDS.has(board.scopeId));
}

export const writeContextManagerMixin = {
  get writeContextScopeOptions() {
    const channelScopeIds = new Set((this.channels || [])
      .filter(isActiveChannel)
      .map((channel) => getPgChannelScopeId(channel))
      .filter(Boolean));
    return (this.taskBoards || [])
      .filter((option) => option?.zoom === 'scope'
        && option.id
        && !SYSTEM_SCOPE_IDS.has(option.id)
        && channelScopeIds.has(option.id));
  },

  get writeContextChannelOptions() {
    const scopeId = cleanId(this.writeContextScopeId);
    return (this.channels || [])
      .filter(isActiveChannel)
      .filter((channel) => !scopeId || getPgChannelScopeId(channel) === scopeId)
      .sort((left, right) => String(this.getChannelLabel?.(left) || left.title || '').localeCompare(String(this.getChannelLabel?.(right) || right.title || '')));
  },

  get writeContextScopeLabel() {
    const scope = this.writeContextScopeId ? this.scopesMap?.get?.(this.writeContextScopeId) : null;
    return scope ? (this.getScopeBreadcrumb?.(scope.record_id) || scope.title || 'Selected scope') : '';
  },

  get writeContextTitle() {
    if (this.writeContextPendingAction?.type === 'task') return 'Choose where to create this task';
    if (this.writeContextPendingAction?.type === 'document') return 'Choose where to create this document';
    if (this.writeContextPendingAction?.type === 'files') return 'Choose where to upload these files';
    if (this.writeContextPendingAction?.type === 'inline-file') return 'Choose where to attach this file';
    if (this.writeContextPendingAction?.type === 'file-move') return 'Move this file';
    return 'Choose scope and channel';
  },

  resolvePgWriteContext(options = {}) {
    if (!isTowerPgBackendMode()) return null;
    const channels = (this.channels || []).filter(isActiveChannel);
    const board = parsePgTaskBoardId(options.boardId || this.selectedBoardId);
    const explicitChannelId = cleanId(options.channelId || options.pg_channel_id || board.channelId);
    const requestedScopeId = cleanId(options.scopeId) || getConcreteBoardScopeId(options.boardId || this.selectedBoardId);
    const needsExplicitChoice = isSystemScopeBoard(board) && !cleanId(options.scopeId) && !explicitChannelId;
    if (needsExplicitChoice) return null;
    const findChannel = (channelId) => channels.find((channel) => channel.record_id === channelId) || null;
    const channelMatchesScope = (channel) => {
      if (!channel) return false;
      const channelScopeId = getPgChannelScopeId(channel);
      return Boolean(channelScopeId && (!requestedScopeId || channelScopeId === requestedScopeId));
    };

    let channel = explicitChannelId ? findChannel(explicitChannelId) : null;
    if (!channelMatchesScope(channel)) {
      const selectedChannelId = cleanId(this.pgContextSelectedChannelId || this.selectedChannelId);
      channel = selectedChannelId ? findChannel(selectedChannelId) : null;
    }
    if (!channelMatchesScope(channel) && requestedScopeId) {
      const scopedChannels = channels.filter((entry) => getPgChannelScopeId(entry) === requestedScopeId);
      channel = scopedChannels.length === 1 ? scopedChannels[0] : null;
    }
    if (!channelMatchesScope(channel)) return null;

    const scopeId = getPgChannelScopeId(channel);
    let threadId = cleanId(options.threadId || options.pg_thread_id || board.threadId);
    if (!threadId && options.includeActiveThread === true) {
      threadId = resolvePgThreadId(this, options.threadMessageId || this.activeThreadId) || '';
    }
    return {
      scopeId,
      channelId: channel.record_id,
      channel,
      threadId: threadId || null,
    };
  },

  openWriteContextModal(type, payload = {}) {
    const existing = this.resolvePgWriteContext(payload.options || {});
    const selectedChannel = existing?.channel || (this.channels || []).find((channel) => isActiveChannel(channel) && channel.record_id === this.selectedChannelId) || null;
    const selectedScopeId = existing?.scopeId
      || getPgChannelScopeId(selectedChannel)
      || getConcreteBoardScopeId(this.selectedBoardId)
      || this.writeContextScopeOptions[0]?.id
      || '';
    const selectedChannelId = existing?.channelId
      || ((this.channels || []).find((channel) => isActiveChannel(channel) && getPgChannelScopeId(channel) === selectedScopeId)?.record_id || '');
    this.writeContextPendingAction = { type, payload };
    this.writeContextScopeId = selectedScopeId;
    this.writeContextChannelId = selectedChannelId;
    this.writeContextError = '';
    this.showWriteContextModal = true;
    return null;
  },

  closeWriteContextModal() {
    this.showWriteContextModal = false;
    this.writeContextPendingAction = null;
    this.writeContextScopeId = '';
    this.writeContextChannelId = '';
    this.writeContextError = '';
    this.writeContextSubmitting = false;
  },

  selectWriteContextScope(scopeId) {
    const nextScopeId = cleanId(scopeId);
    this.writeContextScopeId = nextScopeId;
    const selectedStillValid = this.writeContextChannelId
      && this.writeContextChannelOptions.some((channel) => channel.record_id === this.writeContextChannelId);
    if (!selectedStillValid) this.writeContextChannelId = this.writeContextChannelOptions[0]?.record_id || '';
  },

  async confirmWriteContextModal() {
    if (this.writeContextSubmitting) return null;
    const action = this.writeContextPendingAction;
    const scopeId = cleanId(this.writeContextScopeId);
    const channelId = cleanId(this.writeContextChannelId);
    const channel = (this.channels || []).find((entry) => entry?.record_id === channelId && entry.record_state !== 'deleted') || null;
    if (!action || !scopeId || !channelId || getPgChannelScopeId(channel) !== scopeId) {
      this.writeContextError = 'Select a scope and channel before continuing.';
      return null;
    }

    this.writeContextSubmitting = true;
    try {
      this.selectPgChannelContext?.(channelId);
      this.closeWriteContextModal();
      const options = {
        ...(action.payload?.options || {}),
        scopeId,
        channelId,
      };
      if (action.type === 'task') {
        return this.addTask?.(options) || null;
      }
      if (action.type === 'document') {
        return this.createDocument?.(action.payload.title, options) || null;
      }
      if (action.type === 'files') {
        return this.enqueueFileUploads?.(action.payload.files || [], options) || null;
      }
      if (action.type === 'inline-file') {
        return this.uploadFileIntoModel?.(action.payload.file, action.payload.event, options) || null;
      }
      if (action.type === 'file-move') {
        return this.moveFileBrowserRowToContext?.(action.payload.row, options) || null;
      }
      return null;
    } finally {
      this.writeContextSubmitting = false;
    }
  },
};
