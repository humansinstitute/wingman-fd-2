import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecordHistory, syncRecords } from '../src/api.js';
import {
  clearRuntimeFamilies,
  clearSyncQuarantineForFamilies,
  clearSyncStateForFamilies,
  deleteRuntimeRecordByFamily,
  getPendingWrites,
  getPendingWritesByFamilies,
  getTaskById,
  removePendingWrite,
  updatePendingWrite,
  upsertWorkspaceSettings,
  upsertWapp,
} from '../src/db.js';
import {
  pullRecordsForFamilies,
  pruneOnLogin,
  runSync,
  startWorkerFlushTimer,
  connectSSE,
} from '../src/sync-worker-client.js';
import { syncManagerMixin } from '../src/sync-manager.js';
import { getSyncFamilyHash } from '../src/sync-families.js';
import { createNip98AuthHeader, createNip98AuthHeaderForSecret } from '../src/auth/nostr.js';
import { getActiveWorkspaceKeySecretForAuth } from '../src/crypto/workspace-keys.js';
import { isTowerPgBackendMode } from '../src/backend-mode.js';
import {
  hydrateTowerPgDocComments,
  hydrateTowerPgEventUpdates,
  hydrateTowerPgTaskComments,
} from '../src/pg-read-hydrator.js';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => false),
}));

vi.mock('../src/pg-read-hydrator.js', () => ({
  hydrateTowerPgDocComments: vi.fn(async () => []),
  hydrateTowerPgEventUpdates: vi.fn(async () => ({ appliedTargets: 0, fallbackEvents: 0, events: 0 })),
  hydrateTowerPgTaskComments: vi.fn(async () => []),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  hasGroupKey: vi.fn(() => true),
}));

vi.mock('../src/api.js', () => ({
  downloadStorageObject: vi.fn(),
  fetchRecordHistory: vi.fn(),
  syncRecords: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  getPendingWrites: vi.fn(async () => []),
  getPendingWritesByFamilies: vi.fn(async () => []),
  updatePendingWrite: vi.fn(async () => 1),
  removePendingWrite: vi.fn(async () => {}),
  clearSyncState: vi.fn(async () => {}),
  clearRuntimeFamilies: vi.fn(async () => {}),
  clearSyncStateForFamilies: vi.fn(async () => {}),
  getSyncQuarantineEntries: vi.fn(async () => []),
  deleteSyncQuarantineEntry: vi.fn(async () => {}),
  clearSyncQuarantineForFamilies: vi.fn(async () => {}),
  deleteRuntimeRecordByFamily: vi.fn(async () => 1),
  upsertTask: vi.fn(async () => {}),
  getTaskById: vi.fn(async () => null),
  upsertWorkspaceSettings: vi.fn(async () => {}),
  upsertFlow: vi.fn(async () => {}),
  getFlowById: vi.fn(async () => null),
  upsertDocument: vi.fn(async () => {}),
  getDocumentById: vi.fn(async () => null),
  upsertDirectory: vi.fn(async () => {}),
  getDirectoryById: vi.fn(async () => null),
  upsertChannel: vi.fn(async () => {}),
  upsertMessage: vi.fn(async () => {}),
  upsertScope: vi.fn(async () => {}),
  upsertPerson: vi.fn(async () => {}),
  upsertOrganisation: vi.fn(async () => {}),
  upsertOpportunity: vi.fn(async () => {}),
  getOpportunityById: vi.fn(async () => null),
  getCommentsByTarget: vi.fn(async () => []),
  upsertComment: vi.fn(async () => {}),
  getApprovalById: vi.fn(async () => null),
  upsertWapp: vi.fn(async () => {}),
}));

vi.mock('../src/sync-worker-client.js', () => ({
  runSync: vi.fn(),
  pullRecordsForFamilies: vi.fn(),
  pruneOnLogin: vi.fn(),
  startWorkerFlushTimer: vi.fn(),
  stopWorkerFlushTimer: vi.fn(),
  connectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
  setSSEStatusCallback: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async () => 'Nostr eyJraW5kIjoyNzIzNX0='),
  createNip98AuthHeaderForSecret: vi.fn(async () => 'Nostr eyJzZWNyZXQiOnRydWV9'),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => null),
  isWorkspaceKeyRegistered: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
  isTowerPgBackendMode.mockReturnValue(false);
});

vi.mock('../src/translators/chat.js', () => ({
  outboundChannel: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'family:channel' })),
  outboundChatMessage: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'family:chat_message' })),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

