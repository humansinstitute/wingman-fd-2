const PG_CHANNEL_TASK_BOARD_PREFIX = '__pg_channel__:';
const PG_THREAD_TASK_BOARD_PREFIX = '__pg_thread__:';

function normalizeId(value) {
  return String(value ?? '').trim() || null;
}

function encodePart(value) {
  return encodeURIComponent(normalizeId(value) || '');
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

export function buildPgChannelTaskBoardId(channelId) {
  const clean = normalizeId(channelId);
  return clean ? `${PG_CHANNEL_TASK_BOARD_PREFIX}${encodePart(clean)}` : '';
}

export function buildPgThreadTaskBoardId(channelId, threadId) {
  const cleanChannelId = normalizeId(channelId);
  const cleanThreadId = normalizeId(threadId);
  return cleanChannelId && cleanThreadId
    ? `${PG_THREAD_TASK_BOARD_PREFIX}${encodePart(cleanChannelId)}:${encodePart(cleanThreadId)}`
    : '';
}

export function parsePgTaskBoardId(boardId) {
  const raw = normalizeId(boardId);
  if (!raw) return { type: 'scope', scopeId: null, channelId: null, threadId: null };
  if (raw.startsWith(PG_CHANNEL_TASK_BOARD_PREFIX)) {
    const channelId = decodePart(raw.slice(PG_CHANNEL_TASK_BOARD_PREFIX.length));
    return { type: 'channel', scopeId: null, channelId: normalizeId(channelId), threadId: null };
  }
  if (raw.startsWith(PG_THREAD_TASK_BOARD_PREFIX)) {
    const rest = raw.slice(PG_THREAD_TASK_BOARD_PREFIX.length);
    const [channelPart = '', threadPart = ''] = rest.split(':');
    return {
      type: 'thread',
      scopeId: null,
      channelId: normalizeId(decodePart(channelPart)),
      threadId: normalizeId(decodePart(threadPart)),
    };
  }
  return { type: 'scope', scopeId: raw, channelId: null, threadId: null };
}

export function getPgChannelScopeId(channel = {}) {
  return normalizeId(channel?.scope_id || channel?.scope_l1_id);
}

export function resolvePgThreadId(store = {}, threadRef = null) {
  const explicit = normalizeId(threadRef);
  if (!explicit) return null;
  const messages = Array.isArray(store?.messages) ? store.messages : [];
  const message = messages.find((item) => item?.record_id === explicit || item?.pg_thread_id === explicit) || null;
  return normalizeId(message?.pg_thread_id) || explicit;
}

export function resolvePgRecordContext(store = {}, options = {}) {
  const channels = Array.isArray(store?.channels) ? store.channels : [];
  const board = parsePgTaskBoardId(options.boardId ?? store?.selectedBoardId);
  const explicitChannelId = normalizeId(options.channelId || options.pg_channel_id || board.channelId);
  const selectedChannelId = normalizeId(store?.selectedChannelId);
  const channelId = explicitChannelId || selectedChannelId;
  const channel = channels.find((entry) => entry?.record_id === channelId && entry?.record_state !== 'deleted') || null;
  if (!channel?.record_id) {
    throw new Error('Select a channel before creating a PG record');
  }

  const scopeId = getPgChannelScopeId(channel);
  if (!scopeId) {
    throw new Error('Selected PG channel is missing a scope');
  }

  const requestedScopeId = normalizeId(options.scopeId);
  if (requestedScopeId && requestedScopeId !== scopeId) {
    throw new Error('Selected PG channel does not belong to the requested scope');
  }

  if (board.type === 'thread' && board.channelId && board.channelId !== channel.record_id) {
    throw new Error('Selected PG thread does not belong to the selected channel');
  }

  let threadId = normalizeId(options.threadId || options.pg_thread_id || board.threadId);
  if (!threadId && options.includeActiveThread === true) {
    threadId = resolvePgThreadId(store, options.threadMessageId || store?.activeThreadId);
  }

  return {
    scopeId,
    channelId: channel.record_id,
    channel,
    threadId,
  };
}
