import { beforeEach, describe, expect, it, vi } from 'vitest';
import './setup.js';

// Mock Alpine.js — it requires a browser `window` at import time
vi.mock('alpinejs', () => ({
  default: { nextTick: (fn) => fn?.() },
}));

vi.mock('../src/translators/chat.js', () => ({
  outboundChatMessage: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:chat_message' })),
  outboundChannel: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:channel' })),
  recordFamilyHash: (family) => `mock:${family}`,
}));

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => false),
}));

vi.mock('../src/pg-write-adapter.js', () => ({
  createTowerPgMessageFromLocal: vi.fn(),
  deleteTowerPgMessageFromLocal: vi.fn(),
  deleteTowerPgThreadFromLocal: vi.fn(),
}));

import { isTowerPgBackendMode } from '../src/backend-mode.js';
import { chatMessageManagerMixin } from '../src/chat-message-manager.js';
import { createChatThreadFlowDispatchState } from '../src/chat-thread-flow-dispatch.js';
import { createChatGetItDoneState } from '../src/chat-get-it-done.js';
import { createTowerPgMessageFromLocal } from '../src/pg-write-adapter.js';
import {
  deleteTowerPgMessageFromLocal,
  deleteTowerPgThreadFromLocal,
} from '../src/pg-write-adapter.js';
import {
  clearRuntimeData,
  deleteWorkspaceDb,
  getMessageById,
  openWorkspaceDb,
  upsertMessage,
} from '../src/db.js';