vi.mock('../src/translators/settings.js', () => ({
  outboundWorkspaceSettings: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:settings' })),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

vi.mock('../src/translators/scopes.js', () => ({
  outboundScope: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:scope' })),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

vi.mock('../src/translators/wapps.js', () => ({
  outboundWapp: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:wapp' })),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    session: null,
    backendUrl: '',
    navSection: 'chat',
    selectedChannelId: null,
    FAST_SYNC_MS: 1000,
    IDLE_SYNC_MS: 5000,
    BACKGROUND_GROUP_REFRESH_MS: 300000,
    GROUP_KEY_REFRESH_MAX_AGE_MS: 86400000,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    visibilityHandler: null,
    lastGroupsRefreshAt: 0,
    syncing: false,
    syncStatus: 'synced',
    showAvatarMenu: false,
    showSyncProgressModal: false,
    syncFamilyProgress: [],
    syncSession: {
      state: 'idle',
      phase: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      manual: false,
      error: null,
      heartbeat: false,
      pushed: 0,
      pushTotal: 0,
      pulled: 0,
      completedFamilies: 0,
      totalFamilies: 0,
      currentFamily: null,
      currentFamilyHash: null,
    },
    syncQuarantine: [],
    repairSelectedFamilyIds: [],
    repairError: null,
    repairNotice: '',
    repairBusy: false,
    repairTaskIdInput: '',
    repairTaskProbeBusy: false,
    recordStatusModalOpen: false,
    recordStatusFamilyId: '',
    recordStatusTargetId: '',
    recordStatusTargetLabel: '',
    recordStatusBusy: false,
    recordStatusSyncBusy: false,
    recordStatusError: null,
    recordStatusNotice: '',
    recordStatusTowerVersionCount: 0,
    recordStatusTowerLatestVersion: 0,
    recordStatusTowerUpdatedAt: '',
    recordStatusLocalPresent: false,
    recordStatusLocalVersion: 0,
    recordStatusLocalSyncStatus: '',
    recordStatusPendingWriteCount: 0,
    recordStatusWriteGroupRef: '',
    recordStatusWriteGroupLabel: '',
    recordStatusWriteGroupKeyLoaded: false,
    pendingWritesModalOpen: false,
    pendingWritesBusy: false,
    pendingWritesError: null,
    pendingWritesNotice: '',
    pendingWriteDiagnostics: [],
    syncQuarantineError: null,
    syncQuarantineNotice: '',
    syncQuarantineBusy: false,
    error: null,
    groups: [],
    channels: [],
    messages: [],
    documents: [],
    directories: [],
    reports: [],
    tasks: [],
    taskComments: [],
    scopes: [],
    audioNotes: [],
    schedules: [],
    wapps: [],
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    selectedBoardId: null,
    docsEditorOpen: false,
    selectedDocId: null,
    activeTaskId: null,
    wingmanHarnessDirty: false,
    workspaceOwnerNpub: 'npub1owner',
    // Stubs for methods from other mixins
    refreshGroups: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockResolvedValue(undefined),
    refreshMessages: vi.fn().mockResolvedValue(undefined),
    refreshAudioNotes: vi.fn().mockResolvedValue(undefined),
    refreshDirectories: vi.fn().mockResolvedValue(undefined),
    refreshDocuments: vi.fn().mockResolvedValue(undefined),
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    refreshDailyNotes: vi.fn().mockResolvedValue(undefined),
    refreshPersonalWapps: vi.fn().mockResolvedValue(undefined),
    refreshSchedules: vi.fn().mockResolvedValue(undefined),
    refreshScopes: vi.fn().mockResolvedValue(undefined),
    refreshWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    refreshStatusRecentChanges: vi.fn().mockResolvedValue(undefined),
    ensureTaskBoardScopeSetup: vi.fn().mockResolvedValue(undefined),
    getEffectiveDocShares: vi.fn((record) => record?.shares || []),
    patchDirectoryLocal: vi.fn(),
    patchDocumentLocal: vi.fn(),
    loadDocComments: vi.fn().mockResolvedValue(undefined),
    loadTaskComments: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  // Apply all mixin methods and getters
  const descriptors = Object.getOwnPropertyDescriptors(syncManagerMixin);
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
// Checkout preparation
// ---------------------------------------------------------------------------
describe('checkout preparation', () => {
  it('prepares checkout-required task pending writes on the main thread', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    const envelope = {
      record_id: 'task-1',
      record_family_hash: taskFamilyHash,
      version: 3,
      previous_version: 2,
    };
    const pendingWrite = {
      row_id: 7,
      record_id: 'task-1',
      record_family_hash: taskFamilyHash,
      checkout_policy_config: checkoutPolicyConfig,
      envelope,
    };
    const localTask = {
      record_id: 'task-1',
      record_family_hash: taskFamilyHash,
      version: 3,
      sync_status: 'pending',
    };
    const managedEnvelope = {
      ...envelope,
      checkout: { checkout_id: 'checkout-task-1', consume_on_success: true },
    };

    getPendingWrites.mockResolvedValueOnce([pendingWrite]);
    const attachCheckoutRequiredCheckoutToEnvelope = vi.fn(async () => managedEnvelope);
    const store = createStore({
      tasks: [localTask],
      attachCheckoutRequiredCheckoutToEnvelope,
    });

    const result = await store.prepareCheckoutRequiredPendingWrites();

    expect(result).toEqual({ prepared: 1, blocked: 0, skipped: 0 });
    expect(attachCheckoutRequiredCheckoutToEnvelope).toHaveBeenCalledWith(
      localTask,
      envelope,
      expect.objectContaining({
        checkoutPolicyConfig,
        intent: 'sync',
      }),
    );
    expect(updatePendingWrite).toHaveBeenCalledWith(7, expect.objectContaining({
      envelope: managedEnvelope,
      checkout_policy_config: checkoutPolicyConfig,
      checkout_prepare_state: 'ready',
      checkout_prepare_error: null,
    }));
  });

  it('can load the local task from Dexie while preparing checkout', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    const envelope = {
      record_id: 'task-2',
      record_family_hash: taskFamilyHash,
      version: 4,
      previous_version: 3,
    };
    const localTask = {
      record_id: 'task-2',
      record_family_hash: taskFamilyHash,
      version: 4,
      sync_status: 'pending',
    };
    getPendingWrites.mockResolvedValueOnce([{
      row_id: 8,
      record_id: 'task-2',
      record_family_hash: taskFamilyHash,
      checkout_policy_config: checkoutPolicyConfig,
      envelope,
    }]);
    getTaskById.mockResolvedValueOnce(localTask);

    const managedEnvelope = {
      ...envelope,
      checkout: { checkout_id: 'checkout-task-2', consume_on_success: true },
    };
    const attachCheckoutRequiredCheckoutToEnvelope = vi.fn(async () => managedEnvelope);
    const store = createStore({
      tasks: [],
      attachCheckoutRequiredCheckoutToEnvelope,
    });

    await store.prepareCheckoutRequiredPendingWrites();

    expect(getTaskById).toHaveBeenCalledWith('task-2');
    expect(updatePendingWrite).toHaveBeenCalledWith(8, expect.objectContaining({
      envelope: managedEnvelope,
      checkout_prepare_state: 'ready',
    }));
  });

  it('promotes legacy raw task update rows into checkout preparation', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    const envelope = {
      record_id: 'task-legacy',
      record_family_hash: taskFamilyHash,
      version: 2,
      previous_version: 1,
    };
    const localTask = {
      record_id: 'task-legacy',
      record_family_hash: taskFamilyHash,
      version: 2,
      sync_status: 'pending',
    };
    getPendingWrites.mockResolvedValueOnce([{
      row_id: 9,
      record_id: 'task-legacy',
      record_family_hash: taskFamilyHash,
      envelope,
    }]);

    const managedEnvelope = {
      ...envelope,
      checkout: { checkout_id: 'checkout-task-legacy', consume_on_success: true },
    };
    const attachCheckoutRequiredCheckoutToEnvelope = vi.fn(async () => managedEnvelope);
    const store = createStore({
      tasks: [localTask],
      getTaskDetailCheckoutPolicyConfig: vi.fn(() => checkoutPolicyConfig),
      attachCheckoutRequiredCheckoutToEnvelope,
    });

    await store.prepareCheckoutRequiredPendingWrites();

    expect(attachCheckoutRequiredCheckoutToEnvelope).toHaveBeenCalledWith(
      localTask,
      envelope,
      expect.objectContaining({ checkoutPolicyConfig }),
    );
    expect(updatePendingWrite).toHaveBeenCalledWith(9, expect.objectContaining({
      envelope: managedEnvelope,
      checkout_policy_config: checkoutPolicyConfig,
      checkout_prepare_state: 'ready',
    }));
  });
});

// ---------------------------------------------------------------------------
// Repair UI
// ---------------------------------------------------------------------------
describe('repair UI', () => {
  it('repairFamilyOptions returns SYNC_FAMILY_OPTIONS', () => {
    const store = createStore();
    expect(Array.isArray(store.repairFamilyOptions)).toBe(true);
    expect(store.repairFamilyOptions.length).toBeGreaterThan(0);
    expect(store.repairFamilyOptions[0]).toHaveProperty('id');
  });

  it('isRepairFamilySelected checks list', () => {
    const { fn } = bindMethod('isRepairFamilySelected', {
      repairSelectedFamilyIds: ['task', 'channel'],
    });
    expect(fn('task')).toBe(true);
    expect(fn('document')).toBe(false);
  });

  it('toggleRepairFamily adds and removes', () => {
    const { fn, store } = bindMethod('toggleRepairFamily', {
      repairSelectedFamilyIds: [],
    });
    fn('task');
    expect(store.repairSelectedFamilyIds).toContain('task');
    fn('task');
    expect(store.repairSelectedFamilyIds).not.toContain('task');
  });

  it('toggleRepairFamily clears error and notice', () => {
    const { fn, store } = bindMethod('toggleRepairFamily', {
      repairSelectedFamilyIds: [],
      repairError: 'old error',
      repairNotice: 'old notice',
    });
    fn('task');
    expect(store.repairError).toBeNull();
    expect(store.repairNotice).toBe('');
  });

  it('selectAllRepairFamilies selects all', () => {
    const { fn, store } = bindMethod('selectAllRepairFamilies', {
      repairSelectedFamilyIds: [],
    });
    fn();
    expect(store.repairSelectedFamilyIds.length).toBeGreaterThan(0);
  });

  it('clearRepairFamilies clears all', () => {
    const { fn, store } = bindMethod('clearRepairFamilies', {
      repairSelectedFamilyIds: ['task', 'channel'],
    });
    fn();
    expect(store.repairSelectedFamilyIds).toEqual([]);
  });
});

describe('record status actions', () => {
  it('enables force submit for pending local changes even when Tower already has versions', () => {
    const store = createStore({
      recordStatusTargetId: 'msg-1',
      recordStatusFamilyId: 'chat_message',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 1,
      recordStatusTowerLatestVersion: 1,
      recordStatusLocalVersion: 2,
      recordStatusLocalSyncStatus: 'failed',
      recordStatusPendingWriteCount: 0,
    });
    expect(store.canForcePushRecordStatusTarget()).toBe(true);
    expect(store.getRecordStatusRecommendedResolution()).toBe('force_submit');
  });

  it('does not recommend force submit when Tower is newer than the local copy', () => {
    const store = createStore({
      recordStatusTargetId: 'msg-1',
      recordStatusFamilyId: 'chat_message',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 4,
      recordStatusTowerLatestVersion: 4,
      recordStatusLocalVersion: 2,
      recordStatusLocalSyncStatus: 'synced',
      recordStatusPendingWriteCount: 0,
    });
    expect(store.canForcePushRecordStatusTarget()).toBe(false);
    expect(store.canRepairRecordStatusTargetFromTower()).toBe(true);
    expect(store.getRecordStatusRecommendedResolution()).toBe('use_tower');
  });

  it('builds chat message force-submit envelopes from the channel group', async () => {
    const store = createStore({
      session: { npub: 'npub1viewer' },
      signingNpub: 'npub1workspacekey',
      workspaceOwnerNpub: 'npub1owner',
      recordStatusTowerLatestVersion: 3,
      channels: [{
        record_id: 'ch-1',
        owner_npub: 'npub1owner',
        group_ids: ['group-1'],
        participant_npubs: ['npub1viewer'],
      }],
    });
    const envelope = await store.buildRecordStatusEnvelope({
      record_id: 'msg-1',
      channel_id: 'ch-1',
      body: 'hello',
      attachments: [],
      record_state: 'active',
      version: 2,
    }, 'chat_message', { bootstrap: false });

    expect(envelope.version).toBe(4);
    expect(envelope.previous_version).toBe(3);
    expect(envelope.channel_group_ids).toEqual(['group-1']);
  });

  it('force-submits existing tasks with checkout-required policy config', async () => {
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 0, updated: 1, rejected: [] });
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'task-1',
      record_family_hash: getSyncFamilyHash('task'),
      version: 7,
      previous_version: 6,
      checkout: { checkout_id: 'checkout-task-1', consume_on_success: true },
    });
    const markRecordStatusLocalRecordSynced = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-1',
      recordStatusTargetLabel: 'Task One',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 6,
      recordStatusTowerLatestVersion: 6,
      groups: [{ group_id: 'group-1', member_npubs: ['npub1me'] }],
      tasks: [{
        record_id: 'task-1',
        owner_npub: 'npub1owner',
        title: 'Task One',
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [],
        version: 6,
        sync_status: 'failed',
      }],
      getTaskDetailCheckoutPolicyConfig: vi.fn(() => checkoutPolicyConfig),
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([]),
      buildRecordStatusEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced: vi.fn().mockResolvedValue(undefined),
      checkRecordStatusOnTower: vi.fn().mockResolvedValue(undefined),
    });

    await fn();

    expect(buildRecordStatusEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-1',
    }), 'task', { bootstrap: false, checkoutPolicyConfig, writeGroupRef: 'group-1' });
    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({
        record_id: 'task-1',
        force_write: true,
      })],
      checkout_policy_config: checkoutPolicyConfig,
    });
    expect(syncRecords.mock.calls[0][0].records[0].checkout).toBeUndefined();
    expect(markRecordStatusLocalRecordSynced).toHaveBeenCalledWith('task', expect.objectContaining({
      record_id: 'task-1',
    }), { version: 7 });
  });

  it('retries task force-submit with another delivery group when the first group lacks prior-version write access', async () => {
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    syncRecords
      .mockResolvedValueOnce({
        synced: 0,
        updated: 0,
        rejected: [{
          record_id: 'task-1',
          code: 'write_forbidden',
          reason: 'group group-new does not have write access on prior version',
        }],
      })
      .mockResolvedValueOnce({ synced: 1, created: 0, updated: 1, rejected: [] });
    const buildRecordStatusEnvelope = vi.fn(async (_record, _familyId, options = {}) => ({
      record_id: 'task-1',
      record_family_hash: getSyncFamilyHash('task'),
      version: 7,
      previous_version: 6,
      write_group_id: options.writeGroupRef,
      checkout: { checkout_id: 'checkout-task-1', consume_on_success: true },
    }));
    const markRecordStatusLocalRecordSynced = vi.fn().mockResolvedValue(undefined);
    const store = createStore({
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      groups: [
        { group_id: 'group-new', member_npubs: ['npub1me'] },
        { group_id: 'group-old', private_member_npub: 'npub1me', member_npubs: ['npub1me'] },
      ],
      tasks: [{
        record_id: 'task-1',
        owner_npub: 'npub1owner',
        title: 'Task One',
        board_group_id: 'group-new',
        group_ids: ['group-new', 'group-old'],
        shares: [],
        version: 6,
        sync_status: 'failed',
      }],
      getPreferredRecordWriteGroup: vi.fn(() => 'group-new'),
      getTaskDetailCheckoutPolicyConfig: vi.fn(() => checkoutPolicyConfig),
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([]),
      buildRecordStatusEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced: vi.fn().mockResolvedValue(undefined),
    });

    const result = await store.forcePushLocalRecordSnapshot({
      familyId: 'task',
      recordId: 'task-1',
      towerVersionCount: 6,
      towerLatestVersion: 6,
    });

    expect(result.submittedVersion).toBe(7);
    expect(buildRecordStatusEnvelope).toHaveBeenNthCalledWith(1, expect.any(Object), 'task', expect.objectContaining({
      writeGroupRef: 'group-new',
    }));
    expect(buildRecordStatusEnvelope).toHaveBeenNthCalledWith(2, expect.any(Object), 'task', expect.objectContaining({
      writeGroupRef: 'group-old',
    }));
    expect(syncRecords).toHaveBeenCalledTimes(2);
    expect(markRecordStatusLocalRecordSynced).toHaveBeenCalledWith('task', expect.objectContaining({
      record_id: 'task-1',
    }), { version: 7 });
  });

  it('force-pushes workspace settings pending writes from local settings state', async () => {
    const settingsFamilyHash = getSyncFamilyHash('settings');
    const pendingRows = [{
      row_id: 91,
      record_id: 'workspace-settings:npub1owner',
      record_family_hash: settingsFamilyHash,
      envelope: {
        record_id: 'workspace-settings:npub1owner',
        record_family_hash: settingsFamilyHash,
        version: 11,
        previous_version: 10,
      },
    }];
    syncRecords.mockResolvedValueOnce({ synced: 1, updated: 1, rejected: [] });
    const store = createStore({
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      groups: [{ group_id: 'admin-group', member_npubs: ['npub1me'] }],
      workspaceSettingsRecordId: 'workspace-settings:npub1owner',
      workspaceSettingsVersion: 11,
      workspaceSettingsGroupIds: ['admin-group'],
      workspaceProfileNameInput: 'Owner Workspace',
      workspaceProfileDescriptionInput: 'Shared workspace',
      workspaceProfileAvatarInput: '',
      workspaceHarnessUrl: 'https://wingmen.example',
      workspaceTriggers: [{ kind: 'task_updated' }],
      channelOrder: ['channel-1', 'channel-2'],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue(pendingRows),
    });

    const result = await store.forcePushLocalRecordSnapshot({
      familyId: 'settings',
      recordId: 'workspace-settings:npub1owner',
      towerVersionCount: 10,
      towerLatestVersion: 10,
      pendingWrites: pendingRows,
    });

    expect(result).toMatchObject({
      familyId: 'settings',
      recordId: 'workspace-settings:npub1owner',
      submittedVersion: 11,
    });
    expect(syncRecords).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({
        record_id: 'workspace-settings:npub1owner',
        record_family_hash: 'mock:settings',
        force_write: true,
        write_group_ref: 'admin-group',
      })],
    }));
    expect(removePendingWrite).toHaveBeenCalledWith(91);
    expect(upsertWorkspaceSettings).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'workspace-settings:npub1owner',
      sync_status: 'synced',
      version: 11,
    }));
  });

  it('deletes the selected record from local Flight Deck state and clears its pending writes', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    getPendingWrites.mockResolvedValueOnce([
      {
        row_id: 101,
        record_id: 'task-delete',
        record_family_hash: taskFamilyHash,
        envelope: { record_id: 'task-delete', record_family_hash: taskFamilyHash },
      },
      {
        row_id: 102,
        record_id: 'task-keep',
        record_family_hash: taskFamilyHash,
        envelope: { record_id: 'task-keep', record_family_hash: taskFamilyHash },
      },
    ]);
    const store = createStore({
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-delete',
      recordStatusTargetLabel: 'Task Delete',
    });

    await store.deleteRecordStatusLocalTarget();

    expect(removePendingWrite).toHaveBeenCalledWith(101);
    expect(removePendingWrite).not.toHaveBeenCalledWith(102);
    expect(deleteRuntimeRecordByFamily).toHaveBeenCalledWith('task', 'task-delete');
    expect(store.recordStatusNotice).toContain('Deleted Task Delete from this Flight Deck browser');
  });

  it('writes a deleted Tower version before clearing the selected local record', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    getPendingWrites.mockResolvedValueOnce([
      {
        row_id: 111,
        record_id: 'task-tower-delete',
        record_family_hash: taskFamilyHash,
        envelope: { record_id: 'task-tower-delete', record_family_hash: taskFamilyHash },
      },
    ]);
    syncRecords.mockResolvedValueOnce({ synced: 1, updated: 1, rejected: [] });
    const buildRecordStatusEnvelope = vi.fn(async (record, familyId, options = {}) => ({
      record_id: record.record_id,
      record_family_hash: getSyncFamilyHash(familyId),
      record_state: record.record_state,
      version: Number(options.latestTowerVersion || 0) + 1,
      previous_version: Number(options.latestTowerVersion || 0),
    }));
    const store = createStore({
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-tower-delete',
      recordStatusTargetLabel: 'Tower Delete Task',
      recordStatusTowerVersionCount: 3,
      recordStatusTowerLatestVersion: 3,
      tasks: [{
        record_id: 'task-tower-delete',
        owner_npub: 'npub1owner',
        title: 'Tower Delete Task',
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [],
        version: 3,
        sync_status: 'synced',
      }],
      buildRecordStatusEnvelope,
    });

    await store.deleteRecordStatusTowerTarget();

    expect(buildRecordStatusEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-tower-delete',
      record_state: 'deleted',
    }), 'task', expect.objectContaining({ latestTowerVersion: 3 }));
    expect(syncRecords).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({
        record_id: 'task-tower-delete',
        record_state: 'deleted',
        version: 4,
        previous_version: 3,
      })],
    }));
    expect(removePendingWrite).toHaveBeenCalledWith(111);
    expect(deleteRuntimeRecordByFamily).toHaveBeenCalledWith('task', 'task-tower-delete');
    expect(store.recordStatusNotice).toContain('Deleted Tower Delete Task from Tower');
  });
});

