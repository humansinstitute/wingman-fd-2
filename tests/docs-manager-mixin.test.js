import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acquireRecordCheckoutMock,
  completeStorageObjectMock,
  createTowerPgChannelDocMock,
  deleteTowerPgDocCommentMock,
  createTowerPgDocCommentMock,
  downloadStorageObjectMock,
  getTowerPgDocVersionsMock,
  isTowerPgBackendModeMock,
  prepareStorageObjectMock,
  prepareTowerPgStorageObjectMock,
  releaseRecordCheckoutMock,
  acquireTowerPgEditLeaseMock,
  releaseTowerPgEditLeaseMock,
  updateTowerPgDocMock,
  updateTowerPgDocCommentMock,
  uploadStorageObjectMock,
} = vi.hoisted(() => ({
  acquireRecordCheckoutMock: vi.fn(),
  acquireTowerPgEditLeaseMock: vi.fn(),
  completeStorageObjectMock: vi.fn(),
  createTowerPgChannelDocMock: vi.fn(),
  createTowerPgDocCommentMock: vi.fn(),
  deleteTowerPgDocCommentMock: vi.fn(),
  downloadStorageObjectMock: vi.fn(),
  getTowerPgDocVersionsMock: vi.fn(),
  isTowerPgBackendModeMock: vi.fn(() => false),
  prepareStorageObjectMock: vi.fn(),
  prepareTowerPgStorageObjectMock: vi.fn(),
  releaseRecordCheckoutMock: vi.fn(),
  releaseTowerPgEditLeaseMock: vi.fn(),
  updateTowerPgDocMock: vi.fn(),
  updateTowerPgDocCommentMock: vi.fn(),
  uploadStorageObjectMock: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  acquireRecordCheckout: acquireRecordCheckoutMock,
  acquireTowerPgEditLease: acquireTowerPgEditLeaseMock,
  completeStorageObject: completeStorageObjectMock,
  createTowerPgChannelAudioNote: vi.fn(),
  createTowerPgChannelDoc: createTowerPgChannelDocMock,
  createTowerPgDocComment: createTowerPgDocCommentMock,
  deleteTowerPgDocComment: deleteTowerPgDocCommentMock,
  createTowerPgChannelFile: vi.fn(),
  createTowerPgChannelMessage: vi.fn(),
  createTowerPgChannelTask: vi.fn(),
  downloadStorageObject: downloadStorageObjectMock,
  fetchRecordHistory: vi.fn(),
  getTowerPgChannelAudioNotes: vi.fn(),
  getTowerPgChannelDocs: vi.fn(),
  getTowerPgChannelFiles: vi.fn(),
  getTowerPgChannelMessages: vi.fn(),
  getTowerPgChannelTasks: vi.fn(),
  getTowerPgChannelThreads: vi.fn(),
  getTowerPgDocVersions: getTowerPgDocVersionsMock,
  getTowerPgScopeChannels: vi.fn(),
  getTowerPgScopeTasks: vi.fn(),
  getTowerPgWorkspaceScopes: vi.fn(),
  prepareStorageObject: prepareStorageObjectMock,
  prepareTowerPgStorageObject: prepareTowerPgStorageObjectMock,
  releaseRecordCheckout: releaseRecordCheckoutMock,
  releaseTowerPgEditLease: releaseTowerPgEditLeaseMock,
  renewTowerPgEditLease: vi.fn(),
  updateTowerPgDoc: updateTowerPgDocMock,
  updateTowerPgDocComment: updateTowerPgDocCommentMock,
  updateTowerPgTask: vi.fn(),
  updateTowerPgTaskState: vi.fn(),
  uploadStorageObject: uploadStorageObjectMock,
}));

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: isTowerPgBackendModeMock,
}));

import {
  docsManagerMixin,
  mergeDocumentSaveReferences,
} from '../src/docs-manager.js';
import {
  getDocumentById,
  getPendingWrites,
  openWorkspaceDb,
} from '../src/db.js';
import { isCheckoutHeld } from '../src/lock-managed-records.js';
import {
  DOCUMENT_CONTENT_STORAGE_FORMAT,
  DOCUMENT_CONTENT_STORAGE_MIME,
} from '../src/translators/docs.js';
import { FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT } from '../src/docs/editor/prosemirror-flightdeck-schema.js';
import {
  cacheGroupKey,
  clearCryptoContext,
  createGroupIdentity,
} from '../src/crypto/group-keys.js';
import { recordFamilyHash } from '../src/translators/chat.js';

function createStore(overrides = {}) {
  const store = {
    ...docsManagerMixin,
    lockManagedCheckoutSessions: {},
    documents: [],
    selectedDocType: null,
    selectedDocId: null,
    selectedDocCommentId: null,
    navSection: 'docs',
    mobileNavOpen: false,
    currentFolderId: null,
    docCommentBackfillAttemptsByDocId: {},
    session: { npub: 'npub1owner' },
    currentWorkspace: { creatorNpub: 'npub1owner' },
    docAutosaveState: 'saved',
    error: '',
    loadDocEditorFromSelection: vi.fn(),
    loadDocComments: vi.fn(),
    syncRoute: vi.fn(),
    ensureBackgroundSync: vi.fn(),
    containsInlineImageUploadToken: vi.fn(() => false),
    resolvePgWriteContext: vi.fn((context = {}) => {
      const channelId = context.channelId || store.selectedChannelId || store.selectedChannel?.record_id || null;
      const channel = channelId
        ? (store.channels || []).find((item) => item.record_id === channelId) || null
        : null;
      const scopeId = context.scopeId || channel?.scope_id || channel?.scope_l1_id || null;
      if (!scopeId || !channelId) return null;
      return {
        scopeId,
        channelId,
        threadId: context.threadId || null,
        channel,
      };
    }),
    patchDocumentLocal: vi.fn(function patchDocumentLocal(nextDocument) {
      const index = this.documents.findIndex((item) => item.record_id === nextDocument.record_id);
      if (index >= 0) {
        this.documents.splice(index, 1, { ...this.documents[index], ...nextDocument });
      } else {
        this.documents = [...this.documents, nextDocument];
      }
    }),
    buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
      workspaceServiceNpub: 'npub1workspace',
      userNpub: 'npub1owner',
      workspaceUserKeyNpub: 'npub1workspacekey',
      signerNpub: 'npub1workspacekey',
    })),
    ...overrides,
  };

  Object.defineProperty(store, 'selectedDocument', {
    configurable: true,
    get() {
      return store.documents.find((item) => item.record_id === store.selectedDocId) || null;
    },
  });

  Object.defineProperty(store, 'selectedDocComment', {
    configurable: true,
    get() {
      return (store.docComments || []).find((comment) => comment.record_id === store.selectedDocCommentId) || null;
    },
  });

  return store;
}

beforeEach(() => {
  isTowerPgBackendModeMock.mockReturnValue(false);
  createTowerPgDocCommentMock.mockReset();
  updateTowerPgDocCommentMock.mockReset();
  deleteTowerPgDocCommentMock.mockReset();
  getTowerPgDocVersionsMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
});