beforeEach(() => {
  isTowerPgBackendMode.mockReturnValue(false);
  createTowerPgMessageFromLocal.mockReset();
  deleteTowerPgMessageFromLocal.mockReset();
  deleteTowerPgThreadFromLocal.mockReset();
});

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    messages: [],
    channels: [],
    flows: [],
    scopes: [],
    selectedChannelId: null,
    activeThreadId: null,
    threadInput: '',
    messageInput: '',
    messageAudioDrafts: [],
    threadAudioDrafts: [],
    audioNotes: [],
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    focusMessageId: null,
    threadVisibleReplyCount: 6,
    mainFeedVisibleCount: 80,
    threadSize: 'default',
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,
    messageImageUploadCount: 0,
    threadImageUploadCount: 0,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    showChannelSettingsModal: false,
    showFlowStartConfirm: false,
    flowStartTarget: null,
    flowStartContext: '',
    messageActionsMenuId: null,
    chatDeleteConfirm: {
      open: false,
      mode: '',
      recordId: '',
      title: '',
      message: '',
      submitting: false,
      error: '',
    },
    error: null,
    session: null,
    botNpub: '',
    backendUrl: '',
    THREAD_REPLY_PAGE_SIZE: 6,
    MAIN_FEED_PAGE_SIZE: 80,
    COMPOSER_MAX_LINES: 5,
    MESSAGE_PREVIEW_MAX_LINES: 15,
    // Stubs for methods from other mixins / the store
    syncRoute: vi.fn(),
    rememberPeople: vi.fn().mockResolvedValue(undefined),
    captureScrollAnchor: vi.fn().mockReturnValue(null),
    restoreScrollAnchor: vi.fn(),
    scheduleStorageImageHydration: vi.fn(),
    performSync: vi.fn().mockResolvedValue(undefined),
    ensureBackgroundSync: vi.fn(),
    selectChannel: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockResolvedValue(undefined),
    createEncryptedGroup: vi.fn().mockResolvedValue({ group_id: 'g1' }),
    getPreferredChannelWriteGroup: vi.fn().mockReturnValue('g1'),
    getChannelLabel: vi.fn().mockReturnValue('test-channel'),
    getTaskBoardOptionLabel: vi.fn((scopeId) => scopeId ? `Scope ${scopeId}` : ''),
    buildTaskBoardAssignment: vi.fn((scopeId) => {
      if (scopeId === '__unscoped__') {
        return {
          scope_id: null,
          scope_l1_id: null,
          scope_l2_id: null,
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
          scope_policy_group_ids: null,
          board_group_id: 'workspace-default',
          group_ids: ['workspace-default'],
          shares: [{ type: 'group', group_npub: 'workspace-default', access: 'write' }],
        };
      }
      return {
        scope_id: scopeId,
        scope_l1_id: scopeId,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: [`policy:${scopeId}`],
        board_group_id: `group:${scopeId}`,
        group_ids: [`group:${scopeId}`],
        shares: [{ type: 'group', group_npub: `group:${scopeId}`, access: 'write' }],
      };
    }),
    materializeAudioDrafts: vi.fn().mockResolvedValue({ attachments: [] }),
    containsInlineImageUploadToken: vi.fn().mockReturnValue(false),
    getSenderName: vi.fn((npub) => npub ? `Name ${npub}` : ''),
    getSenderAvatar: vi.fn(() => null),
    getInitials: vi.fn((name) => String(name || 'NA').slice(0, 2).toUpperCase()),
    findPeopleSuggestions: vi.fn(() => []),
    scopesMap: new Map(),
    scopePickerFlatFor: vi.fn(() => []),
    getScopeBreadcrumb: vi.fn((scopeId) => scopeId ? `Breadcrumb ${scopeId}` : ''),
    scopeLevelLabel: vi.fn((level) => level || ''),
    openRecordStatusModal: vi.fn(),
    workspaceOwnerNpub: 'npub1owner',
    ...createChatGetItDoneState(),
    ...overrides,
  };

  // Apply all mixin methods and getters
  const descriptors = Object.getOwnPropertyDescriptors(chatMessageManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

function bindMethod(methodName, overrides = {}) {
  const store = createStore(overrides);
  const method = store[methodName];
  if (typeof method === 'function') {
    return { fn: method.bind(store), store };
  }
  return { store };
}

// ---------------------------------------------------------------------------
// Computed getters
// ---------------------------------------------------------------------------
describe('chat message computed getters', () => {
  it('selectedChannel returns matching channel', () => {
    const ch = { record_id: 'ch1', title: 'General' };
    const store = createStore({ channels: [ch], selectedChannelId: 'ch1' });
    expect(store.selectedChannel).toEqual(ch);
  });

  it('selectedChannel returns null when no match', () => {
    const store = createStore({ channels: [], selectedChannelId: 'ch1' });
    expect(store.selectedChannel).toBeNull();
  });

  it('mainFeedMessages returns ranked messages', () => {
    const store = createStore({
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: null, updated_at: '2024-01-01T02:00:00Z' },
      ],
    });
    const feed = store.mainFeedMessages;
    // mainFeedMessages should only contain top-level messages (parent_message_id == null)
    expect(feed.every((m) => m.parent_message_id === null)).toBe(true);
  });

  it('visibleMainFeedMessages returns the newest feed window', () => {
    const store = createStore({
      mainFeedVisibleCount: 2,
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: null, updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: null, updated_at: '2024-01-01T02:00:00Z' },
      ],
    });
    expect(store.visibleMainFeedMessages.map((message) => message.record_id)).toEqual(['m2', 'm3']);
    expect(store.hiddenMainFeedCount).toBe(1);
    expect(store.hasMoreMainFeedMessages).toBe(true);
  });

  it('visibleMainFeedMessages defaults to the newest 80 messages when the page size is 80', () => {
    const messages = Array.from({ length: 85 }, (_, index) => ({
      record_id: `m${index + 1}`,
      parent_message_id: null,
      updated_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
    }));
    const store = createStore({
      MAIN_FEED_PAGE_SIZE: 80,
      mainFeedVisibleCount: 80,
      messages,
    });
    expect(store.visibleMainFeedMessages).toHaveLength(80);
    expect(store.hiddenMainFeedCount).toBe(5);
    expect(store.visibleMainFeedMessages[0]?.record_id).toBe('m6');
    expect(store.visibleMainFeedMessages.at(-1)?.record_id).toBe('m85');
  });

  it('threadMessages returns empty when no active thread', () => {
    const store = createStore({ activeThreadId: null, messages: [{ record_id: 'm1' }] });
    expect(store.threadMessages).toEqual([]);
  });

  it('threadMessages returns replies for active thread', () => {
    const store = createStore({
      activeThreadId: 'm1',
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: 'm1', updated_at: '2024-01-01T02:00:00Z' },
        { record_id: 'm4', parent_message_id: null, updated_at: '2024-01-01T03:00:00Z' },
      ],
    });
    const thread = store.threadMessages;
    expect(thread.length).toBe(2);
    expect(thread.every((m) => m.parent_message_id === 'm1')).toBe(true);
  });

  it('adds target-linked audio notes to visible chat message attachments', () => {
    const store = createStore({
      messages: [
        {
          record_id: 'm1',
          parent_message_id: null,
          attachments: [],
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      audioNotes: [
        {
          record_id: 'audio-1',
          target_record_id: 'm1',
          target_record_family_hash: 'mock:chat_message',
          title: 'Reply TTS',
          duration_seconds: 12,
          record_state: 'active',
          updated_at: '2024-01-01T00:01:00Z',
        },
      ],
    });

    expect(store.visibleMainFeedMessages[0]?.attachments).toEqual([
      {
        kind: 'audio',
        audio_note_record_id: 'audio-1',
        title: 'Reply TTS',
        duration_seconds: 12,
      },
    ]);
  });

  it('rebuilds visible chat messages when target-linked audio notes arrive after the message', () => {
    const store = createStore({
      messages: [
        {
          record_id: 'm1',
          parent_message_id: null,
          attachments: [],
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      audioNotes: [],
    });

    expect(store.visibleMainFeedMessages[0]?.attachments).toEqual([]);

    store.audioNotes = [
      {
        record_id: 'audio-1',
        target_record_id: 'm1',
        target_record_family_hash: 'mock:chat_message',
        title: 'Reply TTS',
        record_state: 'active',
        updated_at: '2024-01-01T00:01:00Z',
      },
    ];

    expect(store.visibleMainFeedMessages[0]?.attachments).toEqual([
      expect.objectContaining({
        kind: 'audio',
        audio_note_record_id: 'audio-1',
        title: 'Reply TTS',
      }),
    ]);
  });

  it('does not duplicate audio attachments already present on the message', () => {
    const store = createStore({
      messages: [
        {
          record_id: 'm1',
          parent_message_id: null,
          attachments: [{ kind: 'audio', audio_note_record_id: 'audio-1', title: 'Existing audio' }],
          updated_at: '2024-01-01T00:00:00Z',
        },
      ],
      audioNotes: [
        {
          record_id: 'audio-1',
          target_record_id: 'm1',
          target_record_family_hash: 'mock:chat_message',
          title: 'Reply TTS',
          record_state: 'active',
          updated_at: '2024-01-01T00:01:00Z',
        },
      ],
    });

    expect(store.visibleMainFeedMessages[0]?.attachments).toEqual([
      { kind: 'audio', audio_note_record_id: 'audio-1', title: 'Existing audio' },
    ]);
  });

  it('hasMoreThreadMessages returns false when no hidden messages', () => {
    const store = createStore({
      activeThreadId: 'm1',
      threadVisibleReplyCount: 10,
      messages: [
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
      ],
    });
    expect(store.hasMoreThreadMessages).toBe(false);
  });

  it('hiddenThreadReplyCount is zero when all visible', () => {
    const store = createStore({
      activeThreadId: 'm1',
      threadVisibleReplyCount: 100,
      messages: [
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
      ],
    });
    expect(store.hiddenThreadReplyCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Thread lifecycle
// ---------------------------------------------------------------------------
describe('thread lifecycle', () => {
  it('openThread sets active thread and resets state', () => {
    const { fn, store } = bindMethod('openThread', {
      activeThreadId: null,
      threadInput: 'leftover',
    });
    fn('m1');
    expect(store.activeThreadId).toBe('m1');
    expect(store.threadInput).toBe('');
    expect(store.threadVisibleReplyCount).toBe(6);
    expect(store.pendingThreadScrollToLatest).toBe(true);
    expect(store.syncRoute).toHaveBeenCalled();
  });

  it('openThread selects the owning PG channel when opened from an aggregate feed', () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const selectPgChannelContext = vi.fn();
    const { fn, store } = bindMethod('openThread', {
      selectedChannelId: null,
      selectPgChannelContext,
      messages: [
        { record_id: 'm1', channel_id: 'channel-1', parent_message_id: null },
      ],
    });

    fn('m1');

    expect(selectPgChannelContext).toHaveBeenCalledWith('channel-1');
    expect(store.activeThreadId).toBe('m1');
  });

  it('openThread respects syncRoute: false', () => {
    const { fn, store } = bindMethod('openThread');
    fn('m1', { syncRoute: false });
    expect(store.syncRoute).not.toHaveBeenCalled();
  });

  it('closeThread resets thread state', () => {
    const { fn, store } = bindMethod('closeThread', {
      activeThreadId: 'm1',
      threadInput: 'something',
      threadSize: 'full',
      pendingThreadScrollToLatest: true,
    });
    fn();
    expect(store.activeThreadId).toBeNull();
    expect(store.threadInput).toBe('');
    expect(store.threadSize).toBe('default');
    expect(store.pendingThreadScrollToLatest).toBe(false);
    expect(store.syncRoute).toHaveBeenCalled();
  });

  it('closeThread respects syncRoute: false', () => {
    const { fn, store } = bindMethod('closeThread');
    fn({ syncRoute: false });
    expect(store.syncRoute).not.toHaveBeenCalled();
  });

  it('cycleThreadSize toggles modal fullscreen', () => {
    const { fn, store } = bindMethod('cycleThreadSize', { threadSize: 'default' });
    fn();
    expect(store.threadSize).toBe('full');
    fn();
    expect(store.threadSize).toBe('default');
  });

  it('showMoreThreadMessages increases visible count', () => {
    const { fn, store } = bindMethod('showMoreThreadMessages', {
      threadVisibleReplyCount: 6,
    });
    fn();
    expect(store.threadVisibleReplyCount).toBe(12);
    fn();
    expect(store.threadVisibleReplyCount).toBe(18);
  });

  it('showMoreMainFeedMessages increases visible count', () => {
    const { fn, store } = bindMethod('showMoreMainFeedMessages', {
      mainFeedVisibleCount: 80,
      MAIN_FEED_PAGE_SIZE: 80,
    });
    fn();
    expect(store.mainFeedVisibleCount).toBe(160);
    fn();
    expect(store.mainFeedVisibleCount).toBe(240);
  });

  it('showMoreMainFeedMessages expands by 80 and restores the captured anchor', () => {
    const anchor = { id: 'm80' };
    const { fn, store } = bindMethod('showMoreMainFeedMessages', {
      mainFeedVisibleCount: 80,
      MAIN_FEED_PAGE_SIZE: 80,
      captureScrollAnchor: vi.fn().mockReturnValue(anchor),
      restoreScrollAnchor: vi.fn(),
    });
    fn();
    expect(store.mainFeedVisibleCount).toBe(160);
    expect(store.captureScrollAnchor).toHaveBeenCalled();
    expect(store.restoreScrollAnchor).toHaveBeenCalledWith(anchor);
  });

  it('getThreadParentMessage returns parent', () => {
    const parent = { record_id: 'm1', parent_message_id: null };
    const { fn } = bindMethod('getThreadParentMessage', {
      activeThreadId: 'm1',
      messages: [parent, { record_id: 'm2', parent_message_id: 'm1' }],
    });
    expect(fn()).toEqual(parent);
  });

  it('getThreadParentMessage returns null when no thread', () => {
    const { fn } = bindMethod('getThreadParentMessage', { activeThreadId: null });
    expect(fn()).toBeNull();
  });

  it('getThreadReplyCount counts replies', () => {
    const { fn } = bindMethod('getThreadReplyCount', {
      messages: [
        { record_id: 'm1', parent_message_id: null },
        { record_id: 'm2', parent_message_id: 'm1' },
        { record_id: 'm3', parent_message_id: 'm1' },
        { record_id: 'm4', parent_message_id: 'm5' },
      ],
    });
    expect(fn('m1')).toBe(2);
    expect(fn('m5')).toBe(1);
    expect(fn('m99')).toBe(0);
  });

  it('derives the latest thread reply preview from the newest reply', () => {
    const words = Array.from({ length: 55 }, (_, index) => `word${index + 1}`).join(' ');
    const store = createStore({
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', body: 'older reply', updated_at: '2024-01-01T00:01:00Z' },
        { record_id: 'm3', parent_message_id: 'm1', body: words, updated_at: '2024-01-01T00:02:00Z' },
      ],
    });

    const preview = store.getLatestThreadReplyPreview('m1');
    expect(preview.split(/\s+/)).toHaveLength(50);
    expect(preview).toContain('word50...');
  });

  it('returns no latest reply preview when a thread has no replies', () => {
    const { fn } = bindMethod('getLatestThreadReplyPreview', {
      messages: [{ record_id: 'm1', parent_message_id: null, body: 'root' }],
    });
    expect(fn('m1')).toBe('');
  });

  it('returns one replier avatar per distinct reply author in reply order', () => {
    const store = createStore({
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', sender_npub: 'alice', updated_at: '2024-01-01T00:01:00Z' },
        { record_id: 'm3', parent_message_id: 'm1', sender_npub: 'bob', updated_at: '2024-01-01T00:02:00Z' },
        { record_id: 'm4', parent_message_id: 'm1', sender_npub: 'alice', updated_at: '2024-01-01T00:03:00Z' },
      ],
      getSenderName: vi.fn((npub) => ({ alice: 'Alice Example', bob: 'Bob Example' })[npub] || npub),
      getSenderAvatar: vi.fn((npub) => npub === 'bob' ? 'https://example.test/bob.png' : null),
    });

    expect(store.getThreadReplierAvatars('m1')).toEqual([
      {
        npub: 'alice',
        name: 'Alice Example',
        avatarUrl: null,
        initials: 'AL',
      },
      {
        npub: 'bob',
        name: 'Bob Example',
        avatarUrl: 'https://example.test/bob.png',
        initials: 'BO',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Chat preview truncation
// ---------------------------------------------------------------------------
describe('chat preview truncation', () => {
  it('isChatMessageExpanded checks list', () => {
    const { fn } = bindMethod('isChatMessageExpanded', {
      expandedChatMessageIds: ['m1', 'm3'],
    });
    expect(fn('m1')).toBe(true);
    expect(fn('m2')).toBe(false);
  });

  it('isChatMessageTruncated checks list', () => {
    const { fn } = bindMethod('isChatMessageTruncated', {
      truncatedChatMessageIds: ['m2'],
    });
    expect(fn('m2')).toBe(true);
    expect(fn('m1')).toBe(false);
  });

  it('toggleChatMessageExpanded adds and removes', () => {
    const { fn, store } = bindMethod('toggleChatMessageExpanded', {
      expandedChatMessageIds: [],
    });
    fn('m1');
    expect(store.expandedChatMessageIds).toContain('m1');
    fn('m1');
    expect(store.expandedChatMessageIds).not.toContain('m1');
  });

  it('toggleChatMessageExpanded ignores empty recordId', () => {
    const { fn, store } = bindMethod('toggleChatMessageExpanded', {
      expandedChatMessageIds: [],
    });
    fn('');
    expect(store.expandedChatMessageIds).toEqual([]);
    fn(null);
    expect(store.expandedChatMessageIds).toEqual([]);
  });

  it('syncChatPreviewState prunes invalid IDs', () => {
    const { fn, store } = bindMethod('syncChatPreviewState', {
      mainFeedVisibleCount: 1,
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: null, updated_at: '2024-01-01T01:00:00Z' },
      ],
      expandedChatMessageIds: ['m1', 'm999'],
      truncatedChatMessageIds: ['m999', 'm1'],
    });
    fn();
    expect(store.expandedChatMessageIds).toEqual([]);
    expect(store.truncatedChatMessageIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scroll anchoring (no-op in test env — just verify no throw)
// ---------------------------------------------------------------------------
describe('scroll and composer methods', () => {
  it('scheduleChatFeedScrollToBottom does not throw in test env', () => {
    const { fn } = bindMethod('scheduleChatFeedScrollToBottom');
    expect(() => fn()).not.toThrow();
  });

  it('scheduleChatFeedScrollToBottom follows layout growth while the feed settles', () => {
    const feed = {
      scrollHeight: 120,
      clientHeight: 80,
      scrollTop: 0,
    };
    const frames = [];
    const updateChatFeedLoadMoreVisibility = vi.fn();
    const previousAlpine = globalThis.Alpine;
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;

    globalThis.Alpine = {
      nextTick: (callback) => callback?.(),
    };
    globalThis.document = {
      querySelector: vi.fn(() => feed),
    };
    globalThis.window = {
      requestAnimationFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame: vi.fn(),
    };

    try {
      const { fn } = bindMethod('scheduleChatFeedScrollToBottom', {
        updateChatFeedLoadMoreVisibility,
      });
      fn(2);

      expect(frames).toHaveLength(1);
      frames.shift()();
      expect(feed.scrollTop).toBe(120);

      feed.scrollHeight = 220;
      expect(frames).toHaveLength(1);
      frames.shift()();
      expect(feed.scrollTop).toBe(220);

      feed.scrollHeight = 260;
      expect(frames).toHaveLength(1);
      frames.shift()();
      expect(feed.scrollTop).toBe(260);
      expect(updateChatFeedLoadMoreVisibility).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.Alpine = previousAlpine;
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  });

  it('scheduleThreadRepliesScrollToBottom does not throw in test env', () => {
    const { fn } = bindMethod('scheduleThreadRepliesScrollToBottom');
    expect(() => fn()).not.toThrow();
  });

  it('autosizeComposer does not throw with null', () => {
    const { fn } = bindMethod('autosizeComposer');
    expect(() => fn(null)).not.toThrow();
  });

  it('autosizeComposer keeps empty composers at the one-line minimum', () => {
    const { fn } = bindMethod('autosizeComposer');
    const textarea = {
      scrollHeight: 42,
      style: {},
    };

    vi.stubGlobal('window', {
      getComputedStyle: () => ({
        lineHeight: '20px',
        paddingTop: '8px',
        paddingBottom: '8px',
        borderTopWidth: '1px',
        borderBottomWidth: '1px',
        minHeight: '38px',
      }),
    });

    try {
      fn(textarea);
      expect(textarea.style.height).toBe('42px');
      expect(textarea.style.overflowY).toBe('hidden');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('autosizeComposer caps composers at five visible lines and scrolls overflow', () => {
    const { fn } = bindMethod('autosizeComposer');
    const textarea = {
      scrollHeight: 220,
      style: {},
    };

    vi.stubGlobal('window', {
      getComputedStyle: () => ({
        lineHeight: '20px',
        paddingTop: '8px',
        paddingBottom: '8px',
        borderTopWidth: '1px',
        borderBottomWidth: '1px',
        minHeight: '38px',
      }),
    });

    try {
      fn(textarea);
      expect(textarea.style.height).toBe('118px');
      expect(textarea.style.overflowY).toBe('auto');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scheduleComposerAutosize does not throw in test env', () => {
    const { fn } = bindMethod('scheduleComposerAutosize');
    expect(() => fn('message')).not.toThrow();
  });

  it('scheduleChatPreviewMeasurement does not throw in test env', () => {
    const { fn } = bindMethod('scheduleChatPreviewMeasurement');
    expect(() => fn()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Message application
// ---------------------------------------------------------------------------
describe('applyMessages', () => {
  it('sets messages on store', async () => {
    const { fn, store } = bindMethod('applyMessages');
    const msgs = [
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
    ];
    await fn(msgs);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].record_id).toBe('m1');
    expect(store.pendingChatScrollToLatest).toBe(false);
  });

  it('closes thread if thread messages disappear', async () => {
    const { fn, store } = bindMethod('applyMessages', {
      activeThreadId: 'm99',
    });
    await fn([{ record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01' }]);
    expect(store.activeThreadId).toBeNull();
  });

  it('keeps thread if thread messages exist', async () => {
    const { fn, store } = bindMethod('applyMessages', {
      activeThreadId: 'm1',
    });
    await fn([
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01' },
      { record_id: 'm2', sender_npub: 'npub1b', parent_message_id: 'm1', updated_at: '2024-01-02' },
    ]);
    expect(store.activeThreadId).toBe('m1');
  });

  it('schedules a bottom scroll when pendingChatScrollToLatest is set', async () => {
    const scheduleChatFeedScrollToBottom = vi.fn();
    const { fn } = bindMethod('applyMessages', {
      pendingChatScrollToLatest: true,
      scheduleChatFeedScrollToBottom,
    });
    await fn([
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(scheduleChatFeedScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('exposes a load-more visibility hook whenever older messages are hidden', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      record_id: `m${index + 1}`,
      parent_message_id: null,
      updated_at: `2024-01-01T00:${String(index).padStart(2, '0')}:00Z`,
    }));
    const store = createStore({
      MAIN_FEED_PAGE_SIZE: 21,
      mainFeedVisibleCount: 21,
      messages,
      chatFeedNearTop: false,
    });
    expect(store.showMainFeedLoadMoreControl).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// patchMessageLocal
// ---------------------------------------------------------------------------
describe('patchMessageLocal', () => {
  it('updates existing message in place', () => {
    const { fn, store } = bindMethod('patchMessageLocal', {
      messages: [
        { record_id: 'm1', body: 'old', updated_at: '2024-01-01' },
      ],
    });
    fn({ record_id: 'm1', body: 'new' });
    expect(store.messages[0].body).toBe('new');
    expect(store.messages[0].updated_at).toBe('2024-01-01');
  });

  it('adds new message when not found', () => {
    const { fn, store } = bindMethod('patchMessageLocal', {
      messages: [
        { record_id: 'm1', body: 'old', updated_at: '2024-01-01' },
      ],
    });
    fn({ record_id: 'm2', body: 'new', updated_at: '2024-01-02' });
    expect(store.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// refreshMessages
// ---------------------------------------------------------------------------
describe('refreshMessages', () => {
  it('clears messages when no channel selected', async () => {
    const { fn, store } = bindMethod('refreshMessages', {
      selectedChannelId: null,
      messages: [{ record_id: 'm1' }],
    });
    await fn();
    expect(store.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createBotDm validation
// ---------------------------------------------------------------------------
describe('createBotDm', () => {
  it('sets error when not signed in', async () => {
    const { fn, store } = bindMethod('createBotDm', {
      session: null,
      botNpub: 'npub1bot',
    });
    await fn();
    expect(store.error).toBe('Sign in and set bot npub first');
  });

  it('sets error when no backend', async () => {
    const { fn, store } = bindMethod('createBotDm', {
      session: { npub: 'npub1me' },
      botNpub: 'npub1bot',
      backendUrl: '',
    });
    await fn();
    expect(store.error).toBe('Set backend URL first');
  });

  it('opens bot DMs through the Tower PG channel helper in PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const ensureTowerPgDmChannel = vi.fn().mockResolvedValue({ record_id: 'pg-dm-1' });
    const scheduleChannelsRefresh = vi.fn();
    const { fn, store } = bindMethod('createBotDm', {
      session: { npub: 'npub1me' },
      ownerNpub: 'npub1owner',
      currentWorkspaceOwnerNpub: 'npub1owner',
      botNpub: 'npub1bot',
      backendUrl: 'https://tower.example',
      channels: [{ record_id: 'old-channel' }],
      ensureTowerPgDmChannel,
      scheduleChannelsRefresh,
    });

    await fn();

    expect(store.error).toBeNull();
    expect(ensureTowerPgDmChannel).toHaveBeenCalledWith('npub1bot');
    expect(store.refreshChannels).not.toHaveBeenCalled();
    expect(store.channels.map((channel) => channel.record_id)).toEqual(['old-channel', 'pg-dm-1']);
    expect(scheduleChannelsRefresh).toHaveBeenCalledWith('PG bot DM open');
    expect(store.selectChannel).toHaveBeenCalledWith('pg-dm-1', { syncRoute: false });
    expect(store.createEncryptedGroup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// sendMessage validation
// ---------------------------------------------------------------------------
describe('sendMessage', () => {
  it('does nothing with empty input and no drafts', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: '',
      messageAudioDrafts: [],
      selectedChannelId: 'ch1',
      channels: [{ record_id: 'ch1' }],
    });
    await fn();
    expect(store.error).toBeNull();
    expect(store.performSync).not.toHaveBeenCalled();
  });

  it('sets error when no channel selected', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: 'hello',
      messageAudioDrafts: [],
      selectedChannelId: null,
    });
    await fn();
    expect(store.error).toBe('Select a channel first');
  });

  it('opens the write-context chooser when sending a PG message from scope Home', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const openWriteContextModal = vi.fn().mockReturnValue(null);
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: 'hello',
      messageAudioDrafts: [],
      selectedChannelId: null,
      openWriteContextModal,
    });

    await fn();

    expect(store.error).toBeNull();
    expect(openWriteContextModal).toHaveBeenCalledWith('message', { options: {} });
    expect(store.messageInput).toBe('hello');
  });

  it('sets error when image upload in progress', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: 'hello',
      messageImageUploadCount: 1,
    });
    await fn();
    expect(store.error).toBe('Wait for image upload to finish.');
  });

  it('schedules a chat-feed scroll after inserting the local pending row', async () => {
    const workspaceDbKey = 'chat-message-manager-send-message';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();

    try {
      const scheduleChatFeedScrollToBottom = vi.fn();
      const patchMessageLocal = vi.fn();
      const { fn, store } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messageInput: 'hello world',
        scheduleChatFeedScrollToBottom,
        patchMessageLocal,
        flushAndBackgroundSync: vi.fn().mockResolvedValue(undefined),
        getPreferredChannelWriteGroup: vi.fn().mockReturnValue(null),
      });

      await fn();

      expect(scheduleChatFeedScrollToBottom).toHaveBeenCalledTimes(1);
      expect(patchMessageLocal).toHaveBeenCalledTimes(1);
      expect(patchMessageLocal.mock.calls[0][0]).toEqual(expect.objectContaining({
        channel_id: 'ch1',
        body: 'hello world',
        sender_npub: 'npub1viewer',
        sync_status: 'pending',
      }));
      expect(store.messageInput).toBe('');
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('replaces the optimistic local row with the accepted PG message', async () => {
    const workspaceDbKey = 'chat-message-manager-send-message-pg';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      record_id: 'pg-message-1',
      channel_id: localRow.channel_id,
      parent_message_id: null,
      body: localRow.body,
      attachments: [],
      sender_npub: localRow.sender_npub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-06-06T01:00:00.000Z',
      pg_backend: true,
      pg_record_type: 'message',
      pg_thread_id: 'pg-thread-1',
    }));

    try {
      const { fn, store } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messageInput: 'hello pg',
        getPreferredChannelWriteGroup: vi.fn().mockReturnValue(null),
      });

      await fn();

      const localRecordId = createTowerPgMessageFromLocal.mock.calls[0][1].record_id;
      expect(await getMessageById(localRecordId)).toBeUndefined();
      expect(await getMessageById('pg-message-1')).toMatchObject({
        record_id: 'pg-message-1',
        body: 'hello pg',
        sync_status: 'synced',
        pg_backend: true,
      });
      expect(store.messages.map((message) => message.record_id)).toEqual(['pg-message-1']);
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('attaches PG audio drafts after the accepted message id is known', async () => {
    const workspaceDbKey = 'chat-message-manager-send-message-pg-audio';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      record_id: 'pg-message-1',
      channel_id: localRow.channel_id,
      parent_message_id: null,
      body: localRow.body,
      attachments: [],
      sender_npub: localRow.sender_npub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-06-06T01:00:00.000Z',
      pg_backend: true,
      pg_record_type: 'message',
      pg_scope_id: 'scope-1',
      pg_thread_id: 'pg-thread-1',
    }));

    try {
      const materializeAudioDrafts = vi.fn().mockResolvedValue({
        attachments: [{
          kind: 'audio',
          audio_note_record_id: 'audio-pg-1',
          title: 'Voice note',
          duration_seconds: 12,
        }],
      });
      const { fn, store } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messageInput: 'hello pg audio',
        messageAudioDrafts: [{ draft_id: 'draft-1', title: 'Voice note', storage_object_id: 'storage-1' }],
        materializeAudioDrafts,
      });

      await fn();

      const localRecordId = createTowerPgMessageFromLocal.mock.calls[0][1].record_id;
      expect(materializeAudioDrafts).toHaveBeenCalledWith(expect.objectContaining({
        drafts: [{ draft_id: 'draft-1', title: 'Voice note', storage_object_id: 'storage-1' }],
        target_record_id: 'pg-message-1',
        target_record_family_hash: 'mock:chat_message',
        scopeId: 'scope-1',
        channelId: 'ch1',
        threadId: 'pg-thread-1',
      }));
      expect(materializeAudioDrafts.mock.calls[0][0].target_record_id).not.toBe(localRecordId);
      expect(await getMessageById('pg-message-1')).toMatchObject({
        record_id: 'pg-message-1',
        attachments: [{
          kind: 'audio',
          audio_note_record_id: 'audio-pg-1',
          title: 'Voice note',
          duration_seconds: 12,
        }],
      });
      expect(store.messages[0]).toMatchObject({
        record_id: 'pg-message-1',
        attachments: [expect.objectContaining({ audio_note_record_id: 'audio-pg-1' })],
      });
      expect(store.error).toBeNull();
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('repairs agent DM access before sending a PG message', async () => {
    const workspaceDbKey = 'chat-message-manager-send-agent-dm-pg';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    const ensureTowerPgDmChannel = vi.fn().mockResolvedValue({ record_id: 'dm-agent' });
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      ...localRow,
      record_id: 'pg-agent-dm-message',
      sync_status: 'synced',
      pg_backend: true,
    }));

    try {
      const { fn } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        botNpub: 'npub1bot',
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'dm-agent',
        channels: [{
          record_id: 'dm-agent',
          owner_npub: 'npub1owner',
          channel_type: 'dm',
          participant_npubs: ['npub1viewer', 'npub1bot'],
        }],
        messageInput: 'hello bot',
        ensureTowerPgDmChannel,
      });

      await fn();

      expect(ensureTowerPgDmChannel).toHaveBeenCalledWith('npub1bot');
      expect(createTowerPgMessageFromLocal).toHaveBeenCalled();
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('repairs agent DM access when the PG DM is identified by title', async () => {
    const workspaceDbKey = 'chat-message-manager-send-agent-dm-title-pg';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    const ensureTowerPgDmChannel = vi.fn().mockResolvedValue({ record_id: 'dm-agent' });
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      ...localRow,
      record_id: 'pg-agent-dm-title-message',
      sync_status: 'synced',
      pg_backend: true,
    }));

    try {
      const { fn } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        botNpub: 'npub1bot',
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'dm-agent',
        channels: [{
          record_id: 'dm-agent',
          owner_npub: 'npub1owner',
          title: 'DM: npub1bot',
          channel_type: 'dm',
        }],
        messageInput: 'hello bot',
        ensureTowerPgDmChannel,
      });

      await fn();

      expect(ensureTowerPgDmChannel).toHaveBeenCalledWith('npub1bot');
      expect(createTowerPgMessageFromLocal).toHaveBeenCalled();
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('derives the agent npub from the PG DM title when bot state is empty', async () => {
    const workspaceDbKey = 'chat-message-manager-send-agent-dm-title-derived-pg';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    const ensureTowerPgDmChannel = vi.fn().mockResolvedValue({ record_id: 'dm-agent' });
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      ...localRow,
      record_id: 'pg-agent-dm-title-derived-message',
      sync_status: 'synced',
      pg_backend: true,
    }));

    try {
      const { fn } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        botNpub: '',
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'dm-agent',
        channels: [{
          record_id: 'dm-agent',
          owner_npub: 'npub1owner',
          title: 'DM: npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz',
          channel_type: 'channel',
        }],
        messageInput: 'hello bot',
        ensureTowerPgDmChannel,
      });

      await fn();

      expect(ensureTowerPgDmChannel).toHaveBeenCalledWith('npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz');
      expect(createTowerPgMessageFromLocal).toHaveBeenCalled();
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });
});

// ---------------------------------------------------------------------------
// sendThreadReply validation
// ---------------------------------------------------------------------------
describe('sendThreadReply', () => {
  it('does nothing with empty input and no drafts', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: '',
      threadAudioDrafts: [],
      activeThreadId: 'm1',
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.performSync).not.toHaveBeenCalled();
  });

  it('sets error when no thread open', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: 'reply',
      threadAudioDrafts: [],
      activeThreadId: null,
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.error).toBe('Open a thread first');
  });

  it('sets error when image upload in progress', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: 'reply',
      threadImageUploadCount: 1,
      activeThreadId: 'm1',
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.error).toBe('Wait for image upload to finish.');
  });

  it('replaces optimistic PG thread replies without promoting them to the main channel', async () => {
    const workspaceDbKey = 'chat-message-manager-send-thread-reply-pg';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      record_id: 'pg-reply-1',
      channel_id: localRow.channel_id,
      parent_message_id: localRow.parent_message_id,
      body: localRow.body,
      attachments: [],
      sender_npub: localRow.sender_npub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-06-06T01:01:00.000Z',
      pg_backend: true,
      pg_record_type: 'message',
      pg_thread_id: 'pg-thread-1',
    }));

    try {
      const rootMessage = {
        record_id: 'root-1',
        channel_id: 'ch1',
        parent_message_id: null,
        body: 'Root',
        sender_npub: 'npub1viewer',
        sync_status: 'synced',
        record_state: 'active',
        updated_at: '2026-06-06T01:00:00.000Z',
        pg_backend: true,
        pg_thread_id: 'pg-thread-1',
      };
      await upsertMessage(rootMessage);
      const { fn, store } = bindMethod('sendThreadReply', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        activeThreadId: 'root-1',
        threadInput: 'reply pg',
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messages: [rootMessage],
        getPreferredChannelWriteGroup: vi.fn().mockReturnValue(null),
      });

      await fn();

      const localRecordId = createTowerPgMessageFromLocal.mock.calls[0][1].record_id;
      expect(createTowerPgMessageFromLocal.mock.calls[0][2]).toMatchObject({
        parentMessage: rootMessage,
      });
      expect(await getMessageById(localRecordId)).toBeUndefined();
      expect(await getMessageById('pg-reply-1')).toMatchObject({
        record_id: 'pg-reply-1',
        parent_message_id: 'root-1',
        sync_status: 'synced',
        pg_backend: true,
      });
      expect(store.mainFeedMessages.map((message) => message.record_id)).toEqual(['root-1']);
      expect(store.threadMessages.map((message) => message.record_id)).toEqual(['pg-reply-1']);
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('attaches PG audio drafts to accepted thread replies', async () => {
    const workspaceDbKey = 'chat-message-manager-send-thread-reply-pg-audio';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    createTowerPgMessageFromLocal.mockImplementation(async (_store, localRow) => ({
      record_id: 'pg-reply-1',
      channel_id: localRow.channel_id,
      parent_message_id: localRow.parent_message_id,
      body: localRow.body,
      attachments: [],
      sender_npub: localRow.sender_npub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-06-06T01:01:00.000Z',
      pg_backend: true,
      pg_record_type: 'message',
      pg_scope_id: 'scope-1',
      pg_thread_id: 'pg-thread-1',
    }));

    try {
      const rootMessage = {
        record_id: 'root-1',
        channel_id: 'ch1',
        parent_message_id: null,
        body: 'Root',
        sender_npub: 'npub1viewer',
        sync_status: 'synced',
        record_state: 'active',
        updated_at: '2026-06-06T01:00:00.000Z',
        pg_backend: true,
        pg_scope_id: 'scope-1',
        pg_thread_id: 'pg-thread-1',
      };
      await upsertMessage(rootMessage);
      const materializeAudioDrafts = vi.fn().mockResolvedValue({
        attachments: [{
          kind: 'audio',
          audio_note_record_id: 'audio-reply-pg-1',
          title: 'Reply voice note',
          duration_seconds: 8,
        }],
      });
      const { fn, store } = bindMethod('sendThreadReply', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        activeThreadId: 'root-1',
        threadInput: 'reply pg audio',
        threadAudioDrafts: [{ draft_id: 'draft-reply-1', title: 'Reply voice note', storage_object_id: 'storage-2' }],
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messages: [rootMessage],
        materializeAudioDrafts,
      });

      await fn();

      const localRecordId = createTowerPgMessageFromLocal.mock.calls[0][1].record_id;
      expect(materializeAudioDrafts).toHaveBeenCalledWith(expect.objectContaining({
        drafts: [{ draft_id: 'draft-reply-1', title: 'Reply voice note', storage_object_id: 'storage-2' }],
        target_record_id: 'pg-reply-1',
        target_record_family_hash: 'mock:chat_message',
        scopeId: 'scope-1',
        channelId: 'ch1',
        threadId: 'pg-thread-1',
      }));
      expect(materializeAudioDrafts.mock.calls[0][0].target_record_id).not.toBe(localRecordId);
      expect(await getMessageById('pg-reply-1')).toMatchObject({
        record_id: 'pg-reply-1',
        attachments: [{
          kind: 'audio',
          audio_note_record_id: 'audio-reply-pg-1',
          title: 'Reply voice note',
          duration_seconds: 8,
        }],
      });
      expect(store.threadMessages[0]).toMatchObject({
        record_id: 'pg-reply-1',
        attachments: [expect.objectContaining({ audio_note_record_id: 'audio-reply-pg-1' })],
      });
      expect(store.error).toBeNull();
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });
});

// ---------------------------------------------------------------------------
// deleteActiveThread validation
// ---------------------------------------------------------------------------
describe('deleteActiveThread', () => {
  it('sets error when no thread open', async () => {
    const { fn, store } = bindMethod('deleteActiveThread', {
      activeThreadId: null,
      selectedChannelId: 'ch1',
      messages: [],
    });
    await fn();
    expect(store.error).toBe('Open a thread first');
  });

  it('opens the delete thread confirmation when a thread is active', async () => {
    const { fn, store } = bindMethod('deleteActiveThread', {
      activeThreadId: 'root-1',
      selectedChannelId: 'ch1',
      messages: [{ record_id: 'root-1', channel_id: 'ch1', body: 'Root', parent_message_id: null }],
    });
    await fn();
    expect(store.chatDeleteConfirm).toMatchObject({
      open: true,
      mode: 'thread',
      recordId: 'root-1',
      title: 'Delete Thread',
    });
  });
});

// ---------------------------------------------------------------------------
// deleteSelectedChannel validation
// ---------------------------------------------------------------------------
describe('deleteSelectedChannel', () => {
  it('sets error when no channel selected', async () => {
    const { fn, store } = bindMethod('deleteSelectedChannel', {
      selectedChannelId: null,
      channels: [],
    });
    await fn();
    expect(store.error).toBe('Select a channel first');
  });
});

// ---------------------------------------------------------------------------
// Chat message actions menu
// ---------------------------------------------------------------------------
describe('chat message actions menu', () => {
  it('openMessageActionsMenu sets the active menu record id', () => {
    const { fn, store } = bindMethod('openMessageActionsMenu');
    fn('msg-1');
    expect(store.messageActionsMenuId).toBe('msg-1');
  });

  it('openMessageActionsMenu replaces previous menu id', () => {
    const { fn, store } = bindMethod('openMessageActionsMenu', {
      messageActionsMenuId: 'msg-old',
    });
    fn('msg-2');
    expect(store.messageActionsMenuId).toBe('msg-2');
  });

  it('closeMessageActionsMenu clears the active menu', () => {
    const { fn, store } = bindMethod('closeMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn();
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('isMessageActionsMenuOpen returns true for matching id', () => {
    const { fn } = bindMethod('isMessageActionsMenuOpen', {
      messageActionsMenuId: 'msg-1',
    });
    expect(fn('msg-1')).toBe(true);
    expect(fn('msg-2')).toBe(false);
  });

  it('isMessageActionsMenuOpen returns false when no menu open', () => {
    const { fn } = bindMethod('isMessageActionsMenuOpen', {
      messageActionsMenuId: null,
    });
    expect(fn('msg-1')).toBe(false);
  });

  it('toggleMessageActionsMenu opens when closed', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: null,
    });
    fn('msg-1');
    expect(store.messageActionsMenuId).toBe('msg-1');
  });

  it('toggleMessageActionsMenu closes when same id is open', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('toggleMessageActionsMenu switches to new id when different id is open', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-2');
    expect(store.messageActionsMenuId).toBe('msg-2');
  });

  it('inspectMessageSyncStatus calls openRecordStatusModal with chat_message family', () => {
    const openRecordStatusModal = vi.fn();
    const { fn, store } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [
        { record_id: 'msg-1', body: 'Hello world', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
      ],
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    expect(openRecordStatusModal).toHaveBeenCalledWith({
      familyId: 'chat_message',
      recordId: 'msg-1',
      label: 'Hello world',
    });
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('inspectMessageSyncStatus truncates long message body for label', () => {
    const openRecordStatusModal = vi.fn();
    const longBody = 'A'.repeat(60);
    const { fn } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [
        { record_id: 'msg-1', body: longBody, parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
      ],
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    const label = openRecordStatusModal.mock.calls[0][0].label;
    expect(label.length).toBeLessThanOrEqual(53);
    expect(label.endsWith('...')).toBe(true);
  });

  it('inspectMessageSyncStatus uses fallback label when message not found', () => {
    const openRecordStatusModal = vi.fn();
    const { fn } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [],
      messageActionsMenuId: null,
    });
    fn('msg-unknown');
    expect(openRecordStatusModal).toHaveBeenCalledWith({
      familyId: 'chat_message',
      recordId: 'msg-unknown',
      label: 'Chat message',
    });
  });

  it('copyMessageRawText writes the stored markdown body to clipboard', async () => {
    const copyTextToClipboard = vi.fn();
    const { fn, store } = bindMethod('copyMessageRawText', {
      copyTextToClipboard,
      messageActionsMenuId: 'msg-1',
      messages: [{
        record_id: 'msg-1',
        body: 'Hello ![image](storage://image-1)',
      }],
    });

    await fn('msg-1');

    expect(copyTextToClipboard).toHaveBeenCalledWith('Hello ![image](storage://image-1)');
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('copyThreadRawText writes a raw parent and replies transcript', async () => {
    const copyTextToClipboard = vi.fn();
    const { fn } = bindMethod('copyThreadRawText', {
      copyTextToClipboard,
      getSenderName: vi.fn((npub) => (npub === 'npub1a' ? 'Alice' : 'Bob')),
      messages: [
        { record_id: 'root-1', body: 'Root **markdown**', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2026-06-01T00:00:00.000Z' },
        { record_id: 'reply-1', body: 'Reply ![x](storage://img)', sender_npub: 'npub1b', parent_message_id: 'root-1', updated_at: '2026-06-01T00:01:00.000Z' },
      ],
    });

    await fn('root-1');

    expect(copyTextToClipboard.mock.calls[0][0]).toContain('Root **markdown**');
    expect(copyTextToClipboard.mock.calls[0][0]).toContain('Reply ![x](storage://img)');
  });

  it('openChatDeleteConfirm prepares a delete modal for messages', () => {
    const { fn, store } = bindMethod('openChatDeleteConfirm', {
      messageActionsMenuId: 'msg-1',
      messages: [{ record_id: 'msg-1', body: 'Hello' }],
    });

    fn('message', 'msg-1');

    expect(store.chatDeleteConfirm).toMatchObject({
      open: true,
      mode: 'message',
      recordId: 'msg-1',
      title: 'Delete Message',
    });
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('deleteChatMessageById deletes PG messages through Tower and hides them locally', async () => {
    const workspaceDbKey = 'chat-message-manager-delete-pg-message';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    deleteTowerPgMessageFromLocal.mockResolvedValue({
      record_id: 'pg-message-1',
      channel_id: 'ch1',
      body: 'Delete me',
      record_state: 'deleted',
      sync_status: 'synced',
      pg_backend: true,
    });

    try {
      const message = {
        record_id: 'pg-message-1',
        channel_id: 'ch1',
        body: 'Delete me',
        parent_message_id: null,
        record_state: 'active',
        sync_status: 'synced',
        pg_backend: true,
      };
      await upsertMessage(message);
      const { fn, store } = bindMethod('deleteChatMessageById', {
        messages: [message],
      });

      await fn('pg-message-1');

      expect(deleteTowerPgMessageFromLocal).toHaveBeenCalledWith(store, message);
      expect(store.mainFeedMessages).toEqual([]);
      expect(await getMessageById('pg-message-1')).toMatchObject({ record_state: 'deleted' });
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });

  it('deleteChatThreadByParentId deletes PG threads through Tower and hides parent plus replies locally', async () => {
    const workspaceDbKey = 'chat-message-manager-delete-pg-thread';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();
    isTowerPgBackendMode.mockReturnValue(true);
    deleteTowerPgThreadFromLocal.mockResolvedValue({ id: 'thread-1' });

    try {
      const parent = {
        record_id: 'root-1',
        channel_id: 'ch1',
        body: 'Root',
        parent_message_id: null,
        record_state: 'active',
        sync_status: 'synced',
        pg_backend: true,
        pg_thread_id: 'thread-1',
      };
      const reply = {
        record_id: 'reply-1',
        channel_id: 'ch1',
        body: 'Reply',
        parent_message_id: 'root-1',
        record_state: 'active',
        sync_status: 'synced',
        pg_backend: true,
        pg_thread_id: 'thread-1',
      };
      await upsertMessage(parent);
      await upsertMessage(reply);
      const { fn, store } = bindMethod('deleteChatThreadByParentId', {
        activeThreadId: 'root-1',
        messages: [parent, reply],
        closeThread: vi.fn(function closeThread() {
          this.activeThreadId = null;
        }),
      });

      await fn('root-1');

      expect(deleteTowerPgThreadFromLocal).toHaveBeenCalledWith(store, parent);
      expect(store.mainFeedMessages).toEqual([]);
      expect(store.threadMessages).toEqual([]);
      expect(await getMessageById('root-1')).toMatchObject({ record_state: 'deleted' });
      expect(await getMessageById('reply-1')).toMatchObject({ record_state: 'deleted' });
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });
});

function createDispatchReadyStore(overrides = {}) {
  return createStore({
    ...createChatThreadFlowDispatchState(),
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' },
    ],
    flows: [
      {
        record_id: 'flow-1',
        title: 'Flow One',
        scope_id: 'scope-flow',
        scope_l1_id: 'scope-flow',
        scope_policy_group_ids: ['policy:scope-flow'],
        group_ids: ['group:scope-flow'],
        record_state: 'active',
      },
      {
        record_id: 'flow-2',
        title: 'Flow Two',
        record_state: 'active',
      },
    ],
    chatThreadFlowDispatchSource: {
      channelId: 'channel-1',
      clickedMessageId: 'reply-1',
      threadRootMessageId: 'root-1',
      sourceSurface: 'thread_reply',
      dispatchedAt: '2026-04-21T13:28:21.377Z',
    },
    chatThreadFlowDispatchMessages: [
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root message',
        sender_npub: 'npub1root',
        updated_at: '2026-04-21T13:28:21.377Z',
      },
      {
        record_id: 'reply-1',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Reply message',
        sender_npub: 'npub1reply',
        updated_at: '2026-04-21T13:30:21.377Z',
      },
    ],
    ...overrides,
  });
}

describe('chat thread flow dispatch modal state', () => {
  it('opens from the canonical message set and leaves the plain flow-start path untouched', async () => {
    const threadRoot = {
      record_id: 'root-1',
      channel_id: 'channel-1',
      parent_message_id: null,
      body: 'Root message',
      updated_at: '2026-04-21T10:00:00.000Z',
      record_state: 'active',
    };
    const earlierReply = {
      record_id: 'reply-1',
      channel_id: 'channel-1',
      parent_message_id: 'root-1',
      body: 'First reply',
      updated_at: '2026-04-21T10:01:00.000Z',
      record_state: 'active',
    };
    const clickedReply = {
      record_id: 'reply-2',
      channel_id: 'channel-1',
      parent_message_id: 'root-1',
      body: 'Clicked reply',
      updated_at: '2026-04-21T10:02:00.000Z',
      record_state: 'active',
    };

    const { fn, store } = bindMethod('openChatThreadFlowDispatch', {
      channels: [{ record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' }],
      flows: [{ record_id: 'flow-1', title: 'Flow One', record_state: 'active' }],
      selectedChannelId: 'channel-1',
      mainFeedVisibleCount: 1,
      messageActionsMenuId: 'reply-2',
      showFlowStartConfirm: true,
      flowStartTarget: { record_id: 'existing-flow' },
      flowStartContext: 'keep-existing-start-context',
      messages: [
        threadRoot,
        earlierReply,
        clickedReply,
        {
          record_id: 'other-root',
          channel_id: 'channel-1',
          parent_message_id: null,
          body: 'Newest top-level message',
          updated_at: '2026-04-21T10:05:00.000Z',
          record_state: 'active',
        },
      ],
    });

    await fn('reply-2', 'thread_reply');

    expect(store.messageActionsMenuId).toBeNull();
    expect(store.showChatThreadFlowDispatchModal).toBe(true);
    expect(store.chatThreadFlowDispatchLoading).toBe(false);
    expect(store.chatThreadFlowDispatchSource).toEqual(expect.objectContaining({
      channelId: 'channel-1',
      clickedMessageId: 'reply-2',
      threadRootMessageId: 'root-1',
      sourceSurface: 'thread_reply',
    }));
    expect(store.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual([
      'root-1',
      'reply-1',
      'reply-2',
    ]);
    expect(store.chatThreadFlowDispatchSelectedFlowId).toBeNull();
    expect(store.chatThreadFlowDispatchManualScopeId).toBeNull();
    expect(store.chatThreadFlowDispatchResolvedScopeId).toBe('scope-channel');
    expect(store.chatThreadFlowDispatchScopeSource).toBe('channel');
    expect(store.chatThreadFlowDispatchResolvedScopeAssignment).toMatchObject({
      scope_id: 'scope-channel',
      write_group_ref: 'group:scope-channel',
    });
    expect(store.showFlowStartConfirm).toBe(true);
    expect(store.flowStartTarget).toEqual({ record_id: 'existing-flow' });
    expect(store.flowStartContext).toBe('keep-existing-start-context');
  });

  it('closeChatThreadFlowDispatch resets the full dispatch state block', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now(),
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
      chatThreadFlowDispatchMessages: [{ record_id: 'root-1' }],
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
      chatThreadFlowDispatchManualScopeId: 'scope-override',
      chatThreadFlowDispatchResolvedScopeId: 'scope-override',
      chatThreadFlowDispatchResolvedScopeAssignment: { scope_id: 'scope-override' },
      chatThreadFlowDispatchScopeSource: 'override',
      chatThreadFlowDispatchLaunchNotes: 'Launch note',
      chatThreadFlowDispatchPreview: 'Preview text',
      chatThreadFlowDispatchDirty: true,
      chatThreadFlowDispatchPreviewStale: true,
      chatThreadFlowDispatchLoading: true,
      chatThreadFlowDispatchSubmitting: true,
      chatThreadFlowDispatchError: 'Failed',
    });

    store.closeChatThreadFlowDispatch();

    const expected = createChatThreadFlowDispatchState();
    for (const [key, value] of Object.entries(expected)) {
      expect(store[key]).toEqual(value);
    }
  });

  it('ignores backdrop close clicks for the opening gesture window', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now(),
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
    });

    store.handleChatThreadFlowDispatchOverlayClick();

    expect(store.showChatThreadFlowDispatchModal).toBe(true);
    expect(store.chatThreadFlowDispatchSource).toEqual({ channelId: 'channel-1' });
  });

  it('allows backdrop close clicks after the opening gesture window passes', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now() - 500,
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
    });

    store.handleChatThreadFlowDispatchOverlayClick();

    expect(store.showChatThreadFlowDispatchModal).toBe(false);
    expect(store.chatThreadFlowDispatchSource).toBeNull();
  });

  it('keeps thread resolution consistent across main-feed, thread-parent, and thread-reply entry points', async () => {
    const baseOverrides = {
      channels: [{ record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' }],
      flows: [{ record_id: 'flow-1', title: 'Flow One', record_state: 'active' }],
      messages: [
        {
          record_id: 'root-1',
          channel_id: 'channel-1',
          parent_message_id: null,
          body: 'Root message',
          updated_at: '2026-04-21T10:00:00.000Z',
          record_state: 'active',
        },
        {
          record_id: 'reply-1',
          channel_id: 'channel-1',
          parent_message_id: 'root-1',
          body: 'Reply message',
          updated_at: '2026-04-21T10:02:00.000Z',
          record_state: 'active',
        },
      ],
    };

    const mainFeedStore = createStore(baseOverrides);
    const threadParentStore = createStore(baseOverrides);
    const threadReplyStore = createStore(baseOverrides);

    await mainFeedStore.openChatThreadFlowDispatch('root-1', 'main_feed');
    await threadParentStore.openChatThreadFlowDispatch('root-1', 'thread_parent');
    await threadReplyStore.openChatThreadFlowDispatch('reply-1', 'thread_reply');

    const expectedTranscript = ['root-1', 'reply-1'];

    expect(mainFeedStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(threadParentStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(threadReplyStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(mainFeedStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
    expect(threadParentStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
    expect(threadReplyStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
  });
});

describe('chat get it done modal state', () => {
  it('opens from a chat message with default scope and assignee', async () => {
    const { fn, store } = bindMethod('openChatGetItDone', {
      session: { npub: 'npub1me' },
      defaultAgentNpub: 'npub1agent',
      selectedChannelId: 'channel-1',
      channels: [{
        record_id: 'channel-1',
        scope_id: 'scope-channel',
        title: 'General',
        participant_npubs: ['npub1me', 'npub1agent'],
      }],
      messages: [{
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Can you turn this into work?',
        sender_npub: 'npub1me',
        updated_at: '2026-05-05T10:00:00.000Z',
        record_state: 'active',
      }],
    });

    await fn('root-1', 'main_feed');

    expect(store.showChatGetItDoneModal).toBe(true);
    expect(store.chatGetItDoneSource).toMatchObject({
      channelId: 'channel-1',
      clickedMessageId: 'root-1',
      threadRootMessageId: 'root-1',
      sourceSurface: 'main_feed',
    });
    expect(store.chatGetItDoneScopeId).toBe('scope-channel');
    expect(store.chatGetItDoneAssigneeNpub).toBe('npub1agent');
  });

  it('uses typeahead helpers for Get it done assignee and scope', async () => {
    const rememberPeople = vi.fn().mockResolvedValue(undefined);
    const scope = {
      record_id: 'scope-selected',
      title: 'Selected scope',
      level: 'project',
      breadcrumb: 'Product / Selected scope',
    };
    const store = createStore({
      chatGetItDoneAssigneeNpub: 'npub1agent',
      chatGetItDoneAssigneeQuery: 'pet',
      chatGetItDoneScopeId: 'scope-selected',
      chatGetItDoneScopeQuery: 'ops',
      rememberPeople,
      findPeopleSuggestions: vi.fn(() => [{
        npub: 'npub1pete',
        label: 'Pete',
        subtitle: 'npub1pete',
        avatarUrl: null,
      }]),
      scopesMap: new Map([['scope-selected', scope]]),
      scopePickerFlatFor: vi.fn(() => [{
        record_id: 'scope-ops',
        title: 'Ops',
        level: 'project',
        breadcrumb: 'Product / Ops',
      }]),
    });

    expect(store.chatGetItDoneAssigneeSuggestions.map((person) => person.npub)).toContain('npub1pete');
    expect(store.chatGetItDoneScopeLabel).toBe('Scope scope-selected');
    expect(store.chatGetItDoneScopeSuggestions.map((item) => item.record_id)).toEqual(['scope-ops']);

    await store.selectChatGetItDoneAssignee('npub1pete');
    store.selectChatGetItDoneScope('scope-ops');

    expect(store.chatGetItDoneAssigneeNpub).toBe('npub1pete');
    expect(store.chatGetItDoneAssigneeQuery).toBe('');
    expect(store.showChatGetItDoneAssigneePicker).toBe(false);
    expect(rememberPeople).toHaveBeenCalledWith(['npub1pete'], 'task-assignee');
    expect(store.chatGetItDoneScopeId).toBe('scope-ops');
    expect(store.chatGetItDoneScopeQuery).toBe('');
    expect(store.showChatGetItDoneScopePicker).toBe(false);
  });

  it('creates a ready task with chat source and thread excerpt', async () => {
    const addTask = vi.fn(async () => ({ record_id: 'task-new' }));
    const navigateTo = vi.fn();
    const openTaskDetail = vi.fn();
    const syncRoute = vi.fn();
    const store = createStore({
      session: { npub: 'npub1me' },
      selectedBoardId: 'scope-channel',
      currentWorkspaceSlug: 'be-free',
      selectedChannelId: 'channel-1',
      channels: [{ record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' }],
      messages: [
        {
          record_id: 'root-1',
          channel_id: 'channel-1',
          parent_message_id: null,
          body: 'Please fix the broken button.',
          sender_npub: 'npub1me',
          updated_at: '2026-05-05T10:00:00.000Z',
          record_state: 'active',
        },
        {
          record_id: 'reply-1',
          channel_id: 'channel-1',
          parent_message_id: 'root-1',
          body: 'The Get it done menu item does not create a task.',
          sender_npub: 'npub1agent',
          updated_at: '2026-05-05T10:05:00.000Z',
          record_state: 'active',
        },
      ],
      addTask,
      navigateTo,
      openTaskDetail,
      syncRoute,
    });

    await store.openChatGetItDone('reply-1', 'thread_reply');
    store.chatGetItDoneTitle = 'Fix Get it done from chat';
    store.chatGetItDoneAssigneeNpub = 'npub1agent';

    const result = await store.submitChatGetItDone();

    expect(result).toEqual({ record_id: 'task-new' });
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      state: 'ready',
      scopeId: 'scope-channel',
      assignedToNpub: 'npub1agent',
      sourceLinks: [{ type: 'chat', id: 'channel-1#root-1' }],
    }));
    const description = addTask.mock.calls[0][0].description;
    expect(description).toContain('Fix Get it done from chat');
    expect(description).toContain('/be-free/chat?scopeid=scope-channel&channelid=channel-1&threadid=root-1');
    expect(description).toContain('Name npub1agent: The Get it done menu item does not create a task.');
    expect(navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(openTaskDetail).toHaveBeenCalledWith('task-new');
    expect(syncRoute).toHaveBeenCalled();
  });

  it('creates an unscoped ready task when Get it done has no selected scope', async () => {
    const addTask = vi.fn(async () => ({ record_id: 'task-unscoped' }));
    const createDocument = vi.fn();
    const store = createStore({
      session: { npub: 'npub1me' },
      selectedBoardId: null,
      selectedChannelId: 'channel-1',
      channels: [{ record_id: 'channel-1', title: 'General' }],
      messages: [{
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Please write this up.',
        sender_npub: 'npub1me',
        updated_at: '2026-05-05T10:00:00.000Z',
        record_state: 'active',
      }],
      addTask,
      createDocument,
      navigateTo: vi.fn(),
      openTaskDetail: vi.fn(),
    });

    await store.openChatGetItDone('root-1', 'main_feed');
    store.chatGetItDoneTitle = 'Write this up';
    store.chatGetItDoneOutputType = 'doc';

    const result = await store.submitChatGetItDone();

    expect(result).toEqual({ record_id: 'task-unscoped' });
    expect(createDocument).not.toHaveBeenCalled();
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      state: 'ready',
      scopeId: '__unscoped__',
      deliverableLinks: [],
    }));
  });
});

describe('chat thread flow dispatch preview lifecycle', () => {
  it('regenerates the preview when flow selection changes while the preview is not dirty', () => {
    const store = createDispatchReadyStore();

    store.chatThreadFlowDispatchSelectedFlowId = 'flow-1';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toContain('selected_flow_id: flow-1');
    expect(store.chatThreadFlowDispatchPreview).toContain('selected_flow_title: Flow One');
    expect(store.chatThreadFlowDispatchDirty).toBe(false);
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(false);
  });

  it('regenerates the preview when the manual scope override changes while the preview is not dirty', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchManualScopeId = 'scope-override';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchResolvedScopeId).toBe('scope-override');
    expect(store.chatThreadFlowDispatchScopeSource).toBe('override');
    expect(store.chatThreadFlowDispatchPreview).toContain('resolved_scope_id: scope-override');
  });

  it('regenerates the preview when launch notes change while the preview is not dirty', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.chatThreadFlowDispatchLaunchNotes = 'Use the current repo and preserve acceptance criteria.';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toContain('Use the current repo and preserve acceptance criteria.');
  });

  it('marks the preview as dirty after a manual edit', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchPreview: 'Manually edited preview',
    });

    store.markChatThreadFlowDispatchPreviewEdited();

    expect(store.chatThreadFlowDispatchDirty).toBe(true);
  });

  it('marks the preview stale instead of overwriting manual edits when dependencies change later', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchPreview = 'Manual operator preview';
    store.markChatThreadFlowDispatchPreviewEdited();
    store.chatThreadFlowDispatchLaunchNotes = 'Updated launch note';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toBe('Manual operator preview');
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(true);
  });

  it('explicit regenerate clears the stale marker and rebuilds the preview', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchPreview = 'Manual operator preview';
    store.markChatThreadFlowDispatchPreviewEdited();
    store.chatThreadFlowDispatchLaunchNotes = 'Updated launch note';
    store.handleChatThreadFlowDispatchInputsChanged();

    const regenerated = store.regenerateChatThreadFlowDispatchPreview();

    expect(regenerated).toContain('Updated launch note');
    expect(store.chatThreadFlowDispatchPreview).toContain('Updated launch note');
    expect(store.chatThreadFlowDispatchDirty).toBe(false);
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(false);
  });
});