describe('pending write diagnostics', () => {
  it('shows checkout-required pending writes that are missing checkout metadata', async () => {
    const documentFamilyHash = getSyncFamilyHash('document');
    getPendingWrites.mockResolvedValueOnce([
      {
        row_id: 7,
        record_id: 'doc-1',
        record_family_hash: documentFamilyHash,
        created_at: '2026-04-25T06:54:00.000Z',
        envelope: {
          record_id: 'doc-1',
          record_family_hash: documentFamilyHash,
          version: 2,
          previous_version: 1,
        },
      },
    ]);
    const store = createStore({
      documents: [{
        record_id: 'doc-1',
        title: 'Forked local document',
      }],
    });

    await store.refreshPendingWriteDiagnostics();

    expect(store.pendingWritesError).toBeNull();
    expect(store.pendingWriteDiagnostics).toHaveLength(1);
    expect(store.pendingWriteDiagnostics[0]).toMatchObject({
      rowId: 7,
      recordId: 'doc-1',
      familyId: 'document',
      title: 'Forked local document',
      policy: 'checkout_required',
      checkoutMissing: true,
      syncBlocker: 'checkout_required write is missing checkout_id',
    });
  });

  it('keeps optimistic pending writes unblocked by default', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    getPendingWrites.mockResolvedValueOnce([
      {
        row_id: 8,
        record_id: 'task-1',
        record_family_hash: taskFamilyHash,
        envelope: {
          record_id: 'task-1',
          record_family_hash: taskFamilyHash,
          version: 3,
          previous_version: 2,
        },
      },
    ]);
    const store = createStore({
      tasks: [{
        record_id: 'task-1',
        title: 'Task row',
      }],
    });

    await store.refreshPendingWriteDiagnostics();

    expect(store.pendingWriteDiagnostics[0]).toMatchObject({
      rowId: 8,
      recordId: 'task-1',
      familyId: 'task',
      policy: 'optimistic_write',
      checkoutMissing: false,
      syncBlocker: '',
    });
  });

  it('does not flag checkout-required create writes as missing checkout metadata', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    getPendingWrites.mockResolvedValueOnce([
      {
        row_id: 9,
        record_id: 'task-create',
        record_family_hash: taskFamilyHash,
        checkout_policy_config: { familySuffixes: { task: 'checkout_required' } },
        envelope: {
          record_id: 'task-create',
          record_family_hash: taskFamilyHash,
          version: 1,
          previous_version: 0,
        },
      },
    ]);
    const store = createStore({
      tasks: [{
        record_id: 'task-create',
        title: 'New scoped task',
      }],
    });

    await store.refreshPendingWriteDiagnostics();

    expect(store.pendingWriteDiagnostics[0]).toMatchObject({
      rowId: 9,
      recordId: 'task-create',
      familyId: 'task',
      policy: 'checkout_required',
      checkoutMissing: false,
      syncBlocker: '',
    });
  });

  it('can discard a queued write without deleting the local record row', async () => {
    getPendingWrites.mockResolvedValueOnce([]);
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const store = createStore({ refreshSyncStatus });

    await store.discardPendingWrite(7);

    expect(removePendingWrite).toHaveBeenCalledWith(7);
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: false });
  });

  it('force-syncs all pending records and returns per-record errors', async () => {
    const documentFamilyHash = getSyncFamilyHash('document');
    const pendingRows = [
      {
        row_id: 21,
        record_id: 'doc-ok',
        record_family_hash: documentFamilyHash,
        envelope: {
          record_id: 'doc-ok',
          record_family_hash: documentFamilyHash,
          version: 3,
          previous_version: 2,
        },
      },
      {
        row_id: 22,
        record_id: 'doc-fail',
        record_family_hash: documentFamilyHash,
        envelope: {
          record_id: 'doc-fail',
          record_family_hash: documentFamilyHash,
          version: 2,
          previous_version: 1,
        },
      },
    ];
    getPendingWrites.mockResolvedValue(pendingRows);
    fetchRecordHistory
      .mockResolvedValueOnce({ versions: [{ version: 2, updated_at: '2026-03-28T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ versions: [{ version: 1, updated_at: '2026-03-28T11:00:00.000Z' }] });
    syncRecords
      .mockResolvedValueOnce({ synced: 1, updated: 1, rejected: [] })
      .mockResolvedValueOnce({
        synced: 0,
        updated: 0,
        rejected: [{ record_id: 'doc-fail', code: 'write_group_forbidden', reason: 'writer is not a member of write group' }],
      });

    const store = createStore({
      session: { npub: 'npub1me' },
      groups: [{ group_id: 'group-1', member_npubs: ['npub1me'] }],
      documents: [
        { record_id: 'doc-ok', owner_npub: 'npub1owner', title: 'Doc OK', group_ids: ['group-1'], shares: ['group-1'], version: 3, sync_status: 'failed' },
        { record_id: 'doc-fail', owner_npub: 'npub1owner', title: 'Doc Fail', group_ids: ['group-1'], shares: ['group-1'], version: 2, sync_status: 'failed' },
      ],
      buildRecordStatusEnvelope: vi.fn(async (record, familyId, options = {}) => ({
        record_id: record.record_id,
        record_family_hash: getSyncFamilyHash(familyId),
        version: options.bootstrap ? 1 : Number(options.latestTowerVersion || 0) + 1,
        previous_version: options.bootstrap ? 0 : Number(options.latestTowerVersion || 0),
      })),
      getRecordStatusRelatedComments: vi.fn(async () => []),
      refreshSyncStatus: vi.fn(async () => {}),
    });

    await store.forceSyncAllPendingWrites();

    expect(syncRecords).toHaveBeenCalledTimes(2);
    expect(removePendingWrite).toHaveBeenCalledWith(21);
    expect(removePendingWrite).not.toHaveBeenCalledWith(22);
    expect(store.pendingWritesNotice).toContain('Force synced 1/2 pending records');
    expect(store.pendingWritesError).toContain('Doc Fail');
    expect(store.pendingWritesError).toContain('writer is not a member of write group');
  });

  it('force-syncs only the requested pending targets', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const documentFamilyHash = getSyncFamilyHash('document');
    const pendingRows = [
      {
        row_id: 31,
        record_id: 'task-1',
        record_family_hash: taskFamilyHash,
        envelope: {
          record_id: 'task-1',
          record_family_hash: taskFamilyHash,
          version: 4,
          previous_version: 3,
        },
      },
      {
        row_id: 32,
        record_id: 'doc-1',
        record_family_hash: documentFamilyHash,
        envelope: {
          record_id: 'doc-1',
          record_family_hash: documentFamilyHash,
          version: 3,
          previous_version: 2,
        },
      },
    ];
    getPendingWrites.mockResolvedValue(pendingRows);
    fetchRecordHistory.mockResolvedValueOnce({ versions: [{ version: 3, updated_at: '2026-03-28T10:00:00.000Z' }] });
    syncRecords.mockResolvedValueOnce({ synced: 1, updated: 1, rejected: [] });
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };

    const store = createStore({
      session: { npub: 'npub1me' },
      groups: [{ group_id: 'group-1', member_npubs: ['npub1me'] }],
      tasks: [
        { record_id: 'task-1', owner_npub: 'npub1owner', title: 'Task One', board_group_id: 'group-1', group_ids: ['group-1'], shares: [], version: 4, sync_status: 'failed' },
      ],
      documents: [
        { record_id: 'doc-1', owner_npub: 'npub1owner', title: 'Doc One', group_ids: ['group-1'], shares: ['group-1'], version: 3, sync_status: 'failed' },
      ],
      getTaskDetailCheckoutPolicyConfig: vi.fn(() => checkoutPolicyConfig),
      buildRecordStatusEnvelope: vi.fn(async (record, familyId, options = {}) => ({
        record_id: record.record_id,
        record_family_hash: getSyncFamilyHash(familyId),
        version: Number(options.latestTowerVersion || 0) + 1,
        previous_version: Number(options.latestTowerVersion || 0),
        checkout: { checkout_id: 'checkout-task-1', consume_on_success: true },
      })),
      getRecordStatusRelatedComments: vi.fn(async () => []),
    });

    const result = await store.forceSyncPendingWriteTargets([
      { familyId: 'task', recordId: 'task-1', label: 'Task One' },
    ]);

    expect(result).toMatchObject({ synced: 1, cleared: 1, attempted: 1, failures: [] });
    expect(syncRecords).toHaveBeenCalledTimes(1);
    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({ record_id: 'task-1', force_write: true })],
      checkout_policy_config: checkoutPolicyConfig,
    });
    expect(syncRecords.mock.calls[0][0].records[0].checkout).toBeUndefined();
    expect(removePendingWrite).toHaveBeenCalledWith(31);
    expect(removePendingWrite).not.toHaveBeenCalledWith(32);
  });

  it('repairs only Tower-backed pending targets by clearing queued writes and pulling those families', async () => {
    const documentFamilyHash = getSyncFamilyHash('document');
    const scopeFamilyHash = getSyncFamilyHash('scope');
    const pendingRows = [
      {
        row_id: 41,
        record_id: 'doc-on-tower',
        record_family_hash: documentFamilyHash,
        envelope: {
          record_id: 'doc-on-tower',
          record_family_hash: documentFamilyHash,
          version: 4,
          previous_version: 3,
        },
      },
      {
        row_id: 42,
        record_id: 'scope-local-only',
        record_family_hash: scopeFamilyHash,
        envelope: {
          record_id: 'scope-local-only',
          record_family_hash: scopeFamilyHash,
          version: 2,
          previous_version: 1,
        },
      },
    ];
    fetchRecordHistory
      .mockResolvedValueOnce({ versions: [{ version: 3, updated_at: '2026-03-28T10:00:00.000Z' }] })
      .mockResolvedValueOnce({ versions: [] });
    pullRecordsForFamilies.mockResolvedValueOnce({ pulled: 1 });

    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
      refreshStateForFamilies: vi.fn(async () => {}),
    });

    const result = await store.repairPendingWriteTargetsFromTower(
      store.getPendingWriteRepairTargets(pendingRows),
      { pendingWrites: pendingRows },
    );

    expect(result).toMatchObject({
      repaired: 1,
      cleared: 1,
      attempted: 2,
      skippedMissing: 1,
      failures: [],
    });
    expect(removePendingWrite).toHaveBeenCalledWith(41);
    expect(removePendingWrite).not.toHaveBeenCalledWith(42);
    expect(pullRecordsForFamilies).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      [documentFamilyHash],
      expect.objectContaining({ forceFull: true, backendUrl: 'https://tower.example.com' }),
    );
    expect(store.refreshStateForFamilies).toHaveBeenCalledWith(['document']);
  });

});