describe('docsManagerMixin record link save references', () => {
  it('preserves existing generic references when autosave adds parsed mentions', () => {
    const references = mergeDocumentSaveReferences({
      record_id: 'doc-1',
      source_links: [{ type: 'task', id: 'task-source' }],
      references: [
        { type: 'scope', id: 'scope-existing' },
        { type: 'task', id: 'task-source' },
      ],
      deliverable_links: [{ type: 'doc', id: 'doc-output' }],
    }, [
      { type: 'task', id: 'task-mentioned' },
      { type: 'scope', id: 'scope-existing' },
      { type: 'doc', id: 'doc-output' },
    ]);

    expect(references).toEqual([
      { type: 'scope', id: 'scope-existing' },
      { type: 'task', id: 'task-mentioned' },
    ]);
  });
});

describe('docsManagerMixin.getMissingDocGroupRefs', () => {
  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
    acquireTowerPgEditLeaseMock.mockReset();
    releaseTowerPgEditLeaseMock.mockReset();
  });

  afterEach(() => {
    clearCryptoContext();
    vi.restoreAllMocks();
  });

  it('returns missing group refs even when at least one group key is loaded', () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();

    const missing = docsManagerMixin.getMissingDocGroupRefs.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(missing).toEqual(['group-missing']);
  });

  it('allows write flow to proceed when at least one delivery group key is loaded', async () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();
    const missing = await docsManagerMixin.ensureDocGroupKeysLoaded.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(missing).toEqual([]);
  });

  it('fails write flow when no delivery group keys are loaded', async () => {
    const store = createStore();
    const missing = await docsManagerMixin.ensureDocGroupKeysLoaded.call(store, {
      group_ids: ['group-a', 'group-b'],
    });

    expect(missing).toEqual(['group-a', 'group-b']);
  });

  it('fails doc comment payload targets when any document group key is missing', () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();
    const groupIds = docsManagerMixin.getEncryptableDocCommentGroupIds.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(groupIds).toBeNull();
    expect(store.error).toContain('group-missing');
  });

  it('fails doc comment payload targets when no group keys are loaded', () => {
    const store = createStore();
    const groupIds = docsManagerMixin.getEncryptableDocCommentGroupIds.call(store, {
      group_ids: ['group-a', 'group-b'],
    });

    expect(groupIds).toBeNull();
    expect(store.error).toContain('Document comment write is missing group keys');
  });

  it('refreshes group keys before choosing doc comment payload targets', async () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const refreshedIdentity = createGroupIdentity();
    const refreshGroups = vi.fn(async () => {
      cacheGroupKey({
        group_id: 'group-refreshed',
        group_npub: 'npub1refreshedgroup',
        nsec: refreshedIdentity.nsec,
      });
    });
    const store = createStore({ refreshGroups });

    const groupIds = await docsManagerMixin.getEncryptableDocCommentGroupIdsForWrite.call(store, {
      group_ids: ['group-loaded', 'group-refreshed'],
    });

    expect(refreshGroups).toHaveBeenCalledWith({ force: true });
    expect(groupIds).toEqual(['group-loaded', 'group-refreshed']);
  });
});

describe('docsManagerMixin comment loading', () => {
  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
  });

  afterEach(() => {
    clearCryptoContext();
    vi.restoreAllMocks();
  });

  it('applies comments returned by an explicit backfill from the live-query path', async () => {
    const backfilledComment = {
      record_id: 'comment-1',
      target_record_id: 'doc-1',
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: null,
      body: 'Visible after backfill',
      sender_npub: 'npub1other',
      record_state: 'active',
      version: 1,
      updated_at: '2026-04-26T00:00:00.000Z',
    };
    const store = createStore({
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      docComments: [],
      rememberPeople: vi.fn(async () => {}),
      scheduleDocCommentConnectorUpdate: vi.fn(),
      scheduleStorageImageHydration: vi.fn(),
      backfillDocCommentsFromBackend: vi.fn(async () => [backfilledComment]),
    });

    await store.applyDocComments([], { allowBackfill: true });

    expect(store.backfillDocCommentsFromBackend).toHaveBeenCalledWith('doc-1', recordFamilyHash('document'));
    expect(store.docComments).toEqual([backfilledComment]);
  });
});

