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
  updateTowerPgWorkspace: vi.fn(),
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
    vi.unstubAllGlobals();
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

  it('does not let sparse Tower PG discovery clear an existing workspace avatar', async () => {
    const api = await import('../src/api.js');
    const { mergeWorkspaceEntries } = await import('../src/workspaces.js');
    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      workspaceServiceNpub: 'npub1workspace',
      workspaceId: 'workspace-1',
      towerServiceNpub: 'npub1tower',
      serviceNpub: 'npub1tower',
      appNpub: 'flightdeck_pg',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
      avatarUrl: 'storage://workspace-avatar-1',
    };
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
        avatar_url: null,
      }],
    });
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      currentWorkspaceOwnerNpub: 'npub1owner',
      mergeKnownWorkspaces(entries) {
        this.knownWorkspaces = mergeWorkspaceEntries(this.knownWorkspaces, entries);
      },
    });

    await store.loadRemoteWorkspaces();

    expect(store.knownWorkspaces).toHaveLength(1);
    expect(store.knownWorkspaces[0].avatarUrl).toBe('storage://workspace-avatar-1');
  });

  it('selects PG workspaces without encrypted workspace key or app schema setup', async () => {
    const api = await import('../src/api.js');
    const refreshGroups = vi.fn().mockResolvedValue([]);
    const loadLocalWorkspaceCoreData = vi.fn().mockResolvedValue({ scopes: [], channels: [] });
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
      refreshGroups,
      loadLocalWorkspaceCoreData,
      refreshScopes: vi.fn().mockResolvedValue([]),
      refreshChannels: vi.fn().mockResolvedValue([]),
      refreshTasks: vi.fn().mockResolvedValue([]),
      refreshDocuments: vi.fn().mockResolvedValue([]),
      refreshAudioNotes: vi.fn().mockResolvedValue([]),
    });
    store.syncWorkspaceProfileDraft = vi.fn();

    await store.selectWorkspace(workspace.workspaceKey, { pgVerified: true });

    expect(store.ensureWorkspaceSessionKey).not.toHaveBeenCalled();
    expect(loadLocalWorkspaceCoreData).toHaveBeenCalledWith({ syncRoute: false });
    expect(store.startWorkspaceLiveQueries).toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
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

  it('can restore a cached PG workspace locally before remote verification', async () => {
    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
    };
    const loadLocalWorkspaceCoreData = vi.fn().mockResolvedValue({ scopes: [], channels: [] });
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      verifyPgDescriptor: vi.fn(),
      rememberVerifiedPgWorkspace: vi.fn(),
      loadLocalWorkspaceCoreData,
    });

    await store.selectWorkspace(workspace.workspaceKey, { refresh: false, skipPgVerification: true });

    expect(store.verifyPgDescriptor).not.toHaveBeenCalled();
    expect(loadLocalWorkspaceCoreData).toHaveBeenCalledWith({ syncRoute: false });
    expect(store.localWorkspaceCoreLoadedForKey).toBe(workspace.workspaceKey);
    expect(store.selectedWorkspaceKey).toBe(workspace.workspaceKey);
    expect(store.currentWorkspaceOwnerNpub).toBe('npub1owner');
  });

  it('does not reload local PG core data when selecting the same already-loaded workspace', async () => {
    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
    };
    const loadLocalWorkspaceCoreData = vi.fn().mockResolvedValue({ scopes: [], channels: [] });
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      localWorkspaceCoreLoadedForKey: workspace.workspaceKey,
      loadLocalWorkspaceCoreData,
    });

    await store.selectWorkspace(workspace.workspaceKey, { refresh: false, pgVerified: true });

    expect(loadLocalWorkspaceCoreData).not.toHaveBeenCalled();
    expect(store.startWorkspaceLiveQueries).toHaveBeenCalled();
  });

  it('uploads PG workspace avatars without requiring a legacy admin group ref', async () => {
    const api = await import('../src/api.js');
    const db = await import('../src/db.js');
    api.uploadStorageObject.mockResolvedValue({ object_id: 'storage-avatar-1' });
    api.completeStorageObject.mockResolvedValue({ object_id: 'storage-avatar-1' });
    db.cacheStorageImage.mockResolvedValue(undefined);

    const workspace = {
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      workspaceId: 'workspace-1',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
      pgMe: { permissions: ['workspace.manage'] },
    };
    const prepareStorageObjectForCurrentWorkspace = vi.fn().mockResolvedValue({
      object_id: 'storage-avatar-1',
      upload_url: '',
    });
    const store = await buildStore({
      knownWorkspaces: [workspace],
      selectedWorkspaceKey: workspace.workspaceKey,
      currentWorkspaceOwnerNpub: 'npub1owner',
      session: { npub: 'npub1user' },
      groups: [],
      prepareStorageObjectForCurrentWorkspace,
      defaultPastedImageName: vi.fn(() => 'workspace-avatar.png'),
      sha256HexForBytes: vi.fn().mockResolvedValue('sha256-avatar'),
      rememberStorageImageUrl: vi.fn(),
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' });

    const result = await store.uploadWorkspaceAvatarFile(file);

    expect(result).toBe('storage://storage-avatar-1');
    expect(prepareStorageObjectForCurrentWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1owner',
      content_type: 'image/png',
      file_name: 'workspace-avatar.png',
    }));
    expect(prepareStorageObjectForCurrentWorkspace.mock.calls[0][0]).not.toHaveProperty('owner_group_id');
    expect(prepareStorageObjectForCurrentWorkspace.mock.calls[0][0]).not.toHaveProperty('access_group_ids');
    expect(api.uploadStorageObject).toHaveBeenCalledWith(
      expect.objectContaining({ object_id: 'storage-avatar-1' }),
      expect.any(Uint8Array),
      'image/png',
      { baseUrl: 'https://tower.example' },
    );
    expect(api.completeStorageObject).toHaveBeenCalledWith(
      'storage-avatar-1',
      { size_bytes: 3, sha256_hex: 'sha256-avatar' },
      { baseUrl: 'https://tower.example' },
    );
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
    expect(store.showWorkspaceBootstrapModal).toBe(false);
    expect(store.showConnectModal).toBe(true);
  });

  it('clears PG workspaces that Tower no longer verifies', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
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
    const kept = {
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
    const stale = {
      ...kept,
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1stale::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1staleowner',
      workspaceServiceNpub: 'npub1stale',
      workspaceId: 'workspace-stale',
      name: 'Removed workspace',
      pgDescriptor: {
        ...descriptor,
        identity: {
          ...descriptor.identity,
          workspace_service_npub: 'npub1stale',
          workspace_owner_npub: 'npub1staleowner',
          workspace_id: 'workspace-stale',
        },
      },
    };
    const store = await buildStore({
      knownWorkspaces: [kept, stale],
      selectedWorkspaceKey: kept.workspaceKey,
      appManagementCleanupBusy: false,
      appManagementCleanupMessage: '',
      appManagementCleanupError: '',
      verifyPgDescriptor: vi.fn(async (input) => {
        if (input.identity?.workspace_id === 'workspace-stale') {
          throw new Error('Tower PG API 404');
        }
        return {
          descriptor,
          me: { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
        };
      }),
      rememberVerifiedPgWorkspace: vi.fn().mockResolvedValue(kept),
      publishPgWorkspaceSelfIndexTombstone: vi.fn().mockResolvedValue(null),
    });

    const summary = await store.clearUnavailablePgWorkspaces();

    expect(summary).toMatchObject({ checked: 2, kept: 1, removed: 1 });
    expect(store.knownWorkspaces).toHaveLength(1);
    expect(store.knownWorkspaces[0].workspaceKey).toBe(kept.workspaceKey);
    expect(store.publishPgWorkspaceSelfIndexTombstone).toHaveBeenCalledWith(stale, {
      towerResult: 'workspace_unavailable',
      reason: 'app_management_cleanup',
    });
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
    expect(store.appManagementCleanupMessage).toContain('Removed 1 unavailable workspace');
  });
});