// ---------------------------------------------------------------------------
// Sync quarantine
// ---------------------------------------------------------------------------
describe('sync quarantine', () => {
  it('hasSyncQuarantine reflects quarantine array', () => {
    const s1 = createStore({ syncQuarantine: [] });
    expect(s1.hasSyncQuarantine).toBe(false);

    const s2 = createStore({ syncQuarantine: [{ record_id: 'r1' }] });
    expect(s2.hasSyncQuarantine).toBe(true);
  });

  it('syncQuarantineRecordLabel truncates long IDs', () => {
    const { fn } = bindMethod('syncQuarantineRecordLabel');
    expect(fn({ record_id: 'abcdefghijklmnopqrst' })).toBe('abcdefgh…qrst');
    expect(fn({ record_id: 'short' })).toBe('short');
    expect(fn({})).toBe('Unknown record');
  });

  it('formatSyncQuarantineTimestamp handles various inputs', () => {
    const { fn } = bindMethod('formatSyncQuarantineTimestamp');
    expect(fn(null)).toBe('');
    expect(fn('')).toBe('');
    expect(fn('invalid-date')).toBe('invalid-date');
    // Valid ISO date
    const result = fn('2024-01-15T12:00:00Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Sync cadence
// ---------------------------------------------------------------------------
describe('getSyncCadenceMs', () => {
  it('returns null when not signed in', () => {
    const { fn } = bindMethod('getSyncCadenceMs', { session: null });
    expect(fn()).toBeNull();
  });

  it('returns null when no backend', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: '',
    });
    expect(fn()).toBeNull();
  });

  it('returns FAST_SYNC_MS for chat with channel selected', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
    });
    expect(fn()).toBe(1000);
  });

  it('returns FAST_SYNC_MS for docs section', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'docs',
    });
    expect(fn()).toBe(1000);
  });

  it('returns FAST_SYNC_MS for scopes settings tab', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'settings',
      settingsTab: 'scopes',
    });
    expect(fn()).toBe(1000);
  });

  it('returns FAST_SYNC_MS for flows settings tab', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'settings',
      settingsTab: 'flows',
    });
    expect(fn()).toBe(1000);
  });

  it('returns IDLE_SYNC_MS for other sections', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'status',
      selectedChannelId: null,
    });
    expect(fn()).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Sync lifecycle
// ---------------------------------------------------------------------------
describe('stopBackgroundSync', () => {
  it('clears timer', () => {
    const timer = setTimeout(() => {}, 10000);
    const { fn, store } = bindMethod('stopBackgroundSync', {
      backgroundSyncTimer: timer,
    });
    fn();
    expect(store.backgroundSyncTimer).toBeNull();
  });
});

describe('scheduleBackgroundSync', () => {
  it('sets a timer', () => {
    const { fn, store } = bindMethod('scheduleBackgroundSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
    });
    fn(100);
    expect(store.backgroundSyncTimer).not.toBeNull();
    clearTimeout(store.backgroundSyncTimer);
  });

  it('clears timer when cadence is null', () => {
    const { fn, store } = bindMethod('scheduleBackgroundSync', {
      session: null,
      backgroundSyncTimer: 123,
    });
    fn();
    expect(store.backgroundSyncTimer).toBeNull();
  });
});

describe('backgroundSyncTick', () => {
  it('clears catch-up overlay when no sync cadence is available', async () => {
    const { fn, store } = bindMethod('backgroundSyncTick', {
      catchUpSyncActive: true,
      getSyncCadenceMs: vi.fn(() => null),
    });

    await fn();

    expect(store.catchUpSyncActive).toBe(false);
  });

  it('refreshes PG channels during background tick when chat is active', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const refreshChannels = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('backgroundSyncTick', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
      refreshChannels,
      FAST_SYNC_MS: 1000,
      IDLE_SYNC_MS: 5000,
    });

    await fn();

    expect(refreshChannels).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Sync session UI
// ---------------------------------------------------------------------------
describe('updateSyncSession', () => {
  it('merges updates into syncSession', () => {
    const { fn, store } = bindMethod('updateSyncSession');
    fn({ phase: 'pushing', pushed: 5, pushTotal: 10 });
    expect(store.syncSession.phase).toBe('pushing');
    expect(store.syncSession.pushed).toBe(5);
  });
});

describe('sync family progress helpers', () => {
  it('initializeSyncFamilyProgress seeds pending families', () => {
    const { fn, store } = bindMethod('initializeSyncFamilyProgress');
    fn();
    expect(store.syncFamilyProgress.length).toBeGreaterThan(0);
    expect(store.syncFamilyProgress.every((family) => family.status === 'pending')).toBe(true);
  });

  it('handleSyncProgressUpdate marks manual sync families active and done', () => {
    const { fn, store } = bindMethod('handleSyncProgressUpdate', {
      syncSession: {
        state: 'syncing',
        phase: 'checking',
        startedAt: null,
        finishedAt: null,
        lastSuccessAt: null,
        manual: true,
        error: null,
        heartbeat: false,
        pushed: 0,
        pushTotal: 0,
        pulled: 0,
        completedFamilies: 0,
        totalFamilies: 0,
        currentFamily: null,
        currentFamilyHash: null,
      },
      syncFamilyProgress: [
        { id: 'channel', hash: 'family:channel', label: 'Channels', status: 'pending' },
        { id: 'task', hash: 'family:task', label: 'Tasks', status: 'pending' },
      ],
    });

    fn({ phase: 'pulling', currentFamily: 'Channels', currentFamilyHash: 'family:channel', completedFamilies: 0, totalFamilies: 2, pulled: 0 });
    expect(store.syncFamilyProgress[0].status).toBe('active');

    fn({ phase: 'pulling', currentFamily: 'Channels', currentFamilyHash: 'family:channel', completedFamilies: 1, totalFamilies: 2, pulled: 5 });
    expect(store.syncFamilyProgress[0].status).toBe('done');
  });

  it('refreshStateForSyncFamilyHashes maps worker family hashes back to local state refreshes', async () => {
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('refreshStateForSyncFamilyHashes', {
      refreshSyncStatus,
    });
    await fn([getSyncFamilyHash('chat_message')], {
      refreshSyncStatus: false,
      refreshRecentChanges: false,
    });

    expect(store.refreshMessages).toHaveBeenCalledTimes(1);
    expect(refreshSyncStatus).not.toHaveBeenCalled();
    expect(store.refreshStatusRecentChanges).not.toHaveBeenCalled();
  });

  it('refreshes affected state when SSE worker pull completes', () => {
    const refreshStateForSyncFamilyHashes = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('handleSSEStatus', {
      refreshStateForSyncFamilyHashes,
    });

    fn({
      status: 'pull-complete',
      families: [getSyncFamilyHash('chat_message')],
    });

    expect(refreshStateForSyncFamilyHashes).toHaveBeenCalledWith(
      [getSyncFamilyHash('chat_message')],
      {
        refreshSyncStatus: false,
        refreshRecentChanges: false,
      },
    );
  });

  it('refreshes PG channels when pull-complete happens in PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    hydrateTowerPgEventUpdates.mockResolvedValueOnce({ appliedTargets: 0, fallbackEvents: 0, events: 0 });
    const refreshChannels = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('handleSSEStatus', {
      refreshChannels,
    });

    fn({
      status: 'pull-complete',
      families: [getSyncFamilyHash('chat_message')],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshChannels).toHaveBeenCalledTimes(1);
  });

  it('hydrates targeted PG event updates without broad channel refresh', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    hydrateTowerPgEventUpdates.mockResolvedValueOnce({ appliedTargets: 1, fallbackEvents: 0, events: 1 });
    const refreshChannels = vi.fn().mockResolvedValue(undefined);
    const pgEvents = [{ entity_type: 'message', channel_id: 'channel-1' }];
    const { fn, store } = bindMethod('handleSSEStatus', {
      refreshChannels,
    });

    fn({
      status: 'pull-complete',
      families: ['flightdeck_pg'],
      pgEvents,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(hydrateTowerPgEventUpdates).toHaveBeenCalledWith(expect.any(Object), pgEvents);
    expect(hydrateTowerPgEventUpdates.mock.calls.at(-1)[0]).toBe(store);
    expect(refreshChannels).not.toHaveBeenCalled();
  });
});

describe('syncProgressLabel', () => {
  it('returns empty for idle', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'idle';
    expect(fn()).toBe('');
  });

  it('returns checking label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'checking';
    expect(fn()).toBe('Checking...');
  });

  it('returns manual checking label for full sync', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'checking';
    store.syncSession.manual = true;
    expect(fn()).toBe('Starting full sync...');
  });

  it('returns pushing label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'pushing';
    store.syncSession.pushed = 3;
    store.syncSession.pushTotal = 10;
    expect(fn()).toBe('Pushing 3 / 10');
  });

  it('returns PG task background write label', () => {
    const { fn, store } = bindMethod('syncProgressLabel', {
      isTowerPgMode: true,
    });
    store.syncSession.phase = 'pushing';
    store.syncSession.currentFamily = 'tasks';
    store.syncSession.pushed = 3;
    store.syncSession.pushTotal = 10;
    expect(fn()).toBe('Updating tasks 3 / 10');
  });

  it('returns pulling label with family', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'pulling';
    store.syncSession.currentFamily = 'tasks';
    store.syncSession.completedFamilies = 2;
    store.syncSession.totalFamilies = 5;
    expect(fn()).toBe('Fetching tasks (2 / 5 collections)');
  });

  it('returns applying label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'applying';
    expect(fn()).toBe('Applying...');
  });

  it('returns error label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'error';
    expect(fn()).toBe('Sync error');
  });
});