describe('docsManagerMixin comment drawer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the doc comments drawer collapsed when opening a document normally', () => {
    const store = createStore({
      documents: [{ record_id: 'doc-1', parent_directory_id: 'dir-1' }],
      docCommentsVisible: true,
    });

    store.openDoc('doc-1');

    expect(store.docCommentsVisible).toBe(false);
    expect(store.selectedDocCommentId).toBeNull();
  });

  it('uses the shared PG doc prefetch when opening documents', async () => {
    isTowerPgBackendModeMock.mockReturnValue(true);
    const prefetchFlightDeckDoc = vi.fn(async () => ({
      record_id: 'doc-1',
      title: 'Fresh doc',
      content: '# Fresh',
      record_state: 'active',
    }));
    const refreshOpenDocFromLatestDocument = vi.fn();
    const store = createStore({
      documents: [{ record_id: 'doc-1', title: 'Cached doc', content: '', record_state: 'active' }],
      prefetchFlightDeckDoc,
      refreshOpenDocFromLatestDocument,
    });

    store.openDoc('doc-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(prefetchFlightDeckDoc).toHaveBeenCalledWith('doc-1');
    expect(refreshOpenDocFromLatestDocument).toHaveBeenCalledWith({ force: true });
  });

  it('clears previous document comments immediately when switching documents', () => {
    const store = createStore({
      documents: [
        { record_id: 'doc-1', parent_directory_id: 'dir-1' },
        { record_id: 'doc-2', parent_directory_id: 'dir-2' },
      ],
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      selectedDocCommentId: 'comment-1',
      docComments: [{
        record_id: 'comment-1',
        target_record_id: 'doc-1',
        target_record_family_hash: recordFamilyHash('document'),
        body: 'Previous doc comment',
        record_state: 'active',
      }],
      docCommentAudioDrafts: [{ draft_id: 'audio-1' }],
      docCommentReplyAudioDrafts: [{ draft_id: 'audio-2' }],
      stopDocCommentsLiveQuery: vi.fn(),
      clearDocCommentConnector: vi.fn(),
    });

    store.openDoc('doc-2');

    expect(store.docComments).toEqual([]);
    expect(store.selectedDocCommentId).toBeNull();
    expect(store.docCommentAudioDrafts).toEqual([]);
    expect(store.docCommentReplyAudioDrafts).toEqual([]);
    expect(store.stopDocCommentsLiveQuery).toHaveBeenCalled();
    expect(store.clearDocCommentConnector).toHaveBeenCalled();
    expect(store.loadDocComments).toHaveBeenCalledWith('doc-2', { allowBackfill: true });
  });

  it('opens the doc comments drawer when routing directly to a comment', () => {
    const store = createStore({
      documents: [{ record_id: 'doc-1', parent_directory_id: 'dir-1' }],
      docCommentsVisible: false,
    });

    store.openDoc('doc-1', { commentId: 'comment-1' });

    expect(store.docCommentsVisible).toBe(true);
    expect(store.selectedDocCommentId).toBe('comment-1');
  });

  it('can open a document inline without navigating, syncing, or comment backfill', () => {
    const store = createStore({
      documents: [{ record_id: 'doc-1', parent_directory_id: 'dir-1' }],
      navSection: 'chat',
      docCommentsVisible: false,
    });

    store.openDoc('doc-1', {
      syncRoute: false,
      navigate: false,
      ensureSync: false,
      allowCommentBackfill: false,
      showComments: true,
    });

    expect(store.navSection).toBe('chat');
    expect(store.docCommentsVisible).toBe(true);
    expect(store.syncRoute).not.toHaveBeenCalled();
    expect(store.ensureBackgroundSync).not.toHaveBeenCalled();
    expect(store.loadDocComments).toHaveBeenCalledWith('doc-1', { allowBackfill: false });
  });

  it('opens an inline anchored composer instead of the legacy modal', () => {
    const store = createStore({
      selectedDocId: 'doc-1',
      docCommentsVisible: false,
      selectedDocCommentId: 'comment-1',
      showDocCommentModal: false,
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    store.openDocCommentModal({ id: 'block-1-3', start_line: 3 });

    expect(store.docCommentsVisible).toBe(true);
    expect(store.docCommentAnchorLine).toBe(3);
    expect(store.docCommentAnchorBlockId).toBe('block-1-3');
    expect(store.selectedDocCommentId).toBeNull();
    expect(store.showDocCommentModal).toBe(false);
  });

  it('uses the selected read-mode block when the drawer plus starts a comment', () => {
    const blocks = [
      { id: 'block-1-1', start_line: 1, raw: 'First' },
      { id: 'block-1-4', start_line: 4, raw: 'Second' },
    ];
    const store = createStore({
      selectedDocId: 'doc-1',
      docEditorMode: 'preview',
      docEditorBlocks: blocks,
      docSelectedBlockId: null,
      scheduleDocCommentConnectorUpdate: vi.fn(),
      syncRoute: vi.fn(),
      clearDocCommentConnector: vi.fn(),
    });

    store.selectDocBlockForComment(blocks[1], 1);
    store.startDocCommentPlacement();

    expect(store.docCommentsVisible).toBe(true);
    expect(store.docSelectedBlockId).toBe('block-1-4');
    expect(store.docCommentAnchorLine).toBe(4);
    expect(store.docCommentAnchorBlockId).toBe('block-1-4');
    expect(store.selectedDocCommentId).toBeNull();
  });

  it('uses the active edit-mode block when the drawer plus starts a comment', () => {
    const blocks = [
      { id: 'block-1-1', start_line: 1, raw: 'First' },
      { id: 'block-1-6', start_line: 6, raw: 'Editing' },
    ];
    const store = createStore({
      selectedDocId: 'doc-1',
      docEditorMode: 'block',
      docEditorBlocks: blocks,
      docEditingBlockIndex: 1,
      docSelectedBlockId: null,
      scheduleDocCommentConnectorUpdate: vi.fn(),
      syncRoute: vi.fn(),
      clearDocCommentConnector: vi.fn(),
    });

    store.startDocCommentPlacement();

    expect(store.docSelectedBlockId).toBe('block-1-6');
    expect(store.docCommentAnchorLine).toBe(6);
    expect(store.docCommentAnchorBlockId).toBe('block-1-6');
  });

  it('lists root comments and replies separately for the drawer', () => {
    const store = createStore({
      docComments: [
        { record_id: 'reply-1', parent_comment_id: 'root-1', record_state: 'active', updated_at: '2026-01-01T00:02:00Z' },
        { record_id: 'root-2', parent_comment_id: null, record_state: 'deleted', updated_at: '2026-01-01T00:03:00Z' },
        { record_id: 'root-1', parent_comment_id: null, record_state: 'active', updated_at: '2026-01-01T00:01:00Z' },
      ],
    });

    expect(store.getRootDocComments().map((comment) => comment.record_id)).toEqual(['root-1']);
    expect(store.getDocCommentReplies('root-1').map((comment) => comment.record_id)).toEqual(['reply-1']);
  });

  it('counts block comments from root threads without double-counting replies', () => {
    const store = createStore({
      docEditorBlocks: [{ id: 'block-1', start_line: 1 }],
      docComments: [
        {
          record_id: 'root-1',
          parent_comment_id: null,
          anchor_block_id: 'block-1',
          anchor_line_number: 1,
          record_state: 'active',
          comment_status: 'open',
          updated_at: '2026-01-01T00:01:00Z',
        },
        {
          record_id: 'reply-1',
          parent_comment_id: 'root-1',
          anchor_block_id: 'block-1',
          anchor_line_number: 1,
          record_state: 'active',
          comment_status: 'open',
          updated_at: '2026-01-01T00:02:00Z',
        },
      ],
    });

    expect(store.getDocCommentsForBlock(store.docEditorBlocks[0]).map((comment) => comment.record_id)).toEqual(['root-1']);
    expect(store.getDocBlockCommentCount(store.docEditorBlocks[0])).toBe(2);
  });

  it('orders root comment threads by document block position before timestamp', () => {
    const store = createStore({
      docEditorBlocks: [
        { id: 'block-1', start_line: 1 },
        { id: 'block-2', start_line: 8 },
        { id: 'block-3', start_line: 14 },
      ],
      docComments: [
        {
          record_id: 'late-block-1',
          parent_comment_id: null,
          anchor_block_id: 'block-1',
          anchor_line_number: 1,
          record_state: 'active',
          created_at: '2026-01-01T00:04:00Z',
          updated_at: '2026-01-01T00:04:00Z',
        },
        {
          record_id: 'early-block-3',
          parent_comment_id: null,
          anchor_block_id: 'block-3',
          anchor_line_number: 14,
          record_state: 'active',
          created_at: '2026-01-01T00:01:00Z',
          updated_at: '2026-01-01T00:01:00Z',
        },
        {
          record_id: 'line-fallback-block-2',
          parent_comment_id: null,
          anchor_block_id: null,
          anchor_line_number: 8,
          record_state: 'active',
          created_at: '2026-01-01T00:03:00Z',
          updated_at: '2026-01-01T00:03:00Z',
        },
      ],
    });

    expect(store.getRootDocComments().map((comment) => comment.record_id)).toEqual([
      'late-block-1',
      'line-fallback-block-2',
      'early-block-3',
    ]);
  });
});

describe('docsManagerMixin checkout orchestration', () => {
  const documentFamilyHash = recordFamilyHash('document');

  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases the previous document checkout when switching records', () => {
    const previousRecord = { record_id: 'doc-a', parent_directory_id: 'dir-a', sync_status: 'synced' };
    const nextRecord = { record_id: 'doc-b', parent_directory_id: 'dir-b', sync_status: 'synced' };
    const store = createStore({
      documents: [previousRecord, nextRecord],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      releaseLockManagedCheckout: vi.fn(async () => true),
    });

    store.openDoc('doc-b');

    expect(store.releaseLockManagedCheckout).toHaveBeenCalledWith(
      previousRecord,
      documentFamilyHash,
      { reportError: false },
    );
    expect(store.selectedDocId).toBe('doc-b');
    expect(store.currentFolderId).toBe('dir-b');
  });

  it('releases the previous PG document lease when switching records', () => {
    isTowerPgBackendModeMock.mockReturnValue(true);
    releaseTowerPgEditLeaseMock.mockResolvedValueOnce({ released: true });
    const previousRecord = { record_id: 'doc-a', parent_directory_id: 'dir-a', pg_backend: true, sync_status: 'synced' };
    const nextRecord = { record_id: 'doc-b', parent_directory_id: 'dir-b', pg_backend: true, sync_status: 'synced' };
    const store = createStore({
      documents: [previousRecord, nextRecord],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1owner',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
        pgBackendMode: true,
      },
      pgEditLeaseSessions: {
        'document:doc-a': { lease: { id: 'lease-doc-a', lease_token: 'token-doc-a' } },
      },
      releaseLockManagedCheckout: vi.fn(async () => true),
    });

    store.openDoc('doc-b');

    expect(releaseTowerPgEditLeaseMock).toHaveBeenCalledWith('workspace-1', 'lease-doc-a', {
      lease_token: 'token-doc-a',
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.releaseLockManagedCheckout).not.toHaveBeenCalled();
    expect(store.selectedDocId).toBe('doc-b');
    expect(store.currentFolderId).toBe('dir-b');
  });

  it('does not release a held checkout while a local write is still pending', async () => {
    const store = createStore();
    store.setLockManagedCheckoutSession('doc-a', documentFamilyHash, {
      acquireState: 'held',
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const released = await store.releaseLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'pending' },
      documentFamilyHash,
    );

    expect(released).toBe(false);
    expect(releaseRecordCheckoutMock).not.toHaveBeenCalled();
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)?.checkout?.checkout_id).toBe('checkout-1');
  });

  it('reuses the same idempotency key across acquire retries for the same edit intent', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('edit-session-1');
    const conflict = new Error('conflict');
    conflict.classification = 'checkout_conflict';
    acquireRecordCheckoutMock
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        checkout: {
          state: 'checked_out',
          checkout_id: 'checkout-2',
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      });

    const store = createStore();
    const record = { record_id: 'doc-a', sync_status: 'synced', version: 1 };

    await expect(
      store.ensureLockManagedCheckout(record, documentFamilyHash, { intent: 'edit', reportError: false }),
    ).rejects.toMatchObject({ classification: 'checkout_conflict' });

    const checkout = await store.ensureLockManagedCheckout(record, documentFamilyHash, {
      intent: 'edit',
      reportError: false,
    });

    expect(checkout?.checkout_id).toBe('checkout-2');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(2);
    expect(acquireRecordCheckoutMock.mock.calls[0][0].idempotencyKey).toBe('edit-session-1');
    expect(acquireRecordCheckoutMock.mock.calls[1][0].idempotencyKey).toBe('edit-session-1');
  });

  it('acquires checkout before entering document edit mode', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-doc-edit-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const record = { record_id: 'doc-a', sync_status: 'synced', version: 1 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      setDocEditorMode: vi.fn(),
    });

    const entered = await store.enterSelectedDocEditMode('block');

    expect(entered).toBe(true);
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'doc-a',
      recordFamilyHash: documentFamilyHash,
    }));
    expect(store.setDocEditorMode).toHaveBeenCalledWith('block');
  });

  it('uses the rich Tiptap editor as the default document edit mode', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-doc-rich-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const record = { record_id: 'doc-rich', sync_status: 'synced', version: 1 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-rich',
      setDocEditorMode: vi.fn(),
    });

    const entered = await store.enterSelectedDocEditMode();

    expect(entered).toBe(true);
    expect(store.setDocEditorMode).toHaveBeenCalledWith('rich');
  });

  it('acquires a PG edit lease before entering synced PG document edit mode', async () => {
    isTowerPgBackendModeMock.mockReturnValue(true);
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue('doc-renew-timer');
    acquireTowerPgEditLeaseMock.mockResolvedValueOnce({
      lease: { id: 'lease-doc-1', lease_token: 'doc-token-1' },
    });

    const record = { record_id: 'doc-pg', pg_backend: true, sync_status: 'synced', version: 1 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-pg',
      pgEditLeaseSessions: {},
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1owner',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
        pgBackendMode: true,
      },
      setDocEditorMode: vi.fn(),
    });

    const entered = await store.enterSelectedDocEditMode('block');

    expect(entered).toBe(true);
    expect(acquireTowerPgEditLeaseMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      entity_type: 'document',
      entity_id: 'doc-pg',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(acquireRecordCheckoutMock).not.toHaveBeenCalled();
    expect(store.pgEditLeaseSessions['document:doc-pg'].lease.lease_token).toBe('doc-token-1');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(store.setDocEditorMode).toHaveBeenCalledWith('block');
  });

  it('allows delegated workspace-key checkout attempts when local creator differs', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-delegated-owner-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const store = createStore({
      session: { npub: 'npub1owneruser' },
      currentWorkspace: { creatorNpub: 'npub1workspaceservice' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
        workspaceServiceNpub: 'npub1workspaceservice',
        userNpub: 'npub1owneruser',
        workspaceUserKeyNpub: 'npub1workspacekey',
        signerNpub: 'npub1workspacekey',
      })),
    });

    const checkout = await store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    );

    expect(checkout?.checkout_id).toBe('checkout-delegated-owner-1');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(1);
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      identityContext: expect.objectContaining({
        userNpub: 'npub1owneruser',
        workspaceUserKeyNpub: 'npub1workspacekey',
      }),
    }));
  });

  it('maps Tower non-owner checkout_required rejections after acquire attempt', async () => {
    const forbidden = new Error('not owner');
    forbidden.classification = 'edit_policy_forbidden';
    acquireRecordCheckoutMock.mockRejectedValueOnce(forbidden);
    const store = createStore({
      session: { npub: 'npub1collaborator' },
      currentWorkspace: { creatorNpub: 'npub1workspaceservice' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
        workspaceServiceNpub: 'npub1workspace',
        userNpub: 'npub1collaborator',
        workspaceUserKeyNpub: 'npub1workspacekey',
        signerNpub: 'npub1workspacekey',
      })),
    });

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'edit_policy_forbidden' });

    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(1);
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'edit_policy_forbidden',
    });
  });

  it('blocks missing checkout identity before acquire', async () => {
    const missingIdentity = new Error('missing workspace key');
    missingIdentity.classification = 'workspace_key_missing';
    const store = createStore({
      session: null,
      currentWorkspace: { creatorNpub: 'npub1owner' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => {
        throw missingIdentity;
      }),
    });

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'workspace_key_missing' });

    expect(acquireRecordCheckoutMock).not.toHaveBeenCalled();
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'workspace_key_missing',
    });
  });

  it('maps blocked checkout errors to deterministic UI state', async () => {
    const conflict = new Error('record checked out');
    conflict.classification = 'record_checked_out';
    conflict.response = {
      checkout: {
        state: 'checked_out',
        checked_out_by_user_npub: 'npub1other',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    acquireRecordCheckoutMock.mockRejectedValueOnce(conflict);

    const store = createStore();

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'record_checked_out' });

    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'record_checked_out',
      message: expect.stringContaining('Checked out by npub1other'),
    });
  });

  it('routes directory mutations through checkout_required acquire', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-dir-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore();
    const checkout = await store.ensureLockManagedCheckout(
      { record_id: 'dir-a', sync_status: 'synced', version: 1 },
      recordFamilyHash('directory'),
      { reportError: false },
    );

    expect(checkout?.checkout_id).toBe('checkout-dir-1');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'dir-a',
      recordFamilyHash: recordFamilyHash('directory'),
    }));
  });

  it('can opt task edits into checkout_required through policy config', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-task-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore({
      recordCheckoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
    });
    const envelope = {
      record_id: 'task-a',
      record_family_hash: recordFamilyHash('task'),
      version: 2,
    };

    const managedEnvelope = await store.attachCheckoutRequiredCheckoutToEnvelope(
      { record_id: 'task-a', sync_status: 'synced', version: 1 },
      envelope,
      { reportError: false },
    );

    expect(managedEnvelope.checkout).toEqual({
      checkout_id: 'checkout-task-1',
      consume_on_success: true,
    });
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'task-a',
      recordFamilyHash: recordFamilyHash('task'),
    }));
  });

  it('can opt one task edit envelope into checkout_required without changing store defaults', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-task-local-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore();
    const envelope = {
      record_id: 'task-local',
      record_family_hash: recordFamilyHash('task'),
      version: 2,
    };

    expect(store.isCheckoutRequiredRecordFamily(recordFamilyHash('task'))).toBe(false);

    const managedEnvelope = await store.attachCheckoutRequiredCheckoutToEnvelope(
      { record_id: 'task-local', sync_status: 'synced', version: 1 },
      envelope,
      {
        reportError: false,
        checkoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
      },
    );

    expect(managedEnvelope.checkout).toEqual({
      checkout_id: 'checkout-task-local-1',
      consume_on_success: true,
    });
    expect(store.isCheckoutRequiredRecordFamily(recordFamilyHash('task'))).toBe(false);
  });

  it('saveAndExitSelectedDocEditMode saves, returns to read mode, and force-releases checkout', async () => {
    const record = { record_id: 'doc-a', sync_status: 'pending', version: 2 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      docEditorMode: 'block',
      docEditingBlockIndex: 1,
      commitDocBlockEdit: vi.fn(),
      saveSelectedDocItem: vi.fn(async () => record),
      setDocEditorMode: vi.fn(),
      releaseLockManagedCheckout: vi.fn(async () => true),
    });

    const saved = await store.saveAndExitSelectedDocEditMode();

    expect(saved).toBe(true);
    expect(store.commitDocBlockEdit).toHaveBeenCalledTimes(1);
    expect(store.saveSelectedDocItem).toHaveBeenCalledWith({ autosave: false });
    expect(store.setDocEditorMode).toHaveBeenCalledWith('preview');
    expect(store.releaseLockManagedCheckout).toHaveBeenCalledWith(
      record,
      documentFamilyHash,
      { reportError: false, force: true },
    );
  });
});

