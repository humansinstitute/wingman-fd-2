import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/db.js', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  upsertWorkspaceSettings: vi.fn(),
  openWorkspaceDb: vi.fn(),
  deleteWorkspaceDb: vi.fn(),
  clearRuntimeData: vi.fn().mockResolvedValue(undefined),
  addPendingWrite: vi.fn(),
  cacheStorageImage: vi.fn(),
  evictStorageImageCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/api.js', () => ({
  setBaseUrl: vi.fn(),
  createWorkspace: vi.fn(),
  fetchWorkspaceAppSchemas: vi.fn(),
  getWorkspaces: vi.fn(),
  listTowerPgWorkspaces: vi.fn(),
  publishWorkspaceAppSchema: vi.fn(),
  recoverWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  registerWorkspaceApp: vi.fn(),
  prepareStorageObject: vi.fn(),
  uploadStorageObject: vi.fn(),
  completeStorageObject: vi.fn(),
}));

function applyWorkspaceMixin(store) {
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(store.workspaceManagerMixin))) {
    if (Object.prototype.hasOwnProperty.call(store, key)) continue;
    Object.defineProperty(store, key, descriptor);
  }
  return store;
}

async function buildStore(overrides = {}) {
  const { workspaceManagerMixin } = await import('../src/workspace-manager.js');
  const store = {
    workspaceManagerMixin,
    knownWorkspaces: [],
    selectedWorkspaceKey: '',
    currentWorkspaceOwnerNpub: '',
    session: { npub: 'npub1user' },
    backendUrl: 'https://tower.example/',
    groups: [],
    workspaceProfileRowsByKey: {},
    showWorkspaceSwitcherMenu: false,
    workspaceSwitchPendingKey: '',
    workspaceSwitchPendingNpub: '',
    _workspaceProfileHydratedKeys: new Set(),
    channels: [],
    messages: [],
    documents: [],
    directories: [],
    tasks: [],
    schedules: [],
    audioNotes: [],
    taskComments: [],
    flows: [],
    approvals: [],
    chatProfiles: {},
    showNewScheduleModal: false,
    docCommentBackfillAttemptsByDocId: {},
    scopesLoaded: false,
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    selectedBoardId: null,
    startSharedLiveQueries: vi.fn(),
    stopWorkspaceLiveQueries: vi.fn(),
    revokeStorageImageObjectUrls: vi.fn(),
    cancelEditSchedule: vi.fn(),
    startWorkspaceLiveQueries: vi.fn(),
    readStoredTaskBoardId: vi.fn(() => null),
    validateSelectedBoardId: vi.fn(),
    normalizeSettingsTab: vi.fn(),
    persistWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    ensureWorkspaceSessionKey: vi.fn().mockResolvedValue(undefined),
    registerCurrentWorkspaceApp: vi.fn().mockResolvedValue(undefined),
    publishCurrentWorkspaceAppSchema: vi.fn().mockResolvedValue(undefined),
    refreshWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    syncWorkspaceProfileDraft: vi.fn(),
    getSenderAvatar: vi.fn(() => null),
    getInitials: vi.fn((value) => String(value || 'WS').slice(0, 2).toUpperCase()),
    mergeKnownWorkspaces(entries) {
      this.knownWorkspaces = entries;
    },
    ...overrides,
  };
  return applyWorkspaceMixin(store);
}

describe('PG workspace manager mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('loads remote workspaces from Tower PG discovery in PG mode', async () => {
    const api = await import('../src/api.js');
    api.listTowerPgWorkspaces.mockResolvedValue({
      workspaces: [{
        identity: {
          tower_service_npub: 'npub1tower',
          workspace_service_npub: 'npub1workspace',
          workspace_owner_npub: 'npub1owner',
          workspace_id: 'workspace-1',
          app_npub: 'flightdeck_pg',
        },
        label: 'Wingmen',
        description: 'PG workspace',
        capabilities: ['pg_scopes'],
      }],
    });
    const store = await buildStore();

    await store.loadRemoteWorkspaces();

    expect(api.listTowerPgWorkspaces).toHaveBeenCalledWith({
      baseUrl: 'https://tower.example',
      appNpub: expect.any(String),
    });
    expect(api.getWorkspaces).not.toHaveBeenCalled();
    expect(store.knownWorkspaces[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1owner',
      workspaceServiceNpub: 'npub1workspace',
      workspaceId: 'workspace-1',
      directHttpsUrl: 'https://tower.example',
      pgBackendMode: true,
    });
  });

  it('selects PG workspaces without encrypted workspace key or app schema setup', async () => {
    const api = await import('../src/api.js');
    const workspace = {
      workspaceKey: 'pg:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgBackendMode: true,
    };
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
    });
    store.syncWorkspaceProfileDraft = vi.fn();

    await store.selectWorkspace(workspace.workspaceKey);

    expect(store.ensureWorkspaceSessionKey).not.toHaveBeenCalled();
    expect(api.registerWorkspaceApp).not.toHaveBeenCalled();
    expect(api.publishWorkspaceAppSchema).not.toHaveBeenCalled();
  });
});
