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
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      workspaceServiceNpub: 'npub1workspace',
      workspaceId: 'workspace-1',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
    });
  });

  it('selects PG workspaces without encrypted workspace key or app schema setup', async () => {
    const api = await import('../src/api.js');
    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
    };
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
    });
    store.syncWorkspaceProfileDraft = vi.fn();

    await store.selectWorkspace(workspace.workspaceKey, { pgVerified: true });

    expect(store.ensureWorkspaceSessionKey).not.toHaveBeenCalled();
    expect(api.registerWorkspaceApp).not.toHaveBeenCalled();
    expect(api.publishWorkspaceAppSchema).not.toHaveBeenCalled();
  });

  it('reverifies a cached same-signer PG workspace before selecting it after reload', async () => {
    const descriptor = {
      type: 'wingman_workspace_locator',
      tower_base_url: 'https://tower.example',
      identity: {
        tower_service_npub: 'npub1tower',
        workspace_service_npub: 'npub1workspace',
        workspace_owner_npub: 'npub1owner',
        workspace_id: 'workspace-1',
        app_npub: 'flightdeck_pg',
      },
    };
    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      towerServiceNpub: 'npub1tower',
      workspaceServiceNpub: 'npub1workspace',
      workspaceId: 'workspace-1',
      appNpub: 'flightdeck_pg',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
      pgDescriptor: descriptor,
    };
    const verifiedWorkspace = { ...workspace, pgMe: { actor: { npub: 'npub1user' } } };
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      verifyPgDescriptor: vi.fn().mockResolvedValue({
        descriptor,
        me: { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
      }),
      rememberVerifiedPgWorkspace: vi.fn(function remember() {
        this.knownWorkspaces = [verifiedWorkspace];
        return verifiedWorkspace;
      }),
    });

    await store.selectWorkspace(workspace.workspaceKey);

    expect(store.verifyPgDescriptor).toHaveBeenCalledWith(descriptor, {
      baseUrl: 'https://tower.example',
    });
    expect(store.rememberVerifiedPgWorkspace).toHaveBeenCalledWith(
      descriptor,
      { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
    );
    expect(store.selectedWorkspaceKey).toBe(workspace.workspaceKey);
    expect(store.currentWorkspaceOwnerNpub).toBe('npub1owner');
  });

  it('rejects a cached PG workspace scoped to a different signer before Tower calls', async () => {
    const workspace = {
      workspaceKey: 'pg:npub1other::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1other',
      pgBackendMode: true,
    };
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      verifyPgDescriptor: vi.fn(),
      rememberVerifiedPgWorkspace: vi.fn(),
    });

    await store.selectWorkspace(workspace.workspaceKey);

    expect(store.verifyPgDescriptor).not.toHaveBeenCalled();
    expect(store.selectedWorkspaceKey).toBe('');
    expect(store.currentWorkspaceOwnerNpub).toBe('');
    expect(store.showWorkspaceBootstrapModal).toBe(true);
  });
});