describe('docsManagerMixin document block editor sizing', () => {
  it('uses the rendered block height as the editor minimum when editing starts', () => {
    const store = createStore({
      docEditorMode: 'block',
      docEditorBlocks: [{ id: 'block-1', raw: '## Rendered heading\n\nRendered body', start_line: 1 }],
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });
    const previewEl = {
      getBoundingClientRect: () => ({ height: 214.2 }),
    };

    store.startDocBlockEdit(0, previewEl);

    expect(store.docEditingBlockIndex).toBe(0);
    expect(store.docBlockBuffer).toBe('## Rendered heading\n\nRendered body');
    expect(store.docBlockEditorMinHeightPx).toBe(215);
    expect(store.getDocBlockEditorStyle()).toEqual({ minHeight: '215px' });
  });

  it('keeps textarea height at least as tall as the rendered block while autosizing', () => {
    const store = createStore({ docBlockEditorMinHeightPx: 180 });
    const textarea = { style: {}, scrollHeight: 240 };

    store.resizeDocBlockEditor(textarea);

    expect(textarea.style.minHeight).toBe('180px');
    expect(textarea.style.height).toBe('240px');

    textarea.scrollHeight = 120;
    store.resizeDocBlockEditor(textarea);

    expect(textarea.style.height).toBe('180px');
  });
});