describe('syncProgressPercent', () => {
  it('returns 0 for idle', () => {
    const { fn } = bindMethod('syncProgressPercent');
    expect(fn()).toBe(0);
  });

  it('returns 5 for checking', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'checking';
    expect(fn()).toBe(5);
  });

  it('returns 100 for done', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'done';
    expect(fn()).toBe(100);
  });

  it('returns proportional for pushing', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'pushing';
    store.syncSession.pushed = 5;
    store.syncSession.pushTotal = 10;
    expect(fn()).toBe(25);
  });
});

describe('lastSyncTimeLabel', () => {
  it('returns Never when no last success', () => {
    const { fn } = bindMethod('lastSyncTimeLabel');
    expect(fn()).toBe('Never');
  });

  it('returns Just now for recent sync', () => {
    const { fn, store } = bindMethod('lastSyncTimeLabel');
    store.syncSession.lastSuccessAt = Date.now() - 5000;
    expect(fn()).toBe('Just now');
  });

  it('returns minutes ago', () => {
    const { fn, store } = bindMethod('lastSyncTimeLabel');
    store.syncSession.lastSuccessAt = Date.now() - 180000; // 3 minutes
    expect(fn()).toBe('3m ago');
  });

  it('returns encrypted sync off when record sync is disabled', () => {
    const { fn, store } = bindMethod('lastSyncTimeLabel', {
      syncStatus: 'disabled',
    });
    expect(fn()).toBe('Encrypted sync off');
  });

  it('returns PG live status for connected Postgres workspaces', () => {
    const { fn } = bindMethod('lastSyncTimeLabel', {
      isTowerPgMode: true,
      avatarConnectionStatus: 'tower-pg-connected',
    });
    expect(fn()).toBe('Live');
  });

  it('returns PG local cache status for offline Postgres workspaces', () => {
    const { fn } = bindMethod('lastSyncTimeLabel', {
      isTowerPgMode: true,
      avatarConnectionStatus: 'local-only',
    });
    expect(fn()).toBe('Local cache');
  });
});

describe('runAccessPruneOnLogin', () => {
  it('leaves encrypted-record mode access pruning unchanged', async () => {
    const { fn, store } = bindMethod('runAccessPruneOnLogin', {
      session: { npub: 'npub1viewer' },
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(pruneOnLogin).toHaveBeenCalledWith(
      'npub1viewer',
      'npub1owner',
      expect.objectContaining({
        workspaceDbKey: store.workspaceDbKey,
      }),
    );
  });

  it('does not prune encrypted-record access state in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn } = bindMethod('runAccessPruneOnLogin', {
      session: { npub: 'npub1viewer' },
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(pruneOnLogin).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// performSync
// ---------------------------------------------------------------------------
describe('performSync', () => {
  it('does not start encrypted record sync when Tower PG mode is active', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const prepareCheckoutRequiredPendingWrites = vi.fn().mockResolvedValue({ prepared: 0, blocked: 0, skipped: 0 });
    const { fn, store } = bindMethod('performSync', {
      session: { npub: 'npub1me', method: 'extension' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
      prepareCheckoutRequiredPendingWrites,
    });

    const result = await fn({ silent: false, forceFull: true, manual: true });

    expect(result).toEqual({ pushed: 0, pulled: 0, pruned: 0, disabled: true });
    expect(runSync).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
    expect(prepareCheckoutRequiredPendingWrites).not.toHaveBeenCalled();
    expect(store.syncStatus).toBe('disabled');
    expect(store.syncSession.state).toBe('disabled');
    expect(store.lastSyncTimeLabel()).toBe('Encrypted sync off');
  });

  it('keeps silent no-op syncs on the cheap path', async () => {
    runSync.mockResolvedValueOnce({ pushed: 0, pulled: 0, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshStatusRecentChanges = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const loadDocComments = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('performSync', {
      session: { npub: 'npub1me', method: 'extension' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
      refreshSyncStatus,
      refreshStatusRecentChanges,
      refreshWorkspaceSettings,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      loadDocComments,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    const result = await fn({ silent: true });

    expect(result).toEqual({ pushed: 0, pulled: 0, pruned: 0 });
    expect(runSync).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      expect.any(Function),
      expect.objectContaining({
        authMethod: 'extension',
        backendUrl: 'https://backend.example.com',
        workspaceDbKey: 'npub1owner',
      }),
    );
    expect(refreshGroups).toHaveBeenCalledWith({
      minIntervalMs: 300000,
      maxAgeMs: 86400000,
    });
    expect(refreshWorkspaceSettings).not.toHaveBeenCalled();
    expect(ensureTaskFamilyBackfill).not.toHaveBeenCalled();
    expect(ensureTaskBoardScopeSetup).not.toHaveBeenCalled();
    expect(loadDocComments).not.toHaveBeenCalled();
    expect(refreshStatusRecentChanges).not.toHaveBeenCalled();
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: false });
  });

  it('refreshes derived state when silent sync pulls remote changes', async () => {
    runSync.mockResolvedValueOnce({ pushed: 0, pulled: 3, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const refreshAudioNotes = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('performSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      refreshSyncStatus,
      refreshWorkspaceSettings,
      refreshAudioNotes,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    await fn({ silent: true });

    expect(refreshWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(refreshAudioNotes).toHaveBeenCalledTimes(1);
    expect(ensureTaskFamilyBackfill).toHaveBeenCalledTimes(1);
    expect(ensureTaskBoardScopeSetup).toHaveBeenCalledTimes(1);
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: true });
  });

  it('refreshes pulled chat state after worker-side sync materializes messages', async () => {
    runSync.mockImplementationOnce(async (_owner, _viewer, onProgress) => {
      onProgress({
        phase: 'pulling',
        currentFamily: 'Chat messages',
        currentFamilyHash: getSyncFamilyHash('chat_message'),
        completedFamilies: 0,
        totalFamilies: 1,
        pulled: 0,
      });
      return { pushed: 0, pulled: 2, pruned: 0 };
    });
    const refreshMessages = vi.fn().mockResolvedValue(undefined);
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('performSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      refreshMessages,
      refreshSyncStatus,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    await fn({ silent: true });

    expect(refreshMessages).toHaveBeenCalledTimes(1);
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: true });
  });

  it('returns early when not signed in', async () => {
    const { fn, store } = bindMethod('performSync', { session: null });
    const result = await fn({ silent: true });
    expect(result).toEqual({ pushed: 0, pulled: 0 });
  });

  it('sets error when not configured and not silent', async () => {
    const { fn, store } = bindMethod('performSync', {
      session: null,
      backendUrl: '',
    });
    await fn({ silent: false });
    expect(store.error).toBe('Configure setup first');
  });

  it('opens sync progress modal and forces full sync for manual runs', async () => {
    runSync.mockResolvedValueOnce({ pushed: 2, pulled: 10, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('performSync', {
      session: { npub: 'npub1me', method: 'extension' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
      refreshSyncStatus,
      refreshWorkspaceSettings,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    await fn({ silent: false, forceFull: true, manual: true });

    expect(store.showSyncProgressModal).toBe(true);
    expect(store.syncSession.manual).toBe(true);
    expect(store.syncFamilyProgress.length).toBeGreaterThan(0);
    expect(runSync).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      expect.any(Function),
      expect.objectContaining({
        forceFull: true,
      }),
    );
  });
});

describe('performTowerPgFullSync', () => {
  it('hydrates PG workspace collections with progress state', async () => {
    const refreshGroups = vi.fn().mockResolvedValue([{ group_id: 'group-1' }]);
    const refreshScopes = vi.fn().mockResolvedValue([{ record_id: 'scope-1' }]);
    const refreshChannels = vi.fn().mockResolvedValue([{ record_id: 'channel-1' }]);
    const refreshTasks = vi.fn().mockResolvedValue([{ record_id: 'task-1' }]);
    const refreshDocuments = vi.fn().mockResolvedValue([{ record_id: 'doc-1', pg_record_type: 'document' }]);
    const refreshAudioNotes = vi.fn().mockResolvedValue([{ record_id: 'audio-1' }]);
    const refreshDailyNotes = vi.fn().mockResolvedValue([{ record_id: 'daily-1' }]);
    const refreshPersonalWapps = vi.fn().mockResolvedValue([{ record_id: 'wapp-1' }]);
    const { fn, store } = bindMethod('performTowerPgFullSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      tasks: [{ record_id: 'task-1', record_state: 'active' }],
      documents: [{ record_id: 'doc-1', record_state: 'active', pg_record_type: 'document' }],
      refreshGroups,
      refreshScopes,
      refreshChannels,
      refreshTasks,
      refreshDocuments,
      refreshAudioNotes,
      refreshDailyNotes,
      refreshPersonalWapps,
    });

    const result = await fn();

    expect(result).toEqual({ pushed: 0, pulled: 10, pruned: 0, pgMode: true });
    expect(refreshGroups).toHaveBeenCalledWith({ force: true, minIntervalMs: 0 });
    expect(refreshScopes).toHaveBeenCalledTimes(1);
    expect(refreshChannels).toHaveBeenCalledTimes(1);
    expect(refreshTasks).toHaveBeenCalledTimes(1);
    expect(hydrateTowerPgTaskComments.mock.calls[0][0]).toBe(store);
    expect(hydrateTowerPgTaskComments.mock.calls[0][1]).toBe('task-1');
    expect(refreshDocuments).toHaveBeenCalledTimes(1);
    expect(hydrateTowerPgDocComments.mock.calls[0][0]).toBe(store);
    expect(hydrateTowerPgDocComments.mock.calls[0][1]).toBe('doc-1');
    expect(refreshAudioNotes).toHaveBeenCalledTimes(1);
    expect(refreshDailyNotes).toHaveBeenCalledTimes(1);
    expect(refreshPersonalWapps).toHaveBeenCalledTimes(1);
    expect(store.showSyncProgressModal).toBe(true);
    expect(store.syncStatus).toBe('synced');
    expect(store.syncSession.phase).toBe('done');
    expect(store.syncFamilyProgress.every((family) => family.status === 'done')).toBe(true);
  });

  it('surfaces PG full sync failures in the progress modal', async () => {
    const refreshGroups = vi.fn().mockRejectedValue(new Error('PG is offline'));
    const { fn, store } = bindMethod('performTowerPgFullSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
    });

    await expect(fn()).rejects.toThrow('PG is offline');

    expect(store.showSyncProgressModal).toBe(true);
    expect(store.syncStatus).toBe('error');
    expect(store.syncSession.phase).toBe('error');
    expect(store.syncSession.error).toBe('PG is offline');
    expect(store.syncFamilyProgress[0].status).toBe('error');
  });
});

describe('PG mode encrypted record sync startup guard', () => {
  it('leaves encrypted-record mode access pruning untouched', async () => {
    const { fn } = bindMethod('runAccessPruneOnLogin', {
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      currentWorkspaceKey: 'workspace:npub1owner',
    });

    await fn();

    expect(pruneOnLogin).toHaveBeenCalledWith('npub1me', 'npub1owner', {
      workspaceDbKey: 'workspace:npub1owner',
    });
  });

  it('does not run encrypted-record access pruning in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn } = bindMethod('runAccessPruneOnLogin', {
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      currentWorkspaceKey: 'workspace:npub1owner',
    });

    await fn();

    expect(pruneOnLogin).not.toHaveBeenCalled();
  });

  it('does not inspect encrypted pending writes or quarantine when refreshing PG-mode sync status', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const refreshUnreadFlags = vi.fn().mockResolvedValue(undefined);
    const refreshSyncQuarantine = vi.fn().mockResolvedValue([{ row_id: 1 }]);
    const { fn, store } = bindMethod('refreshSyncStatus', {
      syncStatus: 'synced',
      refreshUnreadFlags,
      refreshSyncQuarantine,
    });

    await fn();

    expect(getPendingWrites).not.toHaveBeenCalled();
    expect(refreshSyncQuarantine).not.toHaveBeenCalled();
    expect(refreshUnreadFlags).toHaveBeenCalledTimes(1);
    expect(store.syncStatus).toBe('disabled');
    expect(store.syncSession.state).toBe('disabled');
  });

  it('leaves encrypted-record mode sync status refresh untouched', async () => {
    getPendingWrites.mockResolvedValueOnce([{ row_id: 1, record_id: 'task-1' }]);
    const refreshUnreadFlags = vi.fn().mockResolvedValue(undefined);
    const refreshSyncQuarantine = vi.fn().mockResolvedValue([]);
    const { fn, store } = bindMethod('refreshSyncStatus', {
      syncStatus: 'synced',
      refreshUnreadFlags,
      refreshSyncQuarantine,
    });

    await fn();

    expect(getPendingWrites).toHaveBeenCalledTimes(1);
    expect(refreshSyncQuarantine).toHaveBeenCalledTimes(1);
    expect(refreshUnreadFlags).toHaveBeenCalledTimes(1);
    expect(store.syncStatus).toBe('unsynced');
  });

  it('leaves encrypted-record mode background startup untouched', () => {
    const { fn, store } = bindMethod('ensureBackgroundSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      workspaceOwnerNpub: 'npub1owner',
      connectSSEStream: vi.fn(),
    });

    fn();

    expect(startWorkerFlushTimer).toHaveBeenCalledWith(
      'npub1owner',
      'https://backend.example.com',
      store.workspaceDbKey,
      expect.objectContaining({
        checkoutPolicyConfig: store.recordCheckoutPolicyConfig,
      }),
    );
    expect(store.connectSSEStream).toHaveBeenCalledWith({ reason: 'ensure-background-sync' });
  });

  it('skips the encrypted worker timer but keeps SSE in Tower PG mode', () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn, store } = bindMethod('ensureBackgroundSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      workspaceOwnerNpub: 'npub1owner',
      connectSSEStream: vi.fn(),
    });

    fn();

    expect(startWorkerFlushTimer).not.toHaveBeenCalled();
    expect(store.connectSSEStream).toHaveBeenCalledWith({ reason: 'ensure-background-sync' });
    expect(store.backgroundSyncTimer).not.toBeNull();
    clearTimeout(store.backgroundSyncTimer);
    expect(store.syncStatus).toBe('disabled');
    expect(store.syncSession.state).toBe('disabled');
  });

  it('opens the SSE stream in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn, store } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
      currentWorkspace: { workspaceId: 'workspace-1' },
    });

    const result = await fn();

    expect(result).toBe(true);
    expect(connectSSE).toHaveBeenCalledTimes(1);
    const options = connectSSE.mock.calls[0][5];
    expect(options.pgMode).toBe(true);
    expect(options.workspaceId).toBe('workspace-1');
    expect(createNip98AuthHeader).toHaveBeenCalledWith(
      'https://tower.example/api/v4/flightdeck-pg/workspaces/workspace-1/events/stream',
      'GET',
      null,
    );
  });
});

