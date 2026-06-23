/**
 * Chat message management methods extracted from app.js.
 *
 * The chatMessageManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  getMessagesByChannel,
  getMessagesByChannels,
  getMessageById,
  upsertMessage,
  replaceMessageRecord,
  upsertChannel,
  addPendingWrite,
  deleteChannelRuntimeState,
} from './db.js';
import { fetchRecordHistory } from './api.js';
import { deleteTowerPgChannel } from './api.js';
import {
  outboundChatMessage,
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  rankMainFeedMessages,
  rankThreadReplies,
  resolveVisibleThreadReplyCount,
  sortMessagesByUpdatedAt,
} from './chat-order.js';
import {
  buildChatThreadFlowDispatchPreview,
  createChatThreadFlowDispatchState,
  getChatThreadFlowDispatchScopeSourceLabel,
  normalizeChatThreadFlowDispatchScopeAssignment,
  resolveChatThreadFlowDispatchScope,
  resolveChatThreadFlowDispatchThread,
} from './chat-thread-flow-dispatch.js';
import {
  CHAT_GET_IT_DONE_OUTPUT_TYPES,
  buildChatGetItDoneTaskDescription,
  createChatGetItDoneState,
} from './chat-get-it-done.js';
import { buildStoredFlowKickoffScopeAssignment } from './task-flow-helpers.js';
import { UNSCOPED_TASK_BOARD_ID } from './task-board-state.js';
import { sameListBySignature } from './utils/state-helpers.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { DM_SCOPE_ID, buildDmChannelDescription, findExistingDmChannel } from './dm-scope.js';
import {
  createTowerPgMessageFromLocal,
  archiveTowerPgThreadFromLocal,
  deleteTowerPgMessageFromLocal,
  deleteTowerPgThreadFromLocal,
} from './pg-write-adapter.js';
import { resolveTowerPgWorkspaceContext } from './pg-read-hydrator.js';
import { resolvePgThreadId } from './pg-record-context.js';
import { buildSectionUrl, parseRouteLocation } from './route-helpers.js';
import {
  buildFlightDeckReference,
  normalizeRecordLinkType,
} from './record-links.js';
import {
  hasPreviewId,
  prunePreviewState,
  schedulePreviewMeasurement,
  togglePreviewId,
} from './preview-truncation.js';

const chatDerivedCache = new WeakMap();
const THREAD_REPLY_PREVIEW_WORD_LIMIT = 50;
const RESPONSE_ACTIVITY_WORDS = ['Thinking', 'Implementing', 'Writing'];
const RESPONSE_ACTIVITY_SUFFIXES = ['.', '.+', '.*', '..+', '..*', '...', '+', '*'];

function isVisibleResponseActivity(activity = {}, nowMs = Date.now()) {
  if (!activity?.record_id) return false;
  if (String(activity.status || '') === 'cleared' || String(activity.record_state || '') === 'cleared' || activity.cleared_at) return false;
  const expiresAt = Date.parse(activity.expires_at || '');
  return !Number.isFinite(expiresAt) || expiresAt > nowMs;
}

function sortResponseActivities(activities = []) {
  return [...activities].sort((left, right) => String(left.updated_at || '').localeCompare(String(right.updated_at || '')));
}

function audioNoteSignature(audioNotes = []) {
  return (Array.isArray(audioNotes) ? audioNotes : [])
    .map((note) => [
      String(note?.record_id || ''),
      String(note?.target_record_id || ''),
      String(note?.target_record_family_hash || ''),
      String(note?.record_state || ''),
      String(note?.updated_at || ''),
      String(note?.version ?? ''),
    ].join(':'))
    .join('|');
}

function buildMessageAudioAttachmentsByTarget(audioNotes = []) {
  const byTarget = new Map();
  const chatMessageFamilyHash = recordFamilyHash('chat_message');
  for (const note of Array.isArray(audioNotes) ? audioNotes : []) {
    const recordId = String(note?.record_id || '').trim();
    const targetRecordId = String(note?.target_record_id || '').trim();
    const targetFamilyHash = String(note?.target_record_family_hash || '').trim();
    if (!recordId || !targetRecordId || targetFamilyHash !== chatMessageFamilyHash) continue;
    if (String(note?.record_state || 'active') === 'deleted') continue;
    const list = byTarget.get(targetRecordId) || [];
    list.push({
      kind: 'audio',
      audio_note_record_id: recordId,
      title: note?.title || 'Voice note',
      duration_seconds: Number.isFinite(Number(note?.duration_seconds)) ? Number(note.duration_seconds) : null,
    });
    byTarget.set(targetRecordId, list);
  }
  return byTarget;
}

function attachTargetAudioNotesToMessages(messages = [], audioNotes = []) {
  const byTarget = buildMessageAudioAttachmentsByTarget(audioNotes);
  if (byTarget.size === 0) return messages;
  return messages.map((message) => {
    const targetAttachments = byTarget.get(message?.record_id);
    if (!targetAttachments?.length) return message;
    const existingAttachments = Array.isArray(message?.attachments) ? message.attachments : [];
    const existingAudioIds = new Set(
      existingAttachments
        .filter((attachment) => attachment?.kind === 'audio')
        .map((attachment) => String(attachment?.audio_note_record_id || '').trim())
        .filter(Boolean),
    );
    const missingAttachments = targetAttachments.filter((attachment) => !existingAudioIds.has(attachment.audio_note_record_id));
    if (missingAttachments.length === 0) return message;
    return {
      ...message,
      attachments: [...existingAttachments, ...missingAttachments],
    };
  });
}

function scheduleUiNextTick(callback) {
  const nextTick = globalThis.Alpine?.nextTick;
  if (typeof nextTick === 'function') {
    nextTick(callback);
    return;
  }
  queueMicrotask(callback);
}

function channelDescriptor(channel = {}) {
  return [
    channel.title,
    channel.name,
    channel.description,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

function resolveAgentDmTargetNpub(channel, botNpub, memberNpub) {
  const explicit = String(botNpub || '').trim();
  if (explicit) return explicit;
  const senderNpub = String(memberNpub || '').trim();
  const descriptor = channelDescriptor(channel);
  const candidates = descriptor.match(/\bnpub1[023456789acdefghjklmnpqrstuvwxyz]+\b/gi) || [];
  return candidates.find((npub) => npub !== senderNpub) || '';
}

function isAgentDmChannel(channel, targetNpub, memberNpub) {
  const target = String(targetNpub || '').trim();
  const senderNpub = String(memberNpub || '').trim();
  if (!channel || !target || !senderNpub) return false;
  const channelType = String(channel.channel_type || channel.kind || '').trim();
  const participants = Array.isArray(channel.participant_npubs)
    ? channel.participant_npubs.map((npub) => String(npub || '').trim())
    : [];
  if (participants.includes(target) && participants.includes(senderNpub)) return true;
  const descriptor = channelDescriptor(channel);
  return descriptor.includes(target) && (channelType === 'dm' || /^DM:/i.test(descriptor));
}

async function ensureTowerPgAgentDmAccess(store, channel) {
  const targetNpub = resolveAgentDmTargetNpub(channel, store.botNpub, store.session?.npub);
  if (!isAgentDmChannel(channel, targetNpub, store.session?.npub)) return true;
  if (typeof store.ensureTowerPgDmChannel !== 'function') {
    store.error = 'Agent DMs are not available in this workspace view.';
    return false;
  }
  try {
    await store.ensureTowerPgDmChannel(targetNpub);
    return true;
  } catch (error) {
    store.error = error?.message || 'Failed to prepare agent DM';
    return false;
  }
}

function getChatDerivedState(store) {
  const sourceMessages = Array.isArray(store?.messages) ? store.messages : [];
  const audioNotes = Array.isArray(store?.audioNotes) ? store.audioNotes : [];
  const currentAudioNoteSignature = audioNoteSignature(audioNotes);
  const activeThreadId = store?.activeThreadId ?? null;
  const focusMessageId = store?.focusMessageId ?? null;
  const showArchivedChatThreads = store?.showArchivedChatThreads === true;
  const mainFeedVisibleCount = Math.max(
    0,
    Number(store?.mainFeedVisibleCount ?? store?.MAIN_FEED_PAGE_SIZE ?? 0) || 0,
  );
  const threadVisibleReplyCount = Math.max(0, Number(store?.threadVisibleReplyCount) || 0);

  const previous = chatDerivedCache.get(store);
  if (
    previous
    && previous.messages === sourceMessages
    && previous.audioNoteSignature === currentAudioNoteSignature
    && previous.activeThreadId === activeThreadId
    && previous.focusMessageId === focusMessageId
    && previous.showArchivedChatThreads === showArchivedChatThreads
    && previous.mainFeedVisibleCount === mainFeedVisibleCount
    && previous.threadVisibleReplyCount === threadVisibleReplyCount
  ) {
    return previous.value;
  }

  const messages = attachTargetAudioNotesToMessages(
    sourceMessages.filter((message) => String(message?.record_state || 'active') !== 'deleted'),
    audioNotes,
  );
  const mainFeedMessagesAll = rankMainFeedMessages(messages);
  const archivedMainFeedMessages = mainFeedMessagesAll
    .filter((message) => String(message?.record_state || 'active') === 'archived');
  const mainFeedMessages = showArchivedChatThreads
    ? mainFeedMessagesAll
    : mainFeedMessagesAll.filter((message) => String(message?.record_state || 'active') !== 'archived');
  const resolvedMainFeedVisibleCount = resolveVisibleThreadReplyCount(
    mainFeedMessages,
    mainFeedVisibleCount,
    focusMessageId,
  );
  const visibleMainFeedMessages = mainFeedMessages.slice(-resolvedMainFeedVisibleCount);
  const hiddenMainFeedCount = Math.max(0, mainFeedMessages.length - resolvedMainFeedVisibleCount);

  const threadMessages = activeThreadId ? rankThreadReplies(messages, activeThreadId) : [];
  const resolvedThreadVisibleReplyCount = resolveVisibleThreadReplyCount(
    threadMessages,
    threadVisibleReplyCount,
    focusMessageId,
  );
  const visibleThreadMessages = threadMessages.slice(-resolvedThreadVisibleReplyCount);
  const hiddenThreadReplyCount = Math.max(0, threadMessages.length - resolvedThreadVisibleReplyCount);

  const value = {
    mainFeedMessages,
    archivedMainFeedMessages,
    resolvedMainFeedVisibleCount,
    visibleMainFeedMessages,
    hiddenMainFeedCount,
    threadMessages,
    resolvedThreadVisibleReplyCount,
    visibleThreadMessages,
    hiddenThreadReplyCount,
  };

  chatDerivedCache.set(store, {
    messages: sourceMessages,
    audioNoteSignature: currentAudioNoteSignature,
    activeThreadId,
    focusMessageId,
    showArchivedChatThreads,
    mainFeedVisibleCount,
    threadVisibleReplyCount,
    value,
  });

  return value;
}

function normalizePreviewText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateWords(value, limit = THREAD_REPLY_PREVIEW_WORD_LIMIT) {
  const words = normalizePreviewText(value).split(' ').filter(Boolean);
  if (words.length <= limit) return words.join(' ');
  return `${words.slice(0, limit).join(' ')}...`;
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const chatMessageManagerMixin = {

  // --- computed getters ---

  get selectedChannel() {
    return this.channels.find(c => c.record_id === this.selectedChannelId) ?? null;
  },

  get mainFeedMessages() {
    return getChatDerivedState(this).mainFeedMessages;
  },

  get resolvedMainFeedVisibleCount() {
    return getChatDerivedState(this).resolvedMainFeedVisibleCount;
  },

  get visibleMainFeedMessages() {
    return getChatDerivedState(this).visibleMainFeedMessages;
  },

  get hiddenMainFeedCount() {
    return getChatDerivedState(this).hiddenMainFeedCount;
  },

  get archivedMainFeedMessages() {
    return getChatDerivedState(this).archivedMainFeedMessages;
  },

  get archivedMainFeedCount() {
    return this.archivedMainFeedMessages.length;
  },

  get hasArchivedChatThreads() {
    return this.archivedMainFeedCount > 0;
  },

  get hasMoreMainFeedMessages() {
    return this.hiddenMainFeedCount > 0;
  },

  get showMainFeedLoadMoreControl() {
    return this.hasMoreMainFeedMessages || this.hasArchivedChatThreads;
  },

  get threadMessages() {
    return getChatDerivedState(this).threadMessages;
  },
  get activeThreadResponseActivities() {
    const now = Date.now();
    return (Array.isArray(this.threadResponseActivities) ? this.threadResponseActivities : [])
      .filter((activity) => isVisibleResponseActivity(activity, now))
      .sort((left, right) => String(left.updated_at || '').localeCompare(String(right.updated_at || '')));
  },

  get resolvedThreadVisibleReplyCount() {
    return getChatDerivedState(this).resolvedThreadVisibleReplyCount;
  },

  get visibleThreadMessages() {
    return getChatDerivedState(this).visibleThreadMessages;
  },

  get hiddenThreadReplyCount() {
    return getChatDerivedState(this).hiddenThreadReplyCount;
  },

  get hasMoreThreadMessages() {
    return this.hiddenThreadReplyCount > 0;
  },

  get chatThreadFlowDispatchSelectedFlow() {
    return this.flows.find((flow) => flow.record_id === this.chatThreadFlowDispatchSelectedFlowId) ?? null;
  },

  get chatThreadFlowDispatchSourceChannel() {
    const channelId = this.chatThreadFlowDispatchSource?.channelId || null;
    return this.channels.find((channel) => channel.record_id === channelId) ?? null;
  },

  get chatThreadFlowDispatchResolvedScopeLabel() {
    if (!this.chatThreadFlowDispatchResolvedScopeId) return 'No scope';
    return this.getTaskBoardOptionLabel(this.chatThreadFlowDispatchResolvedScopeId) || this.chatThreadFlowDispatchResolvedScopeId;
  },

  get chatThreadFlowDispatchScopeSourceLabel() {
    return getChatThreadFlowDispatchScopeSourceLabel(this.chatThreadFlowDispatchScopeSource);
  },

  get chatThreadFlowDispatchCanSubmit() {
    if (this.chatThreadFlowDispatchLoading || this.chatThreadFlowDispatchSubmitting) return false;
    if (!this.chatThreadFlowDispatchSelectedFlowId) return false;
    if (!this.chatThreadFlowDispatchSource?.channelId) return false;
    if (this.chatThreadFlowDispatchMessages.length === 0) return false;
    return String(this.chatThreadFlowDispatchPreview || '').trim().length > 0;
  },

  get chatGetItDoneSourceChannel() {
    const channelId = this.chatGetItDoneSource?.channelId || null;
    return this.channels.find((channel) => channel.record_id === channelId) ?? null;
  },

  get chatGetItDoneOutputTypes() {
    return CHAT_GET_IT_DONE_OUTPUT_TYPES;
  },

  get chatGetItDoneAssigneeOptions() {
    const seen = new Set();
    const add = (options, npub, role) => {
      const clean = String(npub || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      options.push({
        npub: clean,
        label: this.getSenderName?.(clean) || clean,
        role,
      });
    };
    const options = [];
    add(options, this.chatGetItDoneAssigneeNpub, 'Default');
    add(options, this.defaultAgentNpub, 'Default agent');
    add(options, this.botNpub, 'Agent');
    const channel = this.chatGetItDoneSourceChannel || this.selectedChannel;
    for (const npub of (Array.isArray(channel?.participant_npubs) ? channel.participant_npubs : [])) {
      add(options, npub, 'Participant');
    }
    for (const group of (this.currentWorkspaceGroups || [])) {
      for (const npub of (Array.isArray(group?.member_npubs) ? group.member_npubs : [])) {
        add(options, npub, 'Workspace');
      }
    }
    return options;
  },

  get chatGetItDoneAssigneeLabel() {
    const npub = String(this.chatGetItDoneAssigneeNpub || '').trim();
    if (!npub) return 'Unassigned';
    return this.getSenderName?.(npub) || npub;
  },

  get chatGetItDoneAssigneeSuggestions() {
    const selected = String(this.chatGetItDoneAssigneeNpub || '').trim();
    const query = String(this.chatGetItDoneAssigneeQuery || '').trim();
    const selectedSet = new Set(selected ? [selected] : []);
    const seen = new Set();
    const options = this.chatGetItDoneAssigneeOptions
      .filter((option) => !selectedSet.has(option.npub))
      .map((option) => ({
        npub: option.npub,
        label: option.label,
        subtitle: option.role || option.npub,
        avatarUrl: this.getSenderAvatar?.(option.npub) || null,
      }));
    const addUnique = (items, item) => {
      const npub = String(item?.npub || '').trim();
      if (!npub || selectedSet.has(npub) || seen.has(npub)) return;
      seen.add(npub);
      items.push({ ...item, npub });
    };

    if (!query) {
      const defaults = [];
      for (const option of options) addUnique(defaults, option);
      return defaults.slice(0, 8);
    }

    const needle = query.toLowerCase();
    const matches = [];
    for (const person of (typeof this.findPeopleSuggestions === 'function'
      ? this.findPeopleSuggestions(query, selected ? [selected] : [])
      : [])) {
      addUnique(matches, person);
    }
    for (const option of options) {
      if (
        String(option.npub || '').toLowerCase().includes(needle)
        || String(option.label || '').toLowerCase().includes(needle)
        || String(option.subtitle || '').toLowerCase().includes(needle)
      ) {
        addUnique(matches, option);
      }
    }
    return matches.slice(0, 8);
  },

  get chatGetItDoneScopeSelection() {
    const scopeId = String(this.chatGetItDoneScopeId || '').trim();
    return scopeId ? this.scopesMap?.get(scopeId) || null : null;
  },

  get chatGetItDoneScopeLabel() {
    const scopeId = String(this.chatGetItDoneScopeId || '').trim();
    if (!scopeId) return 'Current workspace';
    return this.getTaskBoardOptionLabel?.(scopeId)
      || this.getScopeBreadcrumb?.(scopeId)
      || this.chatGetItDoneScopeSelection?.title
      || scopeId;
  },

  get chatGetItDoneScopeSuggestions() {
    const query = String(this.chatGetItDoneScopeQuery || '').trim();
    const selected = String(this.chatGetItDoneScopeId || '').trim();
    const items = typeof this.scopePickerFlatFor === 'function'
      ? this.scopePickerFlatFor(query)
      : [];
    return items
      .filter((item) => item?.record_id !== selected)
      .slice(0, 20);
  },

  get chatGetItDoneCanSubmit() {
    if (this.chatGetItDoneSubmitting) return false;
    if (!this.chatGetItDoneSource?.channelId) return false;
    if (this.chatGetItDoneMessages.length === 0) return false;
    return String(this.chatGetItDoneTitle || '').trim().length > 0;
  },

  // --- scroll anchoring ---

  scheduleChatFeedScrollToBottom(retries = 3) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      if (this.chatFeedScrollFrame) window.cancelAnimationFrame(this.chatFeedScrollFrame);
      this.chatFeedScrollFrame = window.requestAnimationFrame(() => {
        this.chatFeedScrollFrame = null;
        const feed = document.querySelector('[data-chat-feed]');
        if (!feed) {
          if (retries > 0) this.scheduleChatFeedScrollToBottom(retries - 1);
          return;
        }
        feed.scrollTop = feed.scrollHeight;
        this.updateChatFeedLoadMoreVisibility(feed);
        if (retries > 0) {
          this.scheduleChatFeedScrollToBottom(retries - 1);
        }
      });
    });
  },

  scheduleThreadRepliesScrollToBottom() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      if (this.threadRepliesScrollFrame) window.cancelAnimationFrame(this.threadRepliesScrollFrame);
      this.threadRepliesScrollFrame = window.requestAnimationFrame(() => {
        this.threadRepliesScrollFrame = null;
        const replies = document.querySelector('[data-thread-replies]');
        if (!replies) return;
        replies.scrollTop = replies.scrollHeight;
      });
    });
  },

  // --- composer autosize ---

  autosizeComposer(textarea) {
    if (!textarea || typeof window === 'undefined') return;
    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const borderY = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
    const minHeight = parseFloat(styles.minHeight) || (lineHeight + paddingY + borderY);
    const maxHeight = (lineHeight * this.COMPOSER_MAX_LINES) + paddingY + borderY;

    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 0)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  },

  scheduleComposerAutosize(context) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      const textarea = document.querySelector(`[data-chat-composer="${context}"]`);
      if (!textarea) return;
      this.autosizeComposer(textarea);
    });
  },

  updateChatFeedLoadMoreVisibility(feed) {
    const nextFeed = feed && typeof feed.scrollTop === 'number'
      ? feed
      : (typeof document !== 'undefined' ? document.querySelector('[data-chat-feed]') : null);
    if (!nextFeed) return;
    this.chatFeedNearTop = nextFeed.scrollTop <= 96;
  },

  // --- messages ---

  async applyMessages(messages = [], options = {}) {
    const nextMessages = sortMessagesByUpdatedAt(Array.isArray(messages) ? messages : []);
    const messagesChanged = !sameListBySignature(this.messages, nextMessages);
    const chatFeedAnchor = messagesChanged
      ? this.captureScrollAnchor({
        containerSelector: '[data-chat-feed]',
        itemSelector: '[data-message-id]',
        itemAttribute: 'data-message-id',
      })
      : null;
    const threadRepliesAnchor = messagesChanged
      ? this.captureScrollAnchor({
        containerSelector: '[data-thread-replies]',
        itemSelector: '[data-thread-message-id]',
        itemAttribute: 'data-thread-message-id',
      })
      : null;

    if (messagesChanged) {
      this.messages = nextMessages;
    }

    // Resolve sender profiles for display without writing back to Dexie.
    // rememberPeople writes to the address book which triggers reactive
    // cascades when called from a liveQuery handler.
    if (typeof this.resolveChatProfile === 'function') {
      const senderNpubs = [...new Set(nextMessages.map((m) => m.sender_npub).filter(Boolean))];
      for (const npub of senderNpubs) {
        this.resolveChatProfile(npub);
      }
    }

    if (
      this.activeThreadId
      && !nextMessages.some((message) => message.record_id === this.activeThreadId || message.parent_message_id === this.activeThreadId)
    ) {
      this.closeThread({ syncRoute: false });
    }

    this.syncChatPreviewState();
    this.scheduleChatPreviewMeasurement();
    this.scheduleStorageImageHydration();
    if (typeof this.refreshReactionsForVisibleTargets === 'function') {
      this.refreshReactionsForVisibleTargets().catch(() => {});
    }

    const shouldScrollChatToLatest = options.scrollToLatest === true || this.pendingChatScrollToLatest || chatFeedAnchor?.atBottom;
    const shouldScrollThreadToLatest = options.scrollThreadToLatest === true || this.pendingThreadScrollToLatest || threadRepliesAnchor?.atBottom;

    if (shouldScrollChatToLatest) this.scheduleChatFeedScrollToBottom();
    else if (chatFeedAnchor) {
      this.restoreScrollAnchor(chatFeedAnchor);
      this.updateChatFeedLoadMoreVisibility();
    }

    if (shouldScrollThreadToLatest) this.scheduleThreadRepliesScrollToBottom();
    else if (threadRepliesAnchor) this.restoreScrollAnchor(threadRepliesAnchor);

    this.pendingChatScrollToLatest = false;
    this.pendingThreadScrollToLatest = false;
  },
  applyThreadResponseActivities(activities = []) {
    this.threadResponseActivities = Array.isArray(activities) ? activities : [];
    this.updateResponseActivityTimer();
  },
  applyChannelResponseActivities(activities = []) {
    this.channelResponseActivities = Array.isArray(activities) ? activities : [];
    this.updateResponseActivityTimer();
  },
  updateResponseActivityTimer() {
    const hasActiveActivities = this.activeThreadResponseActivities.length > 0
      || this.getVisibleChannelResponseActivities().length > 0;
    if (!hasActiveActivities) {
      if (this.responseActivityTimer && typeof window !== 'undefined') {
        window.clearInterval(this.responseActivityTimer);
      }
      this.responseActivityTimer = null;
      return;
    }
    if (this.responseActivityTimer || typeof window === 'undefined') return;
    this.responseActivityTimer = window.setInterval(() => {
      this.responseActivityTick = Number(this.responseActivityTick || 0) + 1;
      if (this.activeThreadResponseActivities.length === 0 && this.getVisibleChannelResponseActivities().length === 0) {
        this.updateResponseActivityTimer();
      }
    }, 900);
  },
  getVisibleChannelResponseActivities() {
    const now = Date.now();
    return sortResponseActivities((Array.isArray(this.channelResponseActivities) ? this.channelResponseActivities : [])
      .filter((activity) => isVisibleResponseActivity(activity, now)));
  },
  getResponseActivitiesForThread(threadOrMessage) {
    const ids = new Set();
    if (threadOrMessage && typeof threadOrMessage === 'object') {
      [threadOrMessage.record_id, threadOrMessage.pg_thread_id, threadOrMessage.thread_id].forEach((value) => {
        const id = String(value || '').trim();
        if (id) ids.add(id);
      });
    } else {
      const id = String(threadOrMessage || '').trim();
      if (id) ids.add(id);
      const message = (Array.isArray(this.messages) ? this.messages : [])
        .find((item) => item?.record_id === id || item?.pg_thread_id === id);
      [message?.record_id, message?.pg_thread_id, message?.thread_id].forEach((value) => {
        const resolved = String(value || '').trim();
        if (resolved) ids.add(resolved);
      });
    }
    if (ids.size === 0) return [];
    void this.responseActivityTick;
    return this.getVisibleChannelResponseActivities()
      .filter((activity) => activity.target_type === 'chat_thread' && (
        ids.has(String(activity.target_id || '').trim())
        || ids.has(String(activity.thread_id || '').trim())
      ));
  },
  formatResponseActivityTitle(activity = {}) {
    if (activity.status === 'failed') return activity.label || 'Response failed';
    const senderName = this.getSenderName(activity.actor_npub);
    const status = String(activity.status || '').trim().toLowerCase();
    const statusLabel = status === 'drafting' ? 'Writing' : status;
    const label = activity.label || statusLabel || 'Thinking';
    const tick = Number(this.responseActivityTick || 0);
    const suffix = RESPONSE_ACTIVITY_SUFFIXES[tick % RESPONSE_ACTIVITY_SUFFIXES.length];
    const shouldAnimateWord = !activity.label || ['thinking', 'implementing', 'writing', 'drafting'].includes(String(activity.label).toLowerCase());
    const activityText = shouldAnimateWord
      ? RESPONSE_ACTIVITY_WORDS[Math.floor(tick / RESPONSE_ACTIVITY_SUFFIXES.length) % RESPONSE_ACTIVITY_WORDS.length]
      : String(label);
    return `${senderName} is ${activityText}${suffix}`;
  },

  async refreshMessages(options = {}) {
    const channelId = this.selectedChannelId;
    if (!channelId) {
      if (this.currentWorkspace?.pgBackendMode || this.pgBackendMode) {
        const channelIds = (Array.isArray(this.pgContextChannels) ? this.pgContextChannels : [])
          .map((channel) => channel?.record_id)
          .filter(Boolean);
        const messages = await getMessagesByChannels(channelIds, {
          limit: this.mainFeedVisibleCount || this.MAIN_FEED_PAGE_SIZE,
        });
        if (this.selectedChannelId) return;
        await this.applyMessages(messages, options);
        return;
      }
      await this.applyMessages([], { scrollToLatest: false });
      return;
    }
    const messages = await getMessagesByChannel(channelId);
    if (this.selectedChannelId !== channelId) return;
    await this.applyMessages(messages, options);
  },

  patchMessageLocal(nextMessage) {
    const index = this.messages.findIndex((item) => item.record_id === nextMessage.record_id);
    if (index >= 0) {
      this.messages.splice(index, 1, { ...this.messages[index], ...nextMessage });
      this.syncChatPreviewState();
      this.scheduleChatPreviewMeasurement();
      this.scheduleStorageImageHydration();
      return;
    }
    this.messages = sortMessagesByUpdatedAt([...this.messages, nextMessage]);
    this.syncChatPreviewState();
    this.scheduleChatPreviewMeasurement();
    this.scheduleStorageImageHydration();
  },

  async setMessageSyncStatus(recordId, syncStatus) {
    const message = this.messages.find((item) => item.record_id === recordId)
      ?? await getMessageById(recordId);
    if (!message) return;
    const updated = {
      ...message,
      sync_status: syncStatus,
    };
    await upsertMessage(updated);
    this.patchMessageLocal(updated);
  },

  // --- thread lifecycle ---

  openThread(recordId, options = {}) {
    const message = this.messages.find((item) => item.record_id === recordId) || null;
    if (isTowerPgBackendMode() && message?.channel_id && message.channel_id !== this.selectedChannelId) {
      this.selectPgChannelContext?.(message.channel_id);
    }
    this.activeThreadId = recordId;
    this.threadResponseActivities = [];
    this.threadInput = '';
    this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
    this.pendingThreadScrollToLatest = options.scrollToLatest !== false;
    if (typeof this.startWorkspaceLiveQueries === 'function') this.startWorkspaceLiveQueries();
    if (this.pendingThreadScrollToLatest) this.scheduleThreadRepliesScrollToBottom();
    if (options.syncRoute !== false) this.syncRoute();
  },

  cycleThreadSize() {
    this.threadSize = this.threadSize === 'full' ? 'default' : 'full';
  },

  closeThread(options = {}) {
    this.activeThreadId = null;
    this.threadResponseActivities = [];
    this.threadInput = '';
    this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
    this.threadSize = 'default';
    this.pendingThreadScrollToLatest = false;
    if (typeof this.startWorkspaceLiveQueries === 'function') this.startWorkspaceLiveQueries();
    if (options.syncRoute !== false) this.syncRoute();
  },

  showMoreThreadMessages() {
    const anchor = this.captureScrollAnchor({
      containerSelector: '[data-thread-replies]',
      itemSelector: '[data-thread-message-id]',
      itemAttribute: 'data-thread-message-id',
    });
    this.threadVisibleReplyCount += this.THREAD_REPLY_PAGE_SIZE;
    this.restoreScrollAnchor(anchor);
  },

  showMoreMainFeedMessages() {
    const anchor = this.captureScrollAnchor({
      containerSelector: '[data-chat-feed]',
      itemSelector: '[data-message-id]',
      itemAttribute: 'data-message-id',
    });
    this.mainFeedVisibleCount += this.MAIN_FEED_PAGE_SIZE;
    this.restoreScrollAnchor(anchor);
    this.updateChatFeedLoadMoreVisibility();
  },

  getThreadParentMessage() {
    if (!this.activeThreadId) return null;
    return this.mainFeedMessages.find(msg => msg.record_id === this.activeThreadId)
      ?? this.messages.find(msg => msg.record_id === this.activeThreadId)
      ?? null;
  },

  getThreadReplyCount(recordId) {
    return this.messages.filter(msg => msg.parent_message_id === recordId).length;
  },

  getThreadReplies(recordId) {
    if (!recordId) return [];
    if (recordId === this.activeThreadId) return this.threadMessages;
    return rankThreadReplies(attachTargetAudioNotesToMessages(this.messages, this.audioNotes), recordId);
  },

  getLatestThreadReply(recordId) {
    const replies = this.getThreadReplies(recordId);
    return replies[replies.length - 1] || null;
  },

  getLatestThreadReplyPreview(recordId) {
    const latestReply = this.getLatestThreadReply(recordId);
    if (!latestReply) return '';
    return truncateWords(latestReply.body, THREAD_REPLY_PREVIEW_WORD_LIMIT);
  },

  getThreadReplierAvatars(recordId) {
    const seen = new Set();
    const avatars = [];
    for (const reply of this.getThreadReplies(recordId)) {
      const npub = reply?.sender_npub;
      if (!npub || seen.has(npub)) continue;
      seen.add(npub);
      const name = this.getSenderName?.(npub) || npub;
      avatars.push({
        npub,
        name,
        avatarUrl: this.getSenderAvatar?.(npub) || null,
        initials: this.getInitials?.(name) || '?',
      });
    }
    return avatars;
  },

  // --- chat preview truncation ---

  isChatMessageExpanded(recordId) {
    return hasPreviewId(this.expandedChatMessageIds, recordId);
  },

  isChatMessageTruncated(recordId) {
    return hasPreviewId(this.truncatedChatMessageIds, recordId);
  },

  toggleChatMessageExpanded(recordId) {
    if (!recordId) return;
    this.expandedChatMessageIds = togglePreviewId(this.expandedChatMessageIds, recordId);
    this.scheduleChatPreviewMeasurement();
  },

  syncChatPreviewState() {
    const validIds = new Set(this.visibleMainFeedMessages.map((message) => message.record_id));
    const nextState = prunePreviewState({
      expandedIds: this.expandedChatMessageIds,
      truncatedIds: this.truncatedChatMessageIds,
      validIds,
    });
    this.expandedChatMessageIds = nextState.expandedIds;
    this.truncatedChatMessageIds = nextState.truncatedIds;
  },

  scheduleChatPreviewMeasurement() {
    schedulePreviewMeasurement({
      getFrameId: () => this.chatPreviewMeasureFrame,
      setFrameId: (frameId) => { this.chatPreviewMeasureFrame = frameId; },
      setTruncatedIds: (ids) => { this.truncatedChatMessageIds = ids; },
      selector: '[data-chat-preview-id]',
      idDatasetKey: 'chatPreviewId',
      maxLinesDatasetKey: 'chatPreviewMaxLines',
      defaultMaxLines: this.MESSAGE_PREVIEW_MAX_LINES,
    });
  },

  // --- send / create / delete ---

  async createBotDm(targetNpubInput = null) {
    this.error = null;
    const ownerNpub = this.workspaceOwnerNpub;
    const memberNpub = this.session?.npub;
    const targetNpub = String(targetNpubInput || this.botNpub || '').trim();
    if (!ownerNpub || !memberNpub || !targetNpub) {
      this.error = 'Sign in and set bot npub first';
      return;
    }
    if (!this.backendUrl) {
      this.error = 'Set backend URL first';
      return;
    }
    if (isTowerPgBackendMode()) {
      if (typeof this.ensureTowerPgDmChannel !== 'function') {
        this.error = 'Agent DMs are not available in this workspace view.';
        return;
      }
      try {
        const channel = await this.ensureTowerPgDmChannel(targetNpub);
        if (channel?.record_id) {
          this.channels = [...(this.channels || []).filter((item) => item.record_id !== channel.record_id), channel];
          await this.selectChannel?.(channel.record_id, { syncRoute: false });
          this.scheduleChannelsRefresh?.('PG bot DM open');
        }
      } catch (error) {
        this.error = error?.message || 'Failed to open agent DM';
      }
      return;
    }

    try {
      const existing = findExistingDmChannel(this.channels, [memberNpub, targetNpub]);
      if (existing?.record_id) {
        await this.selectChannel(existing.record_id, { syncRoute: false });
        return;
      }
      const dmScopeId = this.dmScopeId || DM_SCOPE_ID;
      const dmDescription = buildDmChannelDescription([memberNpub, targetNpub]);
      const targetLabel = this.getSenderName?.(targetNpub) || 'bot';
      const name = `DM: ${memberNpub.slice(0, 12)}… + ${targetLabel}`;
      const group = await this.createEncryptedGroup(name, [targetNpub]);
      const groupId = group.group_id;
      await this.rememberPeople([memberNpub, targetNpub], 'chat');

      const channelId = crypto.randomUUID();
      const channelRow = {
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        description: dmDescription,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        channel_type: 'dm',
        scope_id: dmScopeId,
        scope_l1_id: dmScopeId,
        record_state: 'active',
        version: 1,
        updated_at: new Date().toISOString(),
      };

      await upsertChannel(channelRow);

      const envelope = await outboundChannel({
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        description: dmDescription,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        channel_type: 'dm',
        scope_id: dmScopeId,
        scope_l1_id: dmScopeId,
        record_state: 'active',
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
      await this.selectChannel(channelId, { syncRoute: false });
    } catch (e) {
      this.error = e.message;
    }
  },

  async deleteSelectedChannel() {
    this.error = null;
    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Select a channel first';
      return;
    }
    if (isTowerPgBackendMode()) {
      if (!this.channelDeleteConfirmArmed) {
        this.channelDeleteConfirmArmed = true;
        return;
      }
      try {
        const fallbackNextChannelId = this.channels.find((item) => item.record_id !== channel.record_id)?.record_id ?? null;
        const { workspaceId, baseUrl, appNpub } = resolveTowerPgWorkspaceContext(this);
        if (!workspaceId || !baseUrl) throw new Error('Flight Deck PG workspace is not connected');
        await deleteTowerPgChannel(workspaceId, channel.record_id, { baseUrl, appNpub });
        this.showChannelSettingsModal = false;
        await deleteChannelRuntimeState(channel.record_id);
        this.channels = this.channels.filter((item) => item.record_id !== channel.record_id);
        this.selectedChannelId = fallbackNextChannelId;
        this.closeThread();
        this.scheduleChannelsRefresh?.('PG channel delete');
        this.selectedChannelId = this.selectedChannelId ?? this.channels[0]?.record_id ?? null;
        Promise.resolve()
          .then(() => this.refreshMessages({ scrollToLatest: true }))
          .catch((refreshError) => {
            console.warn('[flightdeck] PG message refresh failed after channel delete', refreshError);
          });
        this.channelDeleteConfirmArmed = false;
      } catch (error) {
        this.channelDeleteConfirmArmed = false;
        this.error = error?.message || 'Failed to delete channel';
      }
      return;
    }

    if (!this.channelDeleteConfirmArmed) {
      this.channelDeleteConfirmArmed = true;
      return;
    }

    try {
      const now = new Date().toISOString();
      const fallbackNextChannelId = this.channels.find((item) => item.record_id !== channel.record_id)?.record_id ?? null;
      const ownerNpub = channel.owner_npub || this.workspaceOwnerNpub;
      let latestTowerVersion = 0;
      this.showChannelSettingsModal = false;

      if (channel.record_id && ownerNpub && this.workspaceOwnerNpub && this.session?.npub && this.backendUrl) {
        const result = await fetchRecordHistory({
          record_id: channel.record_id,
          owner_npub: this.workspaceOwnerNpub,
          viewer_npub: this.session.npub,
        });
        latestTowerVersion = (Array.isArray(result?.versions) ? result.versions : []).reduce((latest, current) => {
          const version = Number(current?.version ?? 0) || 0;
          return version > latest ? version : latest;
        }, 0);
      }

      if (latestTowerVersion > 0) {
        const nextVersion = latestTowerVersion + 1;
        await upsertChannel({
          ...channel,
          record_state: 'deleted',
          version: nextVersion,
          updated_at: now,
        });

        const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
          label: 'Channel write',
        });
        const envelope = await outboundChannel({
          record_id: channel.record_id,
          owner_npub: ownerNpub,
          title: channel.title,
          group_ids: channelWriteFields.group_ids,
          participant_npubs: channel.participant_npubs ?? [],
          version: nextVersion,
          previous_version: latestTowerVersion,
          record_state: 'deleted',
          signature_npub: this.signingNpub,
          write_group_ref: channelWriteFields.write_group_ref,
        });

        await addPendingWrite({
          record_id: channel.record_id,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });
      } else {
        await deleteChannelRuntimeState(channel.record_id);
      }

      this.channels = this.channels.filter((item) => item.record_id !== channel.record_id);
      this.selectedChannelId = fallbackNextChannelId;
      this.closeThread();
      await this.refreshMessages({ scrollToLatest: true });

      if (latestTowerVersion > 0) {
        await this.flushAndBackgroundSync();
      }
      await this.refreshChannels();
      this.selectedChannelId = this.selectedChannelId ?? this.channels[0]?.record_id ?? null;
      await this.refreshMessages({ scrollToLatest: true });
      this.channelDeleteConfirmArmed = false;
    } catch (error) {
      this.channelDeleteConfirmArmed = false;
      this.error = error?.message || 'Failed to delete channel';
    }
  },

  async sendMessage() {
    this.error = null;
    const pgMode = isTowerPgBackendMode();
    const drafts = [...this.messageAudioDrafts];
    if (this.messageImageUploadCount > 0 || this.containsInlineImageUploadToken(this.messageInput)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if (!this.messageInput.trim() && drafts.length === 0) return;
    if (!this.selectedChannelId) {
      if (pgMode) {
        return this.openWriteContextModal?.('message', { options: {} }) || null;
      }
      this.error = 'Select a channel first';
      return;
    }
    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Channel not found';
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const body = this.messageInput.trim();
    if (pgMode && !(await ensureTowerPgAgentDmAccess(this, channel))) return;

    let channelWriteFields = null;
    let attachments = [];
    if (!pgMode) {
      channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
        label: 'Chat message write',
      });
      ({ attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: msgId,
        target_record_family_hash: recordFamilyHash('chat_message'),
        target_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
      }));
    }
    const localRow = {
      record_id: msgId,
      channel_id: this.selectedChannelId,
      parent_message_id: null,
      body,
      attachments,
      sender_npub: this.session?.npub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
      ...(pgMode ? { pg_backend: true } : {}),
    };

    await upsertMessage(localRow);
    this.patchMessageLocal(localRow);
    this.scheduleChatFeedScrollToBottom();
    this.messageInput = '';
    this.messageAudioDrafts = [];
    this.scheduleComposerAutosize('message');

    if (pgMode) {
      try {
        const accepted = await createTowerPgMessageFromLocal(this, localRow);
        await replaceMessageRecord(localRow.record_id, accepted);
        this.messages = this.messages.filter((message) => message.record_id !== localRow.record_id);
        this.patchMessageLocal(accepted);
        if (drafts.length > 0) {
          try {
            const { attachments: pgAudioAttachments } = await this.materializeAudioDrafts({
              drafts,
              target_record_id: accepted.record_id,
              target_record_family_hash: recordFamilyHash('chat_message'),
              scopeId: accepted.pg_scope_id,
              channelId: accepted.channel_id,
              threadId: accepted.pg_thread_id,
            });
            if (pgAudioAttachments.length > 0) {
              const existingAttachments = Array.isArray(accepted.attachments) ? accepted.attachments : [];
              const acceptedWithAudio = {
                ...accepted,
                attachments: [...existingAttachments, ...pgAudioAttachments],
              };
              await upsertMessage(acceptedWithAudio);
              this.messages = this.messages.filter((message) => message.record_id !== accepted.record_id);
              this.patchMessageLocal(acceptedWithAudio);
            }
          } catch (audioError) {
            this.messageAudioDrafts = drafts;
            this.error = `Message sent, but failed to attach voice note: ${audioError?.message || 'Failed to sync PG audio note'}`;
          }
        }
        this.scheduleChatFeedScrollToBottom();
        Promise.resolve()
          .then(() => this.refreshMessages({ scrollToLatest: true }))
          .catch((refreshError) => {
            console.warn('[flightdeck] PG message refresh failed after send', refreshError);
          });
      } catch (error) {
        await this.setMessageSyncStatus(msgId, 'failed');
        this.error = error?.message || 'Failed to sync PG message';
      }
      return;
    }

    try {
      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: null,
        body,
        attachments,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        signature_npub: this.signingNpub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      await this.flushAndBackgroundSync();
    } catch (error) {
      await this.setMessageSyncStatus(msgId, 'failed');
      this.error = error?.message || 'Failed to sync message';
    }
  },

  async sendThreadReply() {
    this.error = null;
    const drafts = [...this.threadAudioDrafts];
    if (this.threadImageUploadCount > 0 || this.containsInlineImageUploadToken(this.threadInput)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if (!this.threadInput.trim() && drafts.length === 0) return;
    if (!this.activeThreadId || !this.selectedChannelId) {
      this.error = 'Open a thread first';
      return;
    }
    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Channel not found';
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const body = this.threadInput.trim();
    const pgMode = isTowerPgBackendMode();
    if (pgMode && !(await ensureTowerPgAgentDmAccess(this, channel))) return;

    let channelWriteFields = null;
    let attachments = [];
    if (!pgMode) {
      channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
        label: 'Chat reply write',
      });
      ({ attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: msgId,
        target_record_family_hash: recordFamilyHash('chat_message'),
        target_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
      }));
    }
    const localRow = {
      record_id: msgId,
      channel_id: this.selectedChannelId,
      parent_message_id: this.activeThreadId,
      body,
      attachments,
      sender_npub: this.session?.npub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
      ...(pgMode ? { pg_backend: true } : {}),
    };
    await upsertMessage(localRow);
    this.patchMessageLocal(localRow);
    this.scheduleThreadRepliesScrollToBottom();
    this.threadInput = '';
    this.threadAudioDrafts = [];
    this.scheduleComposerAutosize('thread');

    if (pgMode) {
      try {
        const parentMessage = this.getThreadParentMessage();
        const accepted = await createTowerPgMessageFromLocal(this, localRow, { parentMessage });
        await replaceMessageRecord(localRow.record_id, accepted);
        this.messages = this.messages.filter((message) => message.record_id !== localRow.record_id);
        this.patchMessageLocal(accepted);
        if (drafts.length > 0) {
          try {
            const { attachments: pgAudioAttachments } = await this.materializeAudioDrafts({
              drafts,
              target_record_id: accepted.record_id,
              target_record_family_hash: recordFamilyHash('chat_message'),
              scopeId: accepted.pg_scope_id,
              channelId: accepted.channel_id,
              threadId: accepted.pg_thread_id,
            });
            if (pgAudioAttachments.length > 0) {
              const existingAttachments = Array.isArray(accepted.attachments) ? accepted.attachments : [];
              const acceptedWithAudio = {
                ...accepted,
                attachments: [...existingAttachments, ...pgAudioAttachments],
              };
              await upsertMessage(acceptedWithAudio);
              this.messages = this.messages.filter((message) => message.record_id !== accepted.record_id);
              this.patchMessageLocal(acceptedWithAudio);
            }
          } catch (audioError) {
            this.threadAudioDrafts = drafts;
            this.error = `Reply sent, but failed to attach voice note: ${audioError?.message || 'Failed to sync PG audio note'}`;
          }
        }
        this.scheduleThreadRepliesScrollToBottom();
        Promise.resolve()
          .then(() => this.refreshMessages({ scrollThreadToLatest: true }))
          .catch((refreshError) => {
            console.warn('[flightdeck] PG reply refresh failed after send', refreshError);
          });
      } catch (error) {
        await this.setMessageSyncStatus(msgId, 'failed');
        this.error = error?.message || 'Failed to sync PG reply';
      }
      return;
    }

    try {
      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: this.activeThreadId,
        body,
        attachments,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        signature_npub: this.signingNpub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      await this.flushAndBackgroundSync();
    } catch (error) {
      await this.setMessageSyncStatus(msgId, 'failed');
      this.error = error?.message || 'Failed to sync reply';
    }
  },

  // --- message actions menu ---

  openMessageActionsMenu(recordId) {
    this.messageActionsMenuId = recordId;
  },

  closeMessageActionsMenu() {
    this.messageActionsMenuId = null;
  },

  isMessageActionsMenuOpen(recordId) {
    return this.messageActionsMenuId === recordId;
  },

  toggleMessageActionsMenu(recordId) {
    if (this.messageActionsMenuId === recordId) {
      this.messageActionsMenuId = null;
    } else {
      this.messageActionsMenuId = recordId;
    }
  },

  isChatThreadArchived(recordId) {
    const message = this.getChatMessageById(recordId);
    return String(message?.record_state || 'active') === 'archived';
  },

  toggleShowArchivedChatThreads() {
    this.showArchivedChatThreads = !this.showArchivedChatThreads;
    this.scheduleChatPreviewMeasurement();
  },

  isChatThreadArchiveSubmitting(recordId, action = '') {
    const id = String(recordId || '').trim();
    if (!id || this.chatThreadArchiveSubmittingId !== id) return false;
    return !action || this.chatThreadArchiveSubmittingAction === action;
  },

  getChatMessageById(recordId) {
    const id = String(recordId || '').trim();
    if (!id) return null;
    return this.messages.find((message) => message.record_id === id) || null;
  },

  resolveFlightDeckReferenceLabel(type, recordId, fallback = '') {
    const linkType = normalizeRecordLinkType(type);
    const id = String(recordId || '').trim();
    const directLabel = String(fallback || '').trim();
    if (directLabel) return directLabel;
    if (!id) return 'Record';
    if (linkType === 'doc') {
      const doc = (this.documents || []).find((item) => item?.record_id === id);
      return doc?.title || this.docEditorTitle || 'Untitled document';
    }
    if (linkType === 'directory') {
      const directory = (this.directories || []).find((item) => item?.record_id === id);
      return directory?.title || 'Untitled folder';
    }
    if (linkType === 'task') {
      const task = (this.tasks || []).find((item) => item?.record_id === id);
      return task?.title || this.editingTask?.title || 'Untitled task';
    }
    if (linkType === 'scope') {
      const scope = this.scopesMap?.get?.(id) || (this.scopes || []).find((item) => item?.record_id === id);
      return scope?.title || 'Untitled scope';
    }
    if (linkType === 'channel') {
      const channel = (this.channels || []).find((item) => item?.record_id === id);
      return (channel && this.getChannelLabel?.(channel)) || channel?.title || channel?.name || 'Channel';
    }
    if (linkType === 'report') {
      const report = (this.reports || []).find((item) => item?.record_id === id)
        || (this.reportModalReport?.record_id === id ? this.reportModalReport : null)
        || (this.selectedReport?.record_id === id ? this.selectedReport : null);
      return report?.title || 'Untitled report';
    }
    if (linkType === 'flow') {
      const flow = (this.flows || []).find((item) => item?.record_id === id);
      return flow?.title || 'Untitled flow';
    }
    if (linkType === 'opportunity') {
      const opportunity = (this.opportunities || []).find((item) => item?.record_id === id);
      return opportunity?.title || 'Untitled opportunity';
    }
    if (linkType === 'person') return this.getSenderName?.(id) || id;
    if (linkType === 'chat') {
      const messageId = id.includes('#') ? id.slice(id.indexOf('#') + 1) : id;
      const message = this.getChatMessageById?.(messageId);
      const firstLine = String(message?.body || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (firstLine) return firstLine.slice(0, 80);
      const channelId = id.includes('#') ? id.slice(0, id.indexOf('#')) : message?.channel_id;
      const channel = (this.channels || []).find((item) => item?.record_id === channelId);
      const channelLabel = channel ? this.getChannelLabel?.(channel) || channel.title || channel.name : '';
      return channelLabel ? `${channelLabel} message` : 'Chat message';
    }
    return id.slice(0, 8);
  },

  buildFlightDeckReference(type, recordId, label = '') {
    return buildFlightDeckReference({
      type,
      id: recordId,
      label: this.resolveFlightDeckReferenceLabel(type, recordId, label),
    });
  },

  async copyFlightDeckReference(type, recordId, label = '') {
    this.error = null;
    const reference = this.buildFlightDeckReference(type, recordId, label);
    if (!reference) {
      this.error = 'Could not build Flight Deck reference.';
      return;
    }
    try {
      await this.copyTextToClipboard(reference);
      const key = `${normalizeRecordLinkType(type)}:${String(recordId || '').trim()}`;
      this.copiedFlightDeckRefKey = key;
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (this.copiedFlightDeckRefKey === key) this.copiedFlightDeckRefKey = null;
        }, 1800);
      }
    } catch (error) {
      this.error = error?.message || 'Failed to copy Flight Deck reference.';
    }
  },

  buildChatMessageFlightDeckReferenceId(recordId) {
    const message = this.getChatMessageById(recordId);
    const messageId = String(message?.record_id || recordId || '').trim();
    const channelId = String(message?.channel_id || this.selectedChannelId || '').trim();
    return channelId && messageId ? `${channelId}#${messageId}` : messageId;
  },

  async copyTextToClipboard(text) {
    const value = String(text ?? '');
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    if (typeof document === 'undefined') return;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand?.('copy');
    textarea.remove();
  },

  async copyMessageRawText(recordId) {
    this.error = null;
    const message = this.getChatMessageById(recordId);
    if (!message) {
      this.error = 'Message not found';
      return;
    }
    try {
      await this.copyTextToClipboard(message.body || '');
      this.closeMessageActionsMenu();
    } catch (error) {
      this.error = error?.message || 'Failed to copy message text.';
    }
  },

  buildThreadRawText(recordId) {
    const parent = this.getChatMessageById(recordId);
    if (!parent) return '';
    const messages = [parent, ...this.getThreadReplies(parent.record_id)]
      .filter((message) => String(message?.record_state || 'active') !== 'deleted');
    return messages.map((message) => {
      const sender = this.getSenderName?.(message.sender_npub) || message.sender_npub || 'Unknown';
      const timestamp = message.updated_at || message.created_at || '';
      const body = message.body || '';
      return `[${timestamp}] ${sender}\n${body}`;
    }).join('\n\n');
  },

  async copyThreadRawText(recordId) {
    this.error = null;
    const raw = this.buildThreadRawText(recordId);
    if (!raw) {
      this.error = 'Thread not found';
      return;
    }
    try {
      await this.copyTextToClipboard(raw);
      this.closeMessageActionsMenu();
    } catch (error) {
      this.error = error?.message || 'Failed to copy thread text.';
    }
  },

  openChatDeleteConfirm(mode, recordId) {
    const targetMode = mode === 'thread' ? 'thread' : 'message';
    const message = this.getChatMessageById(recordId);
    if (!message) {
      this.error = targetMode === 'thread' ? 'Thread not found' : 'Message not found';
      return;
    }
    this.closeMessageActionsMenu();
    this.chatDeleteConfirm = {
      open: true,
      mode: targetMode,
      recordId: message.record_id,
      title: targetMode === 'thread' ? 'Delete Thread' : 'Delete Message',
      message: targetMode === 'thread'
        ? 'Delete this thread and all replies? This cannot be undone.'
        : 'Delete this message? This cannot be undone.',
      submitting: false,
      error: '',
    };
  },

  closeChatDeleteConfirm() {
    this.chatDeleteConfirm = {
      open: false,
      mode: '',
      recordId: '',
      title: '',
      message: '',
      submitting: false,
      error: '',
    };
  },

  async confirmChatDelete() {
    const state = this.chatDeleteConfirm || {};
    if (!state.open || !state.recordId) return;
    this.chatDeleteConfirm = { ...state, submitting: true, error: '' };
    try {
      if (state.mode === 'thread') {
        await this.deleteChatThreadByParentId(state.recordId);
      } else {
        await this.deleteChatMessageById(state.recordId);
      }
      this.closeChatDeleteConfirm();
    } catch (error) {
      this.chatDeleteConfirm = {
        ...this.chatDeleteConfirm,
        submitting: false,
        error: error?.message || 'Delete failed.',
      };
      this.error = this.chatDeleteConfirm.error;
    }
  },

  async openChatThreadFlowDispatch(recordId, sourceSurface = 'main_feed') {
    this.error = null;
    console.info('Chat thread flow dispatch requested:', {
      recordId,
      sourceSurface,
      selectedChannelId: this.selectedChannelId,
    });
    this.closeMessageActionsMenu();
    Object.assign(this, createChatThreadFlowDispatchState());
    this.showChatThreadFlowDispatchModal = true;
    this.chatThreadFlowDispatchOpenedAt = Date.now();
    this.chatThreadFlowDispatchLoading = true;

    try {
      const resolved = this.resolveDispatchThread(recordId);
      if (!resolved) {
        throw new Error('Unable to resolve the selected chat thread.');
      }
      const sourceChannel = resolved.sourceChannel || this.selectedChannel;
      if (!sourceChannel?.record_id) {
        throw new Error('Unable to resolve the source channel for this thread.');
      }

      this.chatThreadFlowDispatchSource = {
        channelId: sourceChannel.record_id,
        clickedMessageId: resolved.clickedMessage.record_id,
        threadRootMessageId: resolved.threadRootMessage.record_id,
        sourceSurface,
        dispatchedAt: new Date().toISOString(),
      };
      this.chatThreadFlowDispatchMessages = resolved.threadMessages;
      this.chatThreadFlowDispatchError = null;
      this.syncChatThreadFlowDispatchScopeResolution();
    } catch (error) {
      console.error('Chat thread flow dispatch init failed:', {
        error,
        recordId,
        sourceSurface,
        selectedChannelId: this.selectedChannelId,
      });
      this.chatThreadFlowDispatchError = error?.message || 'Unable to prepare chat thread dispatch.';
      this.error = this.chatThreadFlowDispatchError;
    } finally {
      this.chatThreadFlowDispatchLoading = false;
    }
  },

  resolveChatGetItDoneDefaultScope(resolved = null) {
    const channelScopeId = resolved?.sourceChannel?.scope_id
      || this.selectedChannel?.scope_id
      || null;
    if (channelScopeId) return channelScopeId;
    const selectedBoardId = String(this.selectedBoardId || '').trim();
    if (selectedBoardId && selectedBoardId !== UNSCOPED_TASK_BOARD_ID && selectedBoardId !== '__all__') {
      return selectedBoardId;
    }
    return null;
  },

  resolveChatGetItDoneDefaultAssignee(resolved = null) {
    const viewer = String(this.session?.npub || '').trim();
    const channel = resolved?.sourceChannel || this.selectedChannel || null;
    const participants = (Array.isArray(channel?.participant_npubs) ? channel.participant_npubs : [])
      .map((npub) => String(npub || '').trim())
      .filter(Boolean);
    const otherParticipants = participants.filter((npub) => npub !== viewer);
    if (otherParticipants.length === 1) return otherParticipants[0];

    const threadMessages = Array.isArray(resolved?.threadMessages) ? resolved.threadMessages : [];
    const latestOtherSender = [...threadMessages]
      .reverse()
      .map((message) => String(message?.sender_npub || '').trim())
      .find((npub) => npub && npub !== viewer);
    if (latestOtherSender) return latestOtherSender;

    return String(this.defaultAgentNpub || this.botNpub || '').trim() || null;
  },

  buildChatGetItDoneSourceUrl(source = this.chatGetItDoneSource) {
    if (!source?.channelId) return '';
    const currentRoute = typeof window !== 'undefined'
      ? parseRouteLocation(window.location.href)
      : { workspaceSlug: this.currentWorkspaceSlug || null, params: {} };
    return buildSectionUrl({
      workspaceSlug: this.currentWorkspaceSlug || currentRoute.workspaceSlug || null,
      section: 'chat',
      scopeid: this.selectedBoardId || null,
      params: {
        workspacekey: this.currentWorkspaceKey || currentRoute.params?.workspacekey || null,
        channelid: source.channelId,
        threadid: source.threadRootMessageId,
      },
    });
  },

  async openChatGetItDone(recordId, sourceSurface = 'main_feed') {
    this.error = null;
    this.closeMessageActionsMenu();
    Object.assign(this, createChatGetItDoneState());
    this.showChatGetItDoneModal = true;
    this.chatGetItDoneOpenedAt = Date.now();

    try {
      const resolved = this.resolveDispatchThread(recordId);
      if (!resolved) {
        throw new Error('Unable to resolve the selected chat thread.');
      }
      const sourceChannel = resolved.sourceChannel || this.selectedChannel;
      if (!sourceChannel?.record_id) {
        throw new Error('Unable to resolve the source channel for this thread.');
      }

      this.chatGetItDoneSource = {
        channelId: sourceChannel.record_id,
        clickedMessageId: resolved.clickedMessage.record_id,
        threadRootMessageId: resolved.threadRootMessage.record_id,
        pgThreadId: resolved.threadRootMessage.pg_thread_id || resolved.clickedMessage.pg_thread_id || null,
        sourceSurface,
        createdAt: new Date().toISOString(),
      };
      this.chatGetItDoneMessages = resolved.threadMessages;
      this.chatGetItDoneScopeId = this.resolveChatGetItDoneDefaultScope(resolved);
      this.chatGetItDoneAssigneeNpub = this.resolveChatGetItDoneDefaultAssignee(resolved);
      this.chatGetItDoneTitle = '';
      this.chatGetItDoneOutputType = 'chat_response';
      this.chatGetItDoneInstructions = '';
      this.chatGetItDoneError = null;
    } catch (error) {
      this.chatGetItDoneError = error?.message || 'Unable to prepare this chat thread.';
      this.error = this.chatGetItDoneError;
    }
  },

  closeChatGetItDone() {
    Object.assign(this, createChatGetItDoneState());
  },

  handleChatGetItDoneOverlayClick() {
    const openedAt = Number(this.chatGetItDoneOpenedAt || 0);
    if (openedAt > 0 && (Date.now() - openedAt) < 250) return;
    this.closeChatGetItDone();
  },

  openChatGetItDoneAssigneePicker() {
    this.showChatGetItDoneAssigneePicker = true;
  },

  closeChatGetItDoneAssigneePicker() {
    this.showChatGetItDoneAssigneePicker = false;
    this.chatGetItDoneAssigneeQuery = '';
  },

  handleChatGetItDoneAssigneeInput(value) {
    this.chatGetItDoneAssigneeQuery = value;
    this.showChatGetItDoneAssigneePicker = true;
    if (String(value || '').startsWith('npub1') && String(value || '').length >= 20) {
      this.resolveChatProfile?.(value);
    }
  },

  async selectChatGetItDoneAssignee(npub) {
    const nextNpub = String(npub || '').trim();
    this.chatGetItDoneAssigneeNpub = nextNpub || null;
    this.chatGetItDoneAssigneeQuery = '';
    this.showChatGetItDoneAssigneePicker = false;
    if (nextNpub) {
      await this.rememberPeople?.([nextNpub], 'task-assignee');
    }
  },

  async clearChatGetItDoneAssignee() {
    await this.selectChatGetItDoneAssignee(null);
  },

  openChatGetItDoneScopePicker() {
    this.showChatGetItDoneScopePicker = true;
  },

  closeChatGetItDoneScopePicker() {
    this.showChatGetItDoneScopePicker = false;
    this.chatGetItDoneScopeQuery = '';
  },

  handleChatGetItDoneScopeInput(value) {
    this.chatGetItDoneScopeQuery = value;
    this.showChatGetItDoneScopePicker = true;
  },

  selectChatGetItDoneScope(scopeId) {
    const nextScopeId = String(scopeId || '').trim();
    this.chatGetItDoneScopeId = nextScopeId || null;
    this.chatGetItDoneScopeQuery = '';
    this.showChatGetItDoneScopePicker = false;
  },

  clearChatGetItDoneScope() {
    this.selectChatGetItDoneScope(null);
  },

  async submitChatGetItDone() {
    this.error = null;
    this.chatGetItDoneError = null;
    if (!this.chatGetItDoneCanSubmit) {
      this.chatGetItDoneError = 'Add a short task title before creating the task.';
      this.error = this.chatGetItDoneError;
      return null;
    }

    const source = this.chatGetItDoneSource;
    const sourceLink = { type: 'chat', id: `${source.channelId}#${source.threadRootMessageId}` };
    const sourceLinks = [sourceLink];
    const deliverableLinks = [];
    const selectedScopeId = this.chatGetItDoneScopeId || this.resolveChatGetItDoneDefaultScope();
    const taskScopeId = selectedScopeId || UNSCOPED_TASK_BOARD_ID;
    const hasScopedDocTarget = Boolean(selectedScopeId && this.scopesMap?.has?.(selectedScopeId));
    const pgThreadId = isTowerPgBackendMode()
      ? (source.pgThreadId || resolvePgThreadId(this, source.threadRootMessageId))
      : null;
    this.chatGetItDoneSubmitting = true;
    try {
      if (this.chatGetItDoneOutputType === 'doc' && hasScopedDocTarget && typeof this.createDocument === 'function') {
        const doc = await this.createDocument(this.chatGetItDoneTitle, {
          scopeId: selectedScopeId,
          sourceLinks,
          ...(isTowerPgBackendMode() ? { channelId: source.channelId, threadId: pgThreadId } : {}),
        });
        if (doc?.record_id) deliverableLinks.push({ type: 'doc', id: doc.record_id, order: 1 });
      }

      const description = buildChatGetItDoneTaskDescription({
        prompt: this.chatGetItDoneTitle,
        outputType: this.chatGetItDoneOutputType,
        extraInstructions: this.chatGetItDoneInstructions,
        sourceUrl: this.buildChatGetItDoneSourceUrl(source),
        messages: this.chatGetItDoneMessages,
        senderLabelResolver: (message) => this.getSenderName?.(message?.sender_npub) || message?.sender_npub || 'Unknown sender',
      });

      this.newTaskTitle = String(this.chatGetItDoneTitle || '').trim();
      const createdTask = await this.addTask?.({
        description,
        state: 'ready',
        scopeId: taskScopeId,
        ...(isTowerPgBackendMode() ? { channelId: source.channelId, threadId: pgThreadId } : {}),
        assignedToNpub: this.chatGetItDoneAssigneeNpub || null,
        sourceLinks,
        deliverableLinks,
      });
      if (!createdTask?.record_id) {
        throw new Error(this.error || 'Failed to create the ready task from this chat thread.');
      }
      this.closeChatGetItDone();
      this.navigateTo?.('tasks', { syncRoute: false });
      this.openTaskDetail?.(createdTask.record_id);
      this.syncRoute?.();
      return createdTask;
    } catch (error) {
      this.chatGetItDoneError = error?.message || 'Failed to create the ready task from this chat thread.';
      this.error = this.chatGetItDoneError;
      return null;
    } finally {
      this.chatGetItDoneSubmitting = false;
    }
  },

  closeChatThreadFlowDispatch() {
    Object.assign(this, createChatThreadFlowDispatchState());
  },

  handleChatThreadFlowDispatchOverlayClick() {
    const openedAt = Number(this.chatThreadFlowDispatchOpenedAt || 0);
    if (openedAt > 0 && (Date.now() - openedAt) < 250) {
      return;
    }
    this.closeChatThreadFlowDispatch();
  },

  resolveDispatchThread(recordId) {
    const resolved = resolveChatThreadFlowDispatchThread(this.messages, recordId);
    if (!resolved) return null;
    return {
      ...resolved,
      sourceChannel: this.channels.find((channel) => channel.record_id === resolved.clickedMessage.channel_id) || this.selectedChannel || null,
    };
  },

  syncChatThreadFlowDispatchScopeResolution() {
    const flow = this.chatThreadFlowDispatchSelectedFlow;
    const sourceChannel = this.chatThreadFlowDispatchSourceChannel;
    const flowScopeId = flow?.scope_id ?? null;
    const channelScopeId = sourceChannel?.scope_id ?? null;
    const { resolvedScopeId, scopeSource } = resolveChatThreadFlowDispatchScope({
      manualScopeId: this.chatThreadFlowDispatchManualScopeId,
      flowScopeId,
      channelScopeId,
    });

    let assignment = null;
    if (scopeSource === 'flow') {
      assignment = buildStoredFlowKickoffScopeAssignment(flow);
    } else if (scopeSource === 'override' || scopeSource === 'channel') {
      assignment = normalizeChatThreadFlowDispatchScopeAssignment(
        this.buildTaskBoardAssignment(resolvedScopeId, null),
      );
    } else {
      assignment = normalizeChatThreadFlowDispatchScopeAssignment(
        this.buildTaskBoardAssignment(UNSCOPED_TASK_BOARD_ID, null),
      );
    }

    this.chatThreadFlowDispatchResolvedScopeId = resolvedScopeId;
    this.chatThreadFlowDispatchScopeSource = scopeSource;
    this.chatThreadFlowDispatchResolvedScopeAssignment = assignment;
    return assignment;
  },

  handleChatThreadFlowDispatchInputsChanged() {
    this.syncChatThreadFlowDispatchScopeResolution();
    if (this.chatThreadFlowDispatchDirty) {
      this.chatThreadFlowDispatchPreviewStale = true;
      return;
    }
    this.regenerateChatThreadFlowDispatchPreview();
  },

  regenerateChatThreadFlowDispatchPreview() {
    const source = this.chatThreadFlowDispatchSource;
    const flow = this.chatThreadFlowDispatchSelectedFlow;
    this.syncChatThreadFlowDispatchScopeResolution();

    if (!source?.channelId || !flow?.record_id || this.chatThreadFlowDispatchMessages.length === 0) {
      this.chatThreadFlowDispatchPreview = '';
      this.chatThreadFlowDispatchDirty = false;
      this.chatThreadFlowDispatchPreviewStale = false;
      return '';
    }

    const preview = buildChatThreadFlowDispatchPreview({
      channelId: source.channelId,
      channelScopeId: this.chatThreadFlowDispatchSourceChannel?.scope_id ?? null,
      clickedMessageId: source.clickedMessageId,
      dispatchedAt: source.dispatchedAt || new Date().toISOString(),
      flowId: flow.record_id,
      flowScopeId: flow.scope_id ?? null,
      flowTitle: flow.title || 'Untitled flow',
      launchNotes: this.chatThreadFlowDispatchLaunchNotes,
      messages: this.chatThreadFlowDispatchMessages,
      resolvedScopeId: this.chatThreadFlowDispatchResolvedScopeId,
      scopeSource: this.chatThreadFlowDispatchScopeSource,
      senderLabelResolver: (message) => this.getSenderName?.(message?.sender_npub) || message?.sender_npub || 'Unknown sender',
      sourceSurface: source.sourceSurface || 'main_feed',
      threadRootMessageId: source.threadRootMessageId,
      workspaceOwnerNpub: this.workspaceOwnerNpub,
    }).description;

    this.chatThreadFlowDispatchPreview = preview;
    this.chatThreadFlowDispatchDirty = false;
    this.chatThreadFlowDispatchPreviewStale = false;
    return preview;
  },

  markChatThreadFlowDispatchPreviewEdited() {
    this.chatThreadFlowDispatchDirty = true;
  },

  async submitChatThreadFlowDispatch() {
    this.error = null;
    this.chatThreadFlowDispatchError = null;
    if (!this.chatThreadFlowDispatchCanSubmit) {
      this.chatThreadFlowDispatchError = 'Select a flow and confirm the preview before dispatching.';
      this.error = this.chatThreadFlowDispatchError;
      return null;
    }

    const source = this.chatThreadFlowDispatchSource;
    this.chatThreadFlowDispatchSubmitting = true;
    try {
      // Flow dispatch was removed from Flight Deck (flows feature removal).
      const result = null;
      if (!result) {
        throw new Error('Flow dispatch is no longer available.');
      }
      this.closeChatThreadFlowDispatch();
      return result;
    } catch (error) {
      console.error('Chat thread flow dispatch submit failed:', {
        error,
        flowId: this.chatThreadFlowDispatchSelectedFlowId,
        source,
      });
      this.chatThreadFlowDispatchError = error?.message || 'Failed to create the kickoff task for this flow dispatch.';
      this.error = this.chatThreadFlowDispatchError;
      return null;
    } finally {
      this.chatThreadFlowDispatchSubmitting = false;
    }
  },

  inspectMessageSyncStatus(recordId) {
    const message = this.messages.find((m) => m.record_id === recordId);
    const body = message?.body || '';
    const label = body.length > 50 ? body.slice(0, 50) + '...' : (body || 'Chat message');
    this.messageActionsMenuId = null;
    this.openRecordStatusModal({
      familyId: 'chat_message',
      recordId,
      label,
    });
  },

  async deleteActiveThread() {
    this.error = null;
    const parent = this.getThreadParentMessage();
    if (!parent || !this.selectedChannelId) {
      this.error = 'Open a thread first';
      return;
    }
    this.openChatDeleteConfirm('thread', parent.record_id);
  },

  async deleteChatMessageById(recordId) {
    this.error = null;
    const message = this.getChatMessageById(recordId);
    if (!message) throw new Error('Message not found');
    if (isTowerPgBackendMode() && message.pg_backend) {
      const accepted = await deleteTowerPgMessageFromLocal(this, message);
      await upsertMessage(accepted);
      this.messages = this.messages
        .filter((candidate) => candidate.record_id !== message.record_id && candidate.record_id !== accepted.record_id)
        .concat(accepted);
      if (this.activeThreadId === message.record_id) this.closeThread({ syncRoute: false });
      return;
    }
    await this.softDeleteChatMessages([message], 'Chat message delete');
    if (this.activeThreadId === message.record_id) this.closeThread({ syncRoute: false });
  },

  async deleteChatThreadByParentId(recordId) {
    this.error = null;
    const parent = this.getChatMessageById(recordId);
    if (!parent) throw new Error('Thread not found');
    const threadMessages = [parent, ...this.getThreadReplies(parent.record_id)];
    if (isTowerPgBackendMode() && parent.pg_backend) {
      await deleteTowerPgThreadFromLocal(this, parent);
      const now = new Date().toISOString();
      for (const message of threadMessages) {
        await upsertMessage({
          ...message,
          record_state: 'deleted',
          sync_status: 'synced',
          version: (message.version ?? 1) + 1,
          updated_at: now,
        });
      }
      this.messages = this.messages.map((message) => (
        threadMessages.some((deleted) => deleted.record_id === message.record_id)
          ? { ...message, record_state: 'deleted', sync_status: 'synced', updated_at: now }
          : message
      ));
      if (this.activeThreadId === parent.record_id) this.closeThread({ syncRoute: false });
      return;
    }
    await this.softDeleteChatMessages(threadMessages, 'Chat thread delete');
    if (this.activeThreadId === parent.record_id) this.closeThread({ syncRoute: false });
  },

  async archiveChatThreadByParentId(recordId, archived = true) {
    this.error = null;
    const parent = this.getChatMessageById(recordId);
    if (!parent) throw new Error('Thread not found');
    if (this.isChatThreadArchiveSubmitting(parent.record_id)) return null;
    const nextState = archived ? 'archived' : 'active';
    const now = new Date().toISOString();
    this.chatThreadArchiveSubmittingId = parent.record_id;
    this.chatThreadArchiveSubmittingAction = archived ? 'archive' : 'unarchive';
    try {
      if (!isTowerPgBackendMode() || !parent.pg_backend) throw new Error('Thread archive requires Tower PG mode');
      const accepted = await archiveTowerPgThreadFromLocal(this, parent, archived);
      const updatedParent = {
        ...parent,
        record_state: accepted?.record_state || nextState,
        version: accepted?.row_version || accepted?.version || ((parent.version ?? 1) + 1),
        updated_at: accepted?.updated_at || now,
        pg_archived_at: accepted?.archived_at || null,
      };
      await upsertMessage(updatedParent);
      this.messages = this.messages.map((message) => (
        message.record_id === parent.record_id ? updatedParent : message
      ));
      this.closeMessageActionsMenu();
      this.scheduleChatPreviewMeasurement();
      return updatedParent;
    } catch (error) {
      this.error = error?.message || (archived ? 'Failed to archive thread.' : 'Failed to unarchive thread.');
      return null;
    } finally {
      if (this.chatThreadArchiveSubmittingId === parent.record_id) {
        this.chatThreadArchiveSubmittingId = '';
        this.chatThreadArchiveSubmittingAction = '';
      }
    }
  },

  async softDeleteChatMessages(messagesToDelete, label = 'Chat message delete') {
    const messages = Array.isArray(messagesToDelete) ? messagesToDelete.filter(Boolean) : [];
    if (messages.length === 0) return;
    const channel = this.selectedChannel
      || this.channels.find((candidate) => candidate.record_id === messages[0]?.channel_id)
      || null;
    const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
      label,
    });

    for (const message of messages) {
      const nextVersion = (message.version ?? 1) + 1;
      await upsertMessage({
        ...message,
        record_state: 'deleted',
        sync_status: 'pending',
        version: nextVersion,
        updated_at: new Date().toISOString(),
      });

      const envelope = await outboundChatMessage({
        record_id: message.record_id,
        owner_npub: channel?.owner_npub || this.workspaceOwnerNpub || message.sender_npub,
        channel_id: message.channel_id,
        parent_message_id: message.parent_message_id,
        body: message.body,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        version: nextVersion,
        previous_version: message.version ?? 1,
        signature_npub: this.signingNpub,
        record_state: 'deleted',
      });

      await addPendingWrite({
        record_id: message.record_id,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });
    }

    this.messages = this.messages.map((message) => (
      messages.some((deleted) => deleted.record_id === message.record_id)
        ? { ...message, record_state: 'deleted', sync_status: 'pending' }
        : message
    ));
    await this.flushAndBackgroundSync();
  },
};