describe('docsManagerMixin canonical row normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads document content for envelope storage', async () => {
    prepareStorageObjectMock.mockResolvedValue({ object_id: 'storage-doc-1', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});

    const store = createStore({
      workspaceOwnerNpub: 'npub1workspace',
      _resolveDocGroupRef: (value) => String(value || '').trim() || null,
    });
    const contentModel = {
      content: 'Transcript line\n'.repeat(6000),
      content_format: 'block_document_v1',
      content_blocks: [{ id: 'blk-1', type: 'markdown', text: 'Transcript line'.repeat(6000), attrs: {} }],
    };

    const payload = await store.prepareDocumentContentForEnvelope({
      record_id: 'doc-large',
      owner_npub: 'npub1workspace',
      title: 'Transcript',
      write_group_ref: 'group-1',
      shares: [],
    }, contentModel, ['group-1']);

    expect(prepareStorageObjectMock).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1workspace',
      owner_group_id: 'group-1',
      access_group_ids: ['group-1'],
      content_type: DOCUMENT_CONTENT_STORAGE_MIME,
    }));
    expect(uploadStorageObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ object_id: 'storage-doc-1' }),
      expect.any(Uint8Array),
      DOCUMENT_CONTENT_STORAGE_MIME,
    );
    expect(completeStorageObjectMock).toHaveBeenCalledWith('storage-doc-1', expect.objectContaining({
      size_bytes: expect.any(Number),
      sha256_hex: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(payload.content_storage_object_id).toBe('storage-doc-1');
    expect(payload.content_storage_format).toBe(DOCUMENT_CONTENT_STORAGE_FORMAT);
    expect(payload.content).toHaveLength(8192);
    expect(payload.content_blocks).toEqual([]);
  });

  it('uploads small document content for envelope storage', async () => {
    prepareStorageObjectMock.mockResolvedValue({ object_id: 'storage-small-doc-1', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});

    const store = createStore({
      workspaceOwnerNpub: 'npub1workspace',
      _resolveDocGroupRef: (value) => String(value || '').trim() || null,
    });
    const contentModel = {
      content: 'Short note',
      content_format: 'block_document_v1',
      content_blocks: [{ id: 'blk-1', type: 'markdown', text: 'Short note', attrs: {} }],
    };

    const payload = await store.prepareDocumentContentForEnvelope({
      record_id: 'doc-small',
      owner_npub: 'npub1workspace',
      title: 'Small note',
      write_group_ref: 'group-1',
      shares: [],
    }, contentModel, ['group-1']);

    expect(prepareStorageObjectMock).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1workspace',
      content_type: DOCUMENT_CONTENT_STORAGE_MIME,
      file_name: 'Small_note-doc-small.document.json',
    }));
    expect(uploadStorageObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ object_id: 'storage-small-doc-1' }),
      expect.any(Uint8Array),
      DOCUMENT_CONTENT_STORAGE_MIME,
    );
    expect(payload.content_storage_object_id).toBe('storage-small-doc-1');
    expect(payload.content_storage_format).toBe(DOCUMENT_CONTENT_STORAGE_FORMAT);
    expect(payload.content).toBe('Short note');
    expect(payload.content_blocks).toEqual([]);
  });

  it('builds ProseMirror document content when saving legacy block edits', () => {
    const store = createStore({
      selectedDocType: 'document',
      selectedDocId: 'doc-prose',
      documents: [{
        record_id: 'doc-prose',
        title: 'Legacy block doc',
        content: 'Old body',
        content_blocks: [{ id: 'old-block', type: 'markdown', text: 'Old body', attrs: {} }],
      }],
      docEditorMode: 'block',
      docEditorContent: 'Updated body',
      docEditorBlocks: [{ id: 'block-1', type: 'markdown', text: 'Updated body', attrs: {} }],
    });

    const contentModel = store.buildSelectedDocContentModel();

    expect(contentModel.content_format).toBe(FLIGHTDECK_PROSEMIRROR_CONTENT_FORMAT);
    expect(contentModel.editor_state).toMatchObject({ type: 'doc' });
    expect(contentModel.content).toContain('Updated body');
  });

  it('creates PG documents through Tower without encrypted pending writes', async () => {
    const wsDb = openWorkspaceDb('npub1signedinactor');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    prepareTowerPgStorageObjectMock.mockResolvedValue({ object_id: 'storage-pg-doc-1', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});
    createTowerPgChannelDocMock.mockResolvedValue({
      doc: {
        id: 'pg-doc-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'storage-pg-doc-1',
        title: 'PG document',
        metadata: { thread_id: 'thread-1' },
        row_version: 1,
      },
    });

    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      selectedChannelId: 'channel-1',
      selectedBoardId: '',
      channels: [{ record_id: 'channel-1', scope_id: 'scope-1', scope_l1_id: 'scope-1', record_state: 'active' }],
      getInheritedDirectoryShares: vi.fn(() => []),
      buildDocAccessForScope: vi.fn(() => ({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: null,
        shares: [],
        group_ids: [],
      })),
      refreshDocuments: vi.fn(async function refreshDocuments() {
        this.documents = [{
          record_id: 'pg-doc-1',
          title: 'PG document',
          pg_backend: true,
          pg_channel_id: 'channel-1',
          pg_thread_id: 'thread-1',
        }];
        return this.documents;
      }),
      openDoc: vi.fn(),
    });

    const row = await store.createDocument('PG document', {
      scopeId: 'scope-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });

    expect(prepareStorageObjectMock).not.toHaveBeenCalled();
    expect(prepareTowerPgStorageObjectMock).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      owner_npub: 'npub1pgworkspace',
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(createTowerPgChannelDocMock).toHaveBeenCalledWith('workspace-1', 'channel-1', expect.objectContaining({
      title: 'PG document',
      storage_object_id: 'storage-pg-doc-1',
      metadata: { thread_id: 'thread-1' },
    }), { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(row).toMatchObject({ record_id: 'pg-doc-1', pg_channel_id: 'channel-1', pg_thread_id: 'thread-1' });
    expect(await getPendingWrites()).toEqual([]);
  });

  it('keeps offline-created PG documents local and editable until Tower accepts them', async () => {
    const wsDb = openWorkspaceDb('npub1signedinactor');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: false },
    });
    isTowerPgBackendModeMock.mockReturnValue(true);
    prepareTowerPgStorageObjectMock.mockResolvedValue({ object_id: 'storage-pg-doc-local', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});
    createTowerPgChannelDocMock.mockRejectedValueOnce(new Error('offline'));

    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      selectedChannelId: 'channel-1',
      selectedBoardId: '',
      channels: [{ record_id: 'channel-1', scope_id: 'scope-1', scope_l1_id: 'scope-1', record_state: 'active' }],
      getInheritedDirectoryShares: vi.fn(() => []),
      buildDocAccessForScope: vi.fn(() => ({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: null,
        shares: [],
        group_ids: [],
      })),
      refreshDocuments: vi.fn(async function refreshDocuments() {
        return this.documents;
      }),
      openDoc: vi.fn(function openDoc(recordId) {
        this.selectedDocType = 'document';
        this.selectedDocId = recordId;
      }),
    });

    const row = await store.createDocument('Offline PG document', {
      scopeId: 'scope-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
    });

    expect(row).toMatchObject({
      pg_backend: true,
      pg_record_type: 'doc',
      sync_status: 'failed',
      pg_channel_id: 'channel-1',
      pg_thread_id: 'thread-1',
    });
    expect(store.error).toBe('PG document saved locally. Reconnect to sync it.');
    expect(await getPendingWrites()).toEqual([]);

    store.docEditorTitle = 'Offline PG document edited';
    store.docEditorBlocks = [{ id: 'block-1', type: 'markdown', text: 'Edited while offline', attrs: {} }];
    const edited = await store.saveSelectedDocItem({ autosave: false });

    expect(edited).toMatchObject({
      record_id: row.record_id,
      title: 'Offline PG document edited',
      content: 'Edited while offline',
      sync_status: 'failed',
      pg_backend: true,
    });
    expect(createTowerPgChannelDocMock).toHaveBeenCalledTimes(1);
    expect(await getPendingWrites()).toEqual([]);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
    createTowerPgChannelDocMock.mockResolvedValueOnce({
      doc: {
        id: 'pg-doc-accepted',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        storage_object_id: 'storage-pg-doc-local',
        title: 'Offline PG document synced',
        metadata: { thread_id: 'thread-1' },
        row_version: 1,
      },
    });

    store.docEditorTitle = 'Offline PG document synced';
    store.docEditorBlocks = [{ id: 'block-1', type: 'markdown', text: 'Synced after reconnect', attrs: {} }];
    const accepted = await store.saveSelectedDocItem({ autosave: false });

    expect(accepted).toMatchObject({
      record_id: 'pg-doc-accepted',
      title: 'Offline PG document synced',
      sync_status: 'synced',
      pg_backend: true,
    });
    expect(await getDocumentById(row.record_id)).toBeUndefined();
    expect(await getDocumentById('pg-doc-accepted')).toMatchObject({
      title: 'Offline PG document synced',
      content: 'Synced after reconnect',
    });
    expect(store.selectedDocId).toBe('pg-doc-accepted');
    expect(store.documents.map((document) => document.record_id)).toEqual(['pg-doc-accepted']);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: true },
    });
  });

  it('refreshes and retries PG document saves after stale row_version conflicts', async () => {
    const wsDb = openWorkspaceDb('npub1signedinactor');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    prepareTowerPgStorageObjectMock
      .mockResolvedValueOnce({ object_id: 'storage-pg-doc-first', upload_url: '' })
      .mockResolvedValueOnce({ object_id: 'storage-pg-doc-retry', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});
    const stale = new Error('Tower PG API 409 PATCH https://tower.example/docs/doc-1: {"code":"stale_row_version"}');
    stale.status = 409;
    stale.responseText = '{"code":"stale_row_version"}';
    updateTowerPgDocMock
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({
        doc: {
          id: 'doc-1',
          workspace_id: 'workspace-1',
          scope_id: 'scope-1',
          channel_id: 'channel-1',
          storage_object_id: 'storage-pg-doc-retry',
          title: 'Edited title',
          summary: 'Edited body',
          metadata: {},
          row_version: 3,
        },
      });

    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      documents: [{
        record_id: 'doc-1',
        owner_npub: 'npub1pgworkspace',
        title: 'Original title',
        content: 'Original body',
        content_blocks: [{ id: 'block-1', type: 'markdown', text: 'Original body', attrs: {} }],
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        pg_backend: true,
        pg_record_type: 'doc',
        pg_channel_id: 'channel-1',
        sync_status: 'synced',
        record_state: 'active',
        version: 1,
      }],
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      pgEditLeaseSessions: {
        'document:doc-1': { lease: { lease_token: 'lease-token' } },
      },
      refreshDocuments: vi.fn(async function refreshDocuments() {
        this.patchDocumentLocal({
          ...this.documents.find((item) => item.record_id === 'doc-1'),
          title: 'Server title',
          content: 'Server body',
          sync_status: 'synced',
          version: 2,
        });
        return this.documents;
      }),
    });
    store.docEditorTitle = 'Edited title';
    store.docEditorBlocks = [{ id: 'block-1', type: 'markdown', text: 'Edited body', attrs: {} }];

    const saved = await store.saveSelectedDocItem({ autosave: false });

    expect(updateTowerPgDocMock).toHaveBeenCalledTimes(2);
    expect(updateTowerPgDocMock.mock.calls[0][2]).toMatchObject({ row_version: 1 });
    expect(updateTowerPgDocMock.mock.calls[1][2]).toMatchObject({ row_version: 2 });
    expect(saved).toMatchObject({
      record_id: 'doc-1',
      title: 'Edited title',
      content: 'Edited body',
      version: 3,
      sync_status: 'synced',
    });
    expect(store.docAutosaveState).toBe('saved');
  });

  it('loads PG document versions from the typed Tower route', async () => {
    isTowerPgBackendModeMock.mockReturnValue(true);
    getTowerPgDocVersionsMock.mockResolvedValue({
      versions: [
        {
          version: 2,
          title: 'PG document v2',
          updated_at: '2026-06-15T01:00:00.000Z',
          content: {
            content: 'Updated body',
            content_format: 'block_document_v1',
            content_blocks: [{ id: 'block-1', type: 'markdown', text: 'Updated body', attrs: {} }],
          },
        },
        {
          version: 1,
          title: 'PG document v1',
          updated_at: '2026-06-15T00:00:00.000Z',
          content: {
            content: 'Initial body',
            content_format: 'block_document_v1',
            content_blocks: [{ id: 'block-0', type: 'markdown', text: 'Initial body', attrs: {} }],
          },
        },
      ],
    });
    const store = createStore({
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      selectedDocId: 'doc-1',
      selectedDocType: 'document',
      documents: [{ record_id: 'doc-1', title: 'PG document', pg_backend: true, record_state: 'active' }],
      syncRoute: vi.fn(),
    });

    await store.openDocVersioning();

    expect(getTowerPgDocVersionsMock).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      limit: 50,
    });
    expect(store.docVersionHistory.map((version) => version.version)).toEqual([2, 1]);
    expect(store.docVersionHistory[0]).toMatchObject({
      title: 'PG document v2',
      content: 'Updated body',
      content_format: 'block_document_v1',
    });
    expect(store.docVersioningPreviewHtml).toContain('Updated body');
  });

  it('preserves non-writable delivery groups in canonical document rows', () => {
    const store = createStore();

    const normalized = store.normalizeDocumentRowGroupRefs({
      group_ids: ['g-allowed', 'g-hidden'],
      scope_policy_group_ids: ['g-allowed', 'g-hidden'],
      write_group_id: 'g-hidden',
      shares: [
        { type: 'group', group_id: 'g-allowed', access: 'write' },
        { type: 'group', group_id: 'g-hidden', access: 'write' },
        { type: 'person', person_npub: 'npub1friend', via_group_id: 'g-hidden', access: 'read' },
      ],
    });

    expect(normalized.group_ids).toEqual(['g-allowed', 'g-hidden']);
    expect(normalized.scope_policy_group_ids).toEqual(['g-allowed', 'g-hidden']);
    expect(normalized.shares).toHaveLength(3);
  });

  it('preserves non-writable delivery groups in canonical directory rows', () => {
    const store = createStore();

    const normalized = store.normalizeDirectoryRowGroupRefs({
      group_ids: ['g-allowed', 'g-hidden'],
      scope_policy_group_ids: ['g-hidden'],
      shares: [
        { type: 'group', group_id: 'g-allowed', access: 'write' },
        { type: 'group', group_id: 'g-hidden', access: 'read' },
      ],
    });

    expect(normalized.group_ids).toEqual(['g-hidden', 'g-allowed']);
    expect(normalized.scope_policy_group_ids).toEqual(['g-hidden']);
    expect(normalized.shares).toHaveLength(2);
    });
  });

  it('creates PG document comments through Tower and replaces the optimistic row', async () => {
    const wsDb = openWorkspaceDb('pg-doc-comment-create');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    createTowerPgDocCommentMock.mockResolvedValue({
      comment: {
        id: 'pg-comment-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        body: 'Doc comment',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 5,
          comment_status: 'open',
        },
        row_version: 1,
      },
    });

    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      documents: [{
        record_id: 'doc-1',
        owner_npub: 'npub1pgworkspace',
        title: 'Doc',
        content: 'Body',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        pg_backend: true,
        pg_record_type: 'doc',
        pg_channel_id: 'channel-1',
        sync_status: 'synced',
        record_state: 'active',
      }],
      selectedDocId: 'doc-1',
      selectedDocType: 'document',
      docComments: [],
      docCommentAudioDrafts: [],
      docCommentAnchorBlockId: 'block-1',
      docCommentAnchorLine: 5,
      newDocCommentBody: 'Doc comment',
      scheduleStorageImageHydration: vi.fn(),
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    await store.addDocComment();

    expect(createTowerPgDocCommentMock).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      body: 'Doc comment',
      metadata: {
        anchor_block_id: 'block-1',
        anchor_line_number: 5,
        client_record_id: expect.any(String),
        comment_status: 'open',
      },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.docComments).toHaveLength(1);
    expect(store.docComments[0]).toMatchObject({
      record_id: 'pg-comment-1',
      target_record_id: 'doc-1',
      anchor_block_id: 'block-1',
      anchor_line_number: 5,
      pg_backend: true,
      pg_record_type: 'doc_comment',
    });
    expect(store.selectedDocCommentId).toBe('pg-comment-1');
  });

  it('creates PG document comment replies with parent_comment_id', async () => {
    const wsDb = openWorkspaceDb('pg-doc-comment-reply-create');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    createTowerPgDocCommentMock.mockResolvedValue({
      comment: {
        id: 'pg-reply-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: 'root-1',
        body: 'Reply',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 5,
          comment_status: 'open',
        },
        row_version: 1,
      },
    });
    const rootComment = {
      record_id: 'root-1',
      target_record_id: 'doc-1',
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: null,
      anchor_block_id: 'block-1',
      anchor_line_number: 5,
      body: 'Root',
      comment_status: 'open',
      record_state: 'active',
      updated_at: '2026-06-01T00:00:00.000Z',
    };

    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      documents: [{
        record_id: 'doc-1',
        owner_npub: 'npub1pgworkspace',
        title: 'Doc',
        content: 'Body',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        pg_backend: true,
        pg_record_type: 'doc',
        pg_channel_id: 'channel-1',
        sync_status: 'synced',
        record_state: 'active',
      }],
      selectedDocId: 'doc-1',
      selectedDocType: 'document',
      selectedDocCommentId: 'root-1',
      docComments: [rootComment],
      docCommentReplyAudioDrafts: [],
      newDocCommentReplyBody: 'Reply',
      scheduleStorageImageHydration: vi.fn(),
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    await store.addDocCommentReply();

    expect(createTowerPgDocCommentMock).toHaveBeenCalledWith('workspace-1', 'doc-1', {
      body: 'Reply',
      parent_comment_id: 'root-1',
      metadata: {
        anchor_block_id: 'block-1',
        anchor_line_number: 5,
        client_record_id: expect.any(String),
        comment_status: 'open',
      },
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.docComments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        record_id: 'pg-reply-1',
        parent_comment_id: 'root-1',
        body: 'Reply',
        pg_record_type: 'doc_comment',
      }),
    ]));
  });

  it('resolves PG document comments through Tower', async () => {
    const wsDb = openWorkspaceDb('pg-doc-comment-status');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    updateTowerPgDocCommentMock.mockResolvedValue({
      comment: {
        id: 'root-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: null,
        body: 'Root',
        metadata: {
          anchor_block_id: 'block-1',
          anchor_line_number: 5,
          comment_status: 'resolved',
        },
        row_version: 2,
      },
    });
    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      documents: [{ record_id: 'doc-1', pg_backend: true, pg_channel_id: 'channel-1', record_state: 'active' }],
      selectedDocId: 'doc-1',
      selectedDocType: 'document',
      selectedDocCommentId: 'root-1',
      docComments: [{
        record_id: 'root-1',
        target_record_id: 'doc-1',
        parent_comment_id: null,
        body: 'Root',
        anchor_block_id: 'block-1',
        anchor_line_number: 5,
        comment_status: 'open',
        record_state: 'active',
        version: 1,
      }],
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    await store.setDocCommentStatus('root-1', 'resolved');

    expect(updateTowerPgDocCommentMock).toHaveBeenCalledWith('workspace-1', 'doc-1', 'root-1', {
      comment_status: 'resolved',
      row_version: 1,
    }, { baseUrl: 'https://tower.example', appNpub: 'flightdeck_pg' });
    expect(store.docComments[0]).toMatchObject({
      record_id: 'root-1',
      comment_status: 'resolved',
      version: 2,
    });
  });

  it('removes PG document comment threads through Tower', async () => {
    const wsDb = openWorkspaceDb('pg-doc-comment-delete');
    await wsDb.open();
    await Promise.all(wsDb.tables.map((table) => table.clear()));
    isTowerPgBackendModeMock.mockReturnValue(true);
    deleteTowerPgDocCommentMock.mockResolvedValue({
      comment: {
        id: 'root-1',
        workspace_id: 'workspace-1',
        scope_id: 'scope-1',
        channel_id: 'channel-1',
        doc_id: 'doc-1',
        parent_comment_id: null,
        body: 'Root',
        metadata: { comment_status: 'open' },
        record_state: 'deleted',
        row_version: 2,
      },
    });
    const store = createStore({
      workspaceOwnerNpub: 'npub1signedinactor',
      backendUrl: 'https://tower.example',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        workspaceOwnerNpub: 'npub1pgworkspace',
        directHttpsUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      },
      documents: [{ record_id: 'doc-1', pg_backend: true, pg_channel_id: 'channel-1', record_state: 'active' }],
      selectedDocId: 'doc-1',
      selectedDocType: 'document',
      selectedDocCommentId: 'root-1',
      docComments: [
        {
          record_id: 'root-1',
          target_record_id: 'doc-1',
          parent_comment_id: null,
          body: 'Root',
          comment_status: 'open',
          record_state: 'active',
          version: 1,
        },
        {
          record_id: 'reply-1',
          target_record_id: 'doc-1',
          parent_comment_id: 'root-1',
          body: 'Reply',
          comment_status: 'open',
          record_state: 'active',
          version: 1,
        },
      ],
      clearDocCommentConnector: vi.fn(),
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    await store.removeDocComment('root-1');

    expect(deleteTowerPgDocCommentMock).toHaveBeenCalledWith('workspace-1', 'doc-1', 'root-1', {
      rowVersion: 1,
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
    });
    expect(store.docComments.every((comment) => comment.record_state === 'deleted')).toBe(true);
    expect(store.selectedDocCommentId).toBeNull();
  });

describe('lock-managed checkout state helpers', () => {
  it('treats an expired lease as not held', () => {
    expect(isCheckoutHeld({
      state: 'checked_out',
      checkout_id: 'checkout-1',
      lease_expires_at: '2026-04-24T00:00:00.000Z',
    }, Date.parse('2026-04-24T00:00:01.000Z'))).toBe(false);
  });
});