describe('syncNow', () => {
  it('closes the avatar menu and requests a manual full sync', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn, store } = bindMethod('syncNow', {
      showAvatarMenu: true,
      performSync,
      ensureBackgroundSync,
    });

    await fn();

    expect(store.showAvatarMenu).toBe(false);
    expect(performSync).toHaveBeenCalledWith({ silent: false, forceFull: true, manual: true });
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });

  it('runs the Tower PG full sync path in PG mode', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const performTowerPgFullSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn, store } = bindMethod('syncNow', {
      isTowerPgMode: true,
      showAvatarMenu: true,
      performSync,
      performTowerPgFullSync,
      ensureBackgroundSync,
    });

    await fn();

    expect(store.showAvatarMenu).toBe(false);
    expect(performTowerPgFullSync).toHaveBeenCalledWith({ manual: true });
    expect(performSync).not.toHaveBeenCalled();
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureTaskFamilyBackfill
// ---------------------------------------------------------------------------
describe('ensureTaskFamilyBackfill', () => {
  it('returns false when already backfilled', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      hasForcedTaskFamilyBackfill: true,
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when no session', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: null,
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when tasks exist', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      tasks: [{ id: 't1' }],
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when no groups', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      groups: [],
      tasks: [],
    });
    expect(await fn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// restoreSelectedFamiliesFromSuperBased
// ---------------------------------------------------------------------------
describe('restoreSelectedFamiliesFromSuperBased', () => {
  it('sets error when no families selected', async () => {
    const { fn, store } = bindMethod('restoreSelectedFamiliesFromSuperBased', {
      repairSelectedFamilyIds: [],
    });
    await fn();
    expect(store.repairError).toBe('Select at least one record family.');
  });
});

describe('PG mode encrypted-record repair guard', () => {
  it('does not clear local family state or pull encrypted records from restoreSelectedFamiliesFromSuperBased in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn, store } = bindMethod('restoreSelectedFamiliesFromSuperBased', {
      repairSelectedFamilyIds: ['task'],
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
    });

    await fn();

    expect(getPendingWritesByFamilies).not.toHaveBeenCalled();
    expect(clearRuntimeFamilies).not.toHaveBeenCalled();
    expect(clearSyncStateForFamilies).not.toHaveBeenCalled();
    expect(clearSyncQuarantineForFamilies).not.toHaveBeenCalled();
    expect(pullRecordsForFamilies).not.toHaveBeenCalled();
    expect(store.repairError).toContain('Tower PG mode active');
    expect(store.repairBusy).toBe(false);
  });

  it('leaves encrypted-record family restore unchanged in default mode', async () => {
    pullRecordsForFamilies.mockResolvedValueOnce({ pulled: 1 });
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
      refreshStateForFamilies: vi.fn().mockResolvedValue(undefined),
      refreshSyncQuarantine: vi.fn().mockResolvedValue(undefined),
    });

    const result = await store.restoreFamiliesFromSuperBased(['task'], { confirm: false });

    expect(result).toEqual({ cancelled: false, restored: 1 });
    expect(getPendingWritesByFamilies).toHaveBeenCalledWith(['task']);
    expect(clearRuntimeFamilies).toHaveBeenCalledWith(['task']);
    expect(clearSyncStateForFamilies).toHaveBeenCalledWith(['task']);
    expect(clearSyncQuarantineForFamilies).toHaveBeenCalledWith(['task']);
    expect(pullRecordsForFamilies).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      [getSyncFamilyHash('task')],
      expect.objectContaining({ forceFull: true, backendUrl: 'https://tower.example.com' }),
    );
  });

  it('does not clear or pull encrypted records from retrySyncQuarantineIssue in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const { fn, store } = bindMethod('retrySyncQuarantineIssue', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
    });

    await fn({ family_id: 'task', record_id: 'task-1' });

    expect(clearRuntimeFamilies).not.toHaveBeenCalled();
    expect(clearSyncStateForFamilies).not.toHaveBeenCalled();
    expect(clearSyncQuarantineForFamilies).not.toHaveBeenCalled();
    expect(pullRecordsForFamilies).not.toHaveBeenCalled();
    expect(store.syncQuarantineError).toContain('Tower PG mode active');
    expect(store.syncQuarantineBusy).toBe(false);
  });

  it('does not remove pending writes or pull encrypted records from repairPendingWriteTargetsFromTower in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([
      {
        row_id: 91,
        record_id: 'task-1',
        record_family_hash: getSyncFamilyHash('task'),
      },
    ]);
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
      getRecordStatusPendingWrites,
    });

    const result = await store.repairPendingWriteTargetsFromTower([
      { familyId: 'task', recordId: 'task-1', label: 'Task One' },
    ]);

    expect(result).toMatchObject({ disabled: true, repaired: 0, cleared: 0, attempted: 0 });
    expect(getRecordStatusPendingWrites).not.toHaveBeenCalled();
    expect(fetchRecordHistory).not.toHaveBeenCalled();
    expect(removePendingWrite).not.toHaveBeenCalled();
    expect(pullRecordsForFamilies).not.toHaveBeenCalled();
    expect(store.pendingWritesError).toContain('Tower PG mode active');
  });

  it('does not enqueue encrypted record pulls from pullFamiliesFromBackend in Tower PG mode', async () => {
    isTowerPgBackendMode.mockReturnValue(true);
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
    });

    const result = await store.pullFamiliesFromBackend(['task'], { forceFull: true });

    expect(result).toMatchObject({ disabled: true, pulled: 0 });
    expect(pullRecordsForFamilies).not.toHaveBeenCalled();
  });

  it('still enqueues encrypted record pulls from pullFamiliesFromBackend in default mode', async () => {
    pullRecordsForFamilies.mockResolvedValueOnce({ pulled: 1 });
    const store = createStore({
      session: { npub: 'npub1me', method: 'nsec' },
      backendUrl: 'https://tower.example.com',
    });

    await store.pullFamiliesFromBackend(['task'], { forceFull: true });

    expect(pullRecordsForFamilies).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      [getSyncFamilyHash('task')],
      expect.objectContaining({
        authMethod: 'nsec',
        backendUrl: 'https://tower.example.com',
        forceFull: true,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// probeTaskOnTowerAndRepair
// ---------------------------------------------------------------------------
describe('probeTaskOnTowerAndRepair', () => {
  it('sets error when task id is missing', async () => {
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: '',
    });
    await fn();
    expect(store.repairError).toBe('Enter a task ID.');
  });

  it('reports when a task is not found on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [],
    });
    await fn();
    expect(store.repairError).toBe('Task not found on Tower for the current workspace/user view.');
  });

  it('reports success when the task exists on Tower and is already local', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [{ version: 1 }] });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [{ record_id: 'task-1' }],
    });
    await fn();
    expect(store.repairNotice).toContain('already present locally');
  });

  it('rebuilds the task family when the task exists on Tower but is missing locally', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [{ version: 1 }, { version: 2 }] });
    const restoreFamiliesFromSuperBased = vi.fn().mockImplementation(async () => {
      store.tasks = [{ record_id: 'task-1' }];
      return { cancelled: false, restored: 1 };
    });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [],
      restoreFamiliesFromSuperBased,
    });
    await fn();
    expect(restoreFamiliesFromSuperBased).toHaveBeenCalledWith(['task'], { confirm: false });
    expect(store.repairNotice).toContain('restored it locally');
  });
});

// ---------------------------------------------------------------------------
// record status modal
// ---------------------------------------------------------------------------
describe('record status modal', () => {
  it('opens and reports when a local task exists on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [
        { version: 1, updated_at: '2026-03-27T10:00:00.000Z' },
        { version: 2, updated_at: '2026-03-28T11:00:00.000Z' },
      ],
    });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      tasks: [{ record_id: 'task-1' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
    });

    await fn({ familyId: 'task', recordId: 'task-1', label: 'Task One' });

    expect(store.recordStatusModalOpen).toBe(true);
    expect(store.recordStatusTowerVersionCount).toBe(2);
    expect(store.recordStatusTowerUpdatedAt).toBe('2026-03-28T11:00:00.000Z');
    expect(store.recordStatusLocalPresent).toBe(true);
    expect(store.recordStatusNotice).toContain('local copy is present');
  });

  it('treats archived WApps as local records in record status', async () => {
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-05-15T10:00:00.000Z' }],
    });
    const wappFamilyHash = getSyncFamilyHash('wapp');
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      wapps: [{
        record_id: 'wapp-1',
        owner_npub: 'npub1owner',
        title: 'Proposal',
        group_ids: ['group-1'],
        status: 'archived',
        record_state: 'archived',
        version: 2,
        sync_status: 'pending',
      }],
      groups: [{ group_id: 'group-1', name: 'WApp Editors' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([
        { row_id: 91, record_id: 'wapp-1', record_family_hash: wappFamilyHash },
      ]),
      resolveGroupId: vi.fn((groupRef) => groupRef),
    });

    await fn({ familyId: 'wapp', recordId: 'wapp-1', label: 'Proposal' });

    expect(store.recordStatusLocalPresent).toBe(true);
    expect(store.recordStatusLocalVersion).toBe(2);
    expect(store.recordStatusPendingWriteCount).toBe(1);
    expect(store.recordStatusWriteGroupRef).toBe('group-1');
    expect(store.recordStatusNotice).toContain('local copy is present');
    expect(store.getRecordStatusRecommendedResolution()).toBe('force_submit');
  });

  it('uses the latest Tower version as the visible count when history is compacted', async () => {
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [
        { version: 2, updated_at: '2026-03-28T11:00:00.000Z' },
      ],
    });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      tasks: [{ record_id: 'task-1' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
    });

    await fn({ familyId: 'task', recordId: 'task-1', label: 'Task One' });

    expect(store.recordStatusTowerVersionCount).toBe(2);
    expect(store.recordStatusTowerLatestVersion).toBe(2);
    expect(store.recordStatusNotice).toContain('2 versions');
    expect(store.recordStatusNotice).toContain('Use Tower copy is the recommended repair');
  });

  it('reports when a record is missing on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      documents: [{ record_id: 'doc-1' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
    });

    await fn({ familyId: 'document', recordId: 'doc-1', label: 'Doc One' });

    expect(store.recordStatusNotice).toBe('Doc One is missing on Tower. You can force submit this local snapshot as version 1.');
    expect(store.recordStatusTowerVersionCount).toBe(0);
  });

  it('derives task write groups from the attached scope when the local task row is stale', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      groups: [{ group_id: 'group-1', name: 'Scope Writers' }],
      tasks: [{
        record_id: 'task-1',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        board_group_id: null,
        group_ids: [],
        shares: [],
      }],
      buildTaskBoardAssignment: vi.fn().mockReturnValue({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      }),
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
        type: 'group',
        group_npub: groupId,
        access: 'write',
      }))),
    });

    await fn({ familyId: 'task', recordId: 'task-1', label: 'Task One' });

    expect(store.recordStatusWriteGroupRef).toBe('group-1');
    expect(store.recordStatusWriteGroupLabel).toBe('Scope Writers (group-1)');
    expect(store.recordStatusNotice).toBe('Task One is missing on Tower. You can force submit this local snapshot as version 1.');
  });

  it('force-pushes the current local snapshot plus local comments as fresh v1 records and clears stale pending writes', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const documentFamilyHash = getSyncFamilyHash('document');
    const commentFamilyHash = getSyncFamilyHash('comment');
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([
      { row_id: 11, record_id: 'doc-1', record_family_hash: documentFamilyHash, created_at: '2026-03-28T10:00:00.000Z', envelope: { version: 4 } },
      { row_id: 12, record_id: 'comment-1', record_family_hash: commentFamilyHash, created_at: '2026-03-28T11:00:00.000Z', envelope: { version: 2 } },
    ]);
    const getRecordStatusRelatedComments = vi.fn().mockResolvedValue([
      {
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'doc-1',
        target_record_family_hash: documentFamilyHash,
        body: 'hello',
        attachments: [],
        parent_comment_id: null,
      },
    ]);
    const removeRecordStatusPendingWrite = vi.fn().mockResolvedValue(undefined);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'doc-1',
      record_family_hash: documentFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn().mockResolvedValue({
      record_id: 'comment-1',
      record_family_hash: commentFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.documents = this.documents.map((entry) => entry.record_id === localRecord.record_id
        ? { ...entry, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const markRecordStatusCommentsSynced = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'document',
      recordStatusTargetId: 'doc-1',
      recordStatusTargetLabel: 'Doc One',
      recordStatusLocalPresent: true,
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner', group_ids: ['group-1'], shares: ['group-1'], version: 2, sync_status: 'pending' }],
      recordStatusTowerVersionCount: 0,
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments,
      removeRecordStatusPendingWrite,
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced,
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [
        expect.objectContaining({ record_id: 'doc-1', version: 1, previous_version: 0 }),
        expect.objectContaining({ record_id: 'comment-1', version: 1, previous_version: 0 }),
      ],
    });
    expect(removeRecordStatusPendingWrite).toHaveBeenCalledWith(11);
    expect(removeRecordStatusPendingWrite).toHaveBeenCalledWith(12);
    expect(store.recordStatusNotice).toContain('cleared accepted pending writes');
    expect(store.recordStatusNotice).toContain('Recreated 1 local comment');
    expect(store.recordStatusLocalPresent).toBe(true);
    expect(store.documents[0].version).toBe(1);
  });

  it('does not mark local record synced when Tower rejects the force-submit target', async () => {
    syncRecords.mockResolvedValueOnce({
      synced: 0,
      created: 0,
      updated: 0,
      rejected: [{ record_id: 'doc-1', code: 'write_group_forbidden', reason: 'writer is not a member of write group' }],
    });
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([
      { row_id: 11, record_id: 'doc-1', record_family_hash: getSyncFamilyHash('document'), created_at: '2026-03-28T10:00:00.000Z', envelope: { version: 4 } },
    ]);
    const removeRecordStatusPendingWrite = vi.fn().mockResolvedValue(undefined);
    const markRecordStatusLocalRecordSynced = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'document',
      recordStatusTargetId: 'doc-1',
      recordStatusTargetLabel: 'Doc One',
      recordStatusLocalPresent: true,
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner', group_ids: ['group-1'], shares: ['group-1'], version: 2, sync_status: 'pending' }],
      recordStatusTowerVersionCount: 1,
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([]),
      removeRecordStatusPendingWrite,
      buildRecordStatusEnvelope: vi.fn().mockResolvedValue({
        record_id: 'doc-1',
        record_family_hash: getSyncFamilyHash('document'),
        version: 2,
        previous_version: 1,
      }),
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced: vi.fn().mockResolvedValue(undefined),
      checkRecordStatusOnTower: vi.fn().mockResolvedValue(undefined),
    });

    await fn();

    expect(markRecordStatusLocalRecordSynced).not.toHaveBeenCalled();
    expect(removeRecordStatusPendingWrite).not.toHaveBeenCalled();
    expect(store.recordStatusError).toContain('Force submit rejected');
  });

  it('can restore a conflicted record status target from Tower instead of force-submitting stale local state', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const pendingRows = [
      {
        row_id: 51,
        record_id: 'task-1',
        record_family_hash: taskFamilyHash,
        envelope: {
          record_id: 'task-1',
          record_family_hash: taskFamilyHash,
          version: 6,
          previous_version: 5,
        },
      },
    ];
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 5, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    pullRecordsForFamilies.mockResolvedValueOnce({ pulled: 1 });
    const checkRecordStatusOnTower = vi.fn().mockResolvedValue(undefined);
    const refreshRecordStatusLocalContext = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('repairRecordStatusTargetFromTower', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://tower.example.com',
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-1',
      recordStatusTargetLabel: 'Task One',
      recordStatusTowerVersionCount: 5,
      recordStatusTowerLatestVersion: 5,
      recordStatusPendingWriteCount: 1,
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue(pendingRows),
      checkRecordStatusOnTower,
      refreshRecordStatusLocalContext,
      refreshStateForFamilies: vi.fn().mockResolvedValue(undefined),
    });

    await fn();

    expect(removePendingWrite).toHaveBeenCalledWith(51);
    expect(syncRecords).not.toHaveBeenCalled();
    expect(pullRecordsForFamilies).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      [taskFamilyHash],
      expect.objectContaining({ forceFull: true, backendUrl: 'https://tower.example.com' }),
    );
    expect(checkRecordStatusOnTower).toHaveBeenCalled();
    expect(refreshRecordStatusLocalContext).toHaveBeenCalled();
    expect(store.recordStatusNotice).toContain('Restored Task One from Tower');
  });

  it('force-pushes scope records with recovered delivery groups', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 0, updated: 1, rejected: [] });
    const scopeFamilyHash = getSyncFamilyHash('scope');
    const pendingRows = [
      {
        row_id: 71,
        record_id: 'scope-1',
        record_family_hash: scopeFamilyHash,
        envelope: {
          record_id: 'scope-1',
          record_family_hash: scopeFamilyHash,
          version: 3,
          previous_version: 2,
        },
      },
    ];
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      recordStatusFamilyId: 'scope',
      recordStatusTargetId: 'scope-1',
      recordStatusTargetLabel: 'Dakka',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 2,
      recordStatusTowerLatestVersion: 2,
      groups: [
        { group_id: 'group-private', private_member_npub: 'npub1me', member_npubs: ['npub1me'] },
        { group_id: 'group-dakka', name: 'Dakka Bot', member_npubs: ['npub1me'] },
      ],
      scopes: [{
        record_id: 'scope-1',
        owner_npub: 'npub1owner',
        title: 'Dakka',
        description: 'Dakka scope',
        level: 'l1',
        parent_id: null,
        l1_id: 'scope-1',
        l2_id: null,
        l3_id: null,
        l4_id: null,
        l5_id: null,
        group_ids: ['group-private', 'group-dakka'],
        version: 3,
        sync_status: 'pending',
        record_state: 'active',
      }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue(pendingRows),
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([]),
      getPreferredRecordWriteGroup: vi.fn(() => 'group-dakka'),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      checkRecordStatusOnTower: vi.fn().mockResolvedValue(undefined),
      refreshRecordStatusLocalContext: vi.fn().mockResolvedValue(undefined),
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [
        expect.objectContaining({
          record_id: 'scope-1',
          record_family_hash: 'mock:scope',
          version: 3,
          previous_version: 2,
          group_ids: ['group-private', 'group-dakka'],
          write_group_ref: 'group-dakka',
        }),
      ],
    });
    expect(removePendingWrite).toHaveBeenCalledWith(71);
    expect(store.scopes[0]).toMatchObject({
      record_id: 'scope-1',
      sync_status: 'synced',
      version: 3,
    });
    expect(store.recordStatusNotice).toContain('Force-submitted the current local snapshot as Scopes version 3');
  });

  it('force-pushes WApp visibility pending writes and marks the local WApp synced', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 0, updated: 1, rejected: [] });
    const wappFamilyHash = getSyncFamilyHash('wapp');
    const pendingRows = [
      {
        row_id: 81,
        record_id: 'wapp-1',
        record_family_hash: wappFamilyHash,
        envelope: {
          record_id: 'wapp-1',
          record_family_hash: wappFamilyHash,
          version: 2,
          previous_version: 1,
        },
      },
    ];
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      recordStatusFamilyId: 'wapp',
      recordStatusTargetId: 'wapp-1',
      recordStatusTargetLabel: 'Proposal',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 1,
      recordStatusTowerLatestVersion: 1,
      groups: [{ group_id: 'group-1', name: 'WApp Editors', member_npubs: ['npub1me'] }],
      wapps: [{
        record_id: 'wapp-1',
        owner_npub: 'npub1owner',
        workspace_owner_npub: 'npub1owner',
        title: 'Proposal',
        wapp_id: 'proposal',
        app_id: 'proposal-app',
        launch_url: 'https://apps.example.test/proposal',
        group_ids: ['group-1'],
        status: 'archived',
        record_state: 'archived',
        version: 2,
        sync_status: 'pending',
      }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue(pendingRows),
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([]),
      getPreferredRecordWriteGroup: vi.fn(() => 'group-1'),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      checkRecordStatusOnTower: vi.fn().mockResolvedValue(undefined),
      refreshRecordStatusLocalContext: vi.fn().mockResolvedValue(undefined),
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [
        expect.objectContaining({
          record_id: 'wapp-1',
          record_family_hash: 'mock:wapp',
          version: 2,
          previous_version: 1,
          group_ids: ['group-1'],
          write_group_ref: 'group-1',
          status: 'archived',
          record_state: 'archived',
        }),
      ],
    });
    expect(removePendingWrite).toHaveBeenCalledWith(81);
    expect(upsertWapp).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'wapp-1',
      sync_status: 'synced',
      version: 2,
    }));
    expect(store.wapps[0]).toMatchObject({
      record_id: 'wapp-1',
      sync_status: 'synced',
      version: 2,
    });
  });

  it('force-pushes scoped tasks using recovered scope groups and persists the repaired assignment locally', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const taskFamilyHash = getSyncFamilyHash('task');
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([]);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'task-1',
      record_family_hash: taskFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn().mockResolvedValue({
      record_id: 'comment-1',
      record_family_hash: getSyncFamilyHash('comment'),
      version: 1,
      previous_version: 0,
    });
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.tasks = this.tasks.map((entry) => entry.record_id === localRecord.record_id
        ? { ...localRecord, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-1',
      recordStatusTargetLabel: 'Task One',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 0,
      groups: [{ group_id: 'group-1', name: 'Scope Writers' }],
      tasks: [{
        record_id: 'task-1',
        owner_npub: 'npub1owner',
        title: 'Task One',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        board_group_id: null,
        group_ids: [],
        shares: [],
        version: 3,
        sync_status: 'pending',
      }],
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([{
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'task-1',
        target_record_family_hash: taskFamilyHash,
        body: 'hello',
        attachments: [],
        parent_comment_id: null,
      }]),
      removeRecordStatusPendingWrite: vi.fn().mockResolvedValue(undefined),
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced: vi.fn().mockResolvedValue(undefined),
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
      buildTaskBoardAssignment: vi.fn().mockReturnValue({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      }),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
        type: 'group',
        group_npub: groupId,
        access: 'write',
      }))),
    });

    await fn();

    expect(buildRecordStatusEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      board_group_id: 'group-1',
      group_ids: ['group-1'],
    }), 'task', { bootstrap: true });
    expect(buildRecordStatusCommentEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'comment-1',
    }), { targetGroupIds: ['group-1'] });
    expect(markRecordStatusLocalRecordSynced).toHaveBeenCalledWith('task', expect.objectContaining({
      board_group_id: 'group-1',
      group_ids: ['group-1'],
    }), { version: 1 });
    expect(store.tasks[0].board_group_id).toBe('group-1');
    expect(store.tasks[0].group_ids).toEqual(['group-1']);
  });

  it('bootstraps the current local snapshot when pending writes are missing', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([]);
    const removeRecordStatusPendingWrite = vi.fn().mockResolvedValue(undefined);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'doc-1',
      record_family_hash: getSyncFamilyHash('document'),
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn();
    const getRecordStatusRelatedComments = vi.fn().mockResolvedValue([]);
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.documents = this.documents.map((entry) => entry.record_id === localRecord.record_id
        ? { ...entry, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const markRecordStatusCommentsSynced = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'document',
      recordStatusTargetId: 'doc-1',
      recordStatusTargetLabel: 'Doc One',
      recordStatusLocalPresent: true,
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner', title: 'Doc One', content: 'hello', group_ids: ['group-1'], shares: ['group-1'], version: 3, sync_status: 'pending' }],
      recordStatusTowerVersionCount: 0,
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments,
      removeRecordStatusPendingWrite,
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced,
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({ record_id: 'doc-1', version: 1, previous_version: 0 })],
    });
    expect(removeRecordStatusPendingWrite).not.toHaveBeenCalled();
    expect(store.documents[0].version).toBe(1);
    expect(store.recordStatusNotice).toContain('Documents version 1');
  });
});

// ---------------------------------------------------------------------------
// dismissSyncQuarantineIssue / retrySyncQuarantineIssue / deleteLocalQuarantinedRecord
// ---------------------------------------------------------------------------
describe('quarantine actions', () => {
  it('retrySyncQuarantineIssue sets error for unknown family', async () => {
    const { fn, store } = bindMethod('retrySyncQuarantineIssue');
    await fn({ family_id: 'nonexistent_family_xyz' });
    expect(store.syncQuarantineError).toBe('Unknown sync family for this quarantine issue.');
  });

  it('deleteLocalQuarantinedRecord sets error for unknown family', async () => {
    const { fn, store } = bindMethod('deleteLocalQuarantinedRecord');
    await fn({ family_id: 'nonexistent_family_xyz' });
    expect(store.syncQuarantineError).toBe('Unknown sync family for this quarantine issue.');
  });
});

// ---------------------------------------------------------------------------
// syncNow
// ---------------------------------------------------------------------------
describe('syncNow', () => {
  it('calls performSync and ensureBackgroundSync', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      performSync,
      ensureBackgroundSync,
    });
    await fn();
    expect(performSync).toHaveBeenCalledWith({ silent: false, forceFull: true, manual: true });
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });

  it('calls performTowerPgFullSync and ensureBackgroundSync in PG mode', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const performTowerPgFullSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      isTowerPgMode: true,
      performSync,
      performTowerPgFullSync,
      ensureBackgroundSync,
    });
    await fn();
    expect(performTowerPgFullSync).toHaveBeenCalledWith({ manual: true });
    expect(performSync).not.toHaveBeenCalled();
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });

  it('does not throw when performSync fails', async () => {
    const performSync = vi.fn().mockRejectedValue(new Error('fail'));
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      performSync,
      ensureBackgroundSync,
    });
    await fn();
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE token regression — must use NIP-98, never bootstrap connection token
// ---------------------------------------------------------------------------
describe('connectSSEStream — NIP-98 auth token', () => {
  it('passes a NIP-98 token to the worker, not the connection token', async () => {
    const { fn, store } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
      superbasedTokenInput: 'CONNECTION_BOOTSTRAP_TOKEN_SHOULD_NOT_APPEAR',
    });

    await fn();

    expect(connectSSE).toHaveBeenCalledTimes(1);
    const [ownerNpub, viewerNpub, backendUrl, token] = connectSSE.mock.calls[0];

    // The token must be the base64 NIP-98 event, NOT the bootstrap token
    expect(token).not.toBe('CONNECTION_BOOTSTRAP_TOKEN_SHOULD_NOT_APPEAR');
    expect(token).not.toContain('superbased_connection');
    // It should be a base64 string extracted from "Nostr <base64>"
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('uses workspace key auth when available', async () => {
    getActiveWorkspaceKeySecretForAuth.mockReturnValue('deadbeef');

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(createNip98AuthHeaderForSecret).toHaveBeenCalledWith(
      'https://tower.example/api/v4/workspaces/npub1owner/stream',
      'GET',
      null,
      'deadbeef',
    );
    expect(createNip98AuthHeader).not.toHaveBeenCalled();
  });

  it('falls back to session auth when no workspace key', async () => {
    getActiveWorkspaceKeySecretForAuth.mockReturnValue(null);

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(createNip98AuthHeader).toHaveBeenCalledWith(
      'https://tower.example/api/v4/workspaces/npub1owner/stream',
      'GET',
      null,
    );
  });

  it('does not reconnect when the same SSE stream is already healthy', async () => {
    const store = createStore({
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
      sseStatus: 'connected',
    });
    store.sseConnectionKey = store.buildSSEConnectionKey();

    await store.connectSSEStream();

    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not call connectSSE when NIP-98 signing fails', async () => {
    createNip98AuthHeader.mockRejectedValueOnce(new Error('no signer'));
    getActiveWorkspaceKeySecretForAuth.mockReturnValue(null);

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not call connectSSE when missing session or backendUrl', async () => {
    const { fn: noSession } = bindMethod('connectSSEStream', {
      session: null,
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });
    await noSession();
    expect(connectSSE).not.toHaveBeenCalled();

    const { fn: noBackend } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: '',
      workspaceOwnerNpub: 'npub1owner',
    });
    await noBackend();
    expect(connectSSE).not.toHaveBeenCalled();
  });
});
