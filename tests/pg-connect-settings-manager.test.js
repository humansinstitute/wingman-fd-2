import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLIGHT_DECK_PG_APP_NPUB } from '../src/app-identity.js';

const DEFAULT_BUILD_PG_APP_NPUB = FLIGHT_DECK_PG_APP_NPUB;

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/api.js', () => ({
  setBaseUrl: vi.fn(),
  createTowerPgAdminWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  getWorkspaces: vi.fn(),
  getTowerPgService: vi.fn(),
  listTowerPgWorkspaces: vi.fn(),
  getTowerPgWorkspaceDescriptor: vi.fn(),
  getTowerPgWorkspaceMe: vi.fn(),
}));

const descriptor = {
  type: 'wingman_workspace_locator',
  version: 1,
  tower_base_url: 'https://tower.example',
  identity: {
    tower_service_npub: 'npub1tower',
    workspace_service_npub: 'npub1workspace',
    workspace_owner_npub: 'npub1owner',
    workspace_id: 'workspace-1',
    app_npub: 'flightdeck_pg',
  },
  label: 'Other Stuff',
  description: 'PG workspace',
  capabilities: ['pg_scopes', 'pg_tasks'],
  links: {
    descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
    me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
  },
};

function createStore(overrides = {}) {
  return {
    session: { npub: 'npub1user' },
    backendUrl: '',
    ownerNpub: '',
    superbasedTokenInput: '',
    knownHosts: [],
    knownWorkspaces: [],
    selectedWorkspaceKey: '',
    currentWorkspaceOwnerNpub: '',
    showConnectModal: true,
    connectWorkspacesError: null,
    connectWorkspacesBusy: false,
    persistWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    ensureBackgroundSync: vi.fn(),
    mergeKnownWorkspaces(entries) {
      this.knownWorkspaces = entries;
    },
    addKnownHost(host) {
      this.knownHosts.push(host);
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    selectWorkspace: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PG connect settings manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('verifies a pasted descriptor with signed descriptor and me calls before storing it', async () => {
    const api = await import('../src/api.js');
    api.getTowerPgWorkspaceDescriptor.mockResolvedValue(descriptor);
    api.getTowerPgWorkspaceMe.mockResolvedValue({ actor: { npub: 'npub1user' }, membership: { role: 'member' } });
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const store = createStore();
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await store.connectWithPgDescriptor(JSON.stringify(descriptor));

    expect(api.getTowerPgWorkspaceDescriptor).toHaveBeenCalledWith('workspace-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      path: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
    });
    expect(api.getTowerPgWorkspaceMe).toHaveBeenCalledWith('workspace-1', {
      baseUrl: 'https://tower.example',
      appNpub: 'flightdeck_pg',
      path: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
    });
    expect(store.knownWorkspaces[0]).toMatchObject({
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      directHttpsUrl: 'https://tower.example',
      pgSessionNpub: 'npub1user',
      pgBackendMode: true,
      pgDescriptor: descriptor,
      pgMe: { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
    });
    expect(store.selectedWorkspaceKey).toBe('pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg');
    expect(store.selectWorkspace).toHaveBeenCalledWith(
      'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      { pgVerified: true },
    );
  });

  it('publishes a 33356 self-index after a verified PG descriptor is remembered', async () => {
    const api = await import('../src/api.js');
    api.getTowerPgWorkspaceDescriptor.mockResolvedValue(descriptor);
    api.getTowerPgWorkspaceMe.mockResolvedValue({ actor: { npub: 'npub1user' }, membership: { role: 'member' } });
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const publishPgWorkspaceSelfIndex = vi.fn().mockResolvedValue(null);
    const store = createStore({ publishPgWorkspaceSelfIndex });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await store.connectWithPgDescriptor(JSON.stringify(descriptor));
    await Promise.resolve();

    expect(publishPgWorkspaceSelfIndex).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      pgBackendMode: true,
    }));
    expect(store.knownWorkspaces[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1owner',
      pgBackendMode: true,
    });
  });

  it('does not republish a fresh 33356 self-index when a verified PG descriptor is refreshed', async () => {
    const api = await import('../src/api.js');
    api.getTowerPgWorkspaceDescriptor.mockResolvedValue(descriptor);
    api.getTowerPgWorkspaceMe.mockResolvedValue({ actor: { npub: 'npub1user' }, membership: { role: 'member' } });
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const publishPgWorkspaceSelfIndex = vi.fn().mockResolvedValue(null);
    const shouldQueuePgWorkspaceSelfIndexPublish = vi.fn(() => false);
    const store = createStore({
      publishPgWorkspaceSelfIndex,
      shouldQueuePgWorkspaceSelfIndexPublish,
      knownWorkspaces: [{
        workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
        workspaceOwnerNpub: 'npub1owner',
        directHttpsUrl: 'https://tower.example',
        towerServiceNpub: 'npub1tower',
        workspaceServiceNpub: 'npub1workspace',
        workspaceId: 'workspace-1',
        appNpub: 'flightdeck_pg',
        pgSessionNpub: 'npub1user',
        pgBackendMode: true,
        pgSelfIndexStatus: 'indexed',
        pgSelfIndexLastBroadcastAt: '2026-06-08T00:00:00.000Z',
        pgSelfIndexEventId: 'event-indexed',
        pgSelfIndexSignedEvent: { id: 'event-indexed' },
      }],
    });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await store.connectWithPgDescriptor(JSON.stringify(descriptor));
    await Promise.resolve();

    expect(shouldQueuePgWorkspaceSelfIndexPublish).toHaveBeenCalledWith(expect.objectContaining({
      pgSelfIndexStatus: 'indexed',
      pgSelfIndexEventId: 'event-indexed',
    }));
    expect(publishPgWorkspaceSelfIndex).not.toHaveBeenCalled();
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'indexed',
      pgSelfIndexEventId: 'event-indexed',
      pgSelfIndexSignedEvent: { id: 'event-indexed' },
    });
  });

  it('opens a verified PG workspace without waiting for relay self-index publish', async () => {
    const api = await import('../src/api.js');
    api.getTowerPgWorkspaceDescriptor.mockResolvedValue(descriptor);
    api.getTowerPgWorkspaceMe.mockResolvedValue({ actor: { npub: 'npub1user' }, membership: { role: 'member' } });
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const { workspaceSelfIndexManagerMixin } = await import('../src/workspace-self-index-manager.js');
    let rejectPublish;
    const publishPgWorkspaceSelfIndex = vi.fn(() => new Promise((resolve, reject) => {
      rejectPublish = reject;
    }));
    const store = createStore({ publishPgWorkspaceSelfIndex });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workspaceSelfIndexManagerMixin));
    store.publishPgWorkspaceSelfIndex = publishPgWorkspaceSelfIndex;

    const workspace = await store.connectWithPgDescriptor(JSON.stringify(descriptor));

    expect(workspace).toMatchObject({
      workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      pgSelfIndexStatus: 'pending',
    });
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'pending',
      pgSelfIndexError: null,
    });
    expect(store.showConnectModal).toBe(false);
    expect(store.selectWorkspace).toHaveBeenCalledWith(
      'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      { pgVerified: true },
    );

    await Promise.resolve();

    expect(publishPgWorkspaceSelfIndex).toHaveBeenCalledWith(expect.objectContaining({
      workspaceKey: workspace.workspaceKey,
      pgSelfIndexStatus: 'pending',
    }));

    rejectPublish(new Error('relay unavailable'));
    await store.pgWorkspaceSelfIndexPublishPromise;
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'failed',
      pgSelfIndexError: 'relay unavailable',
    });
  });

  it('does not call Tower PG routes when no Nostr session exists', async () => {
    const api = await import('../src/api.js');
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const store = createStore({ session: null });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await expect(store.connectWithPgDescriptor(JSON.stringify(descriptor))).rejects.toThrow('Sign in first');

    expect(api.getTowerPgWorkspaceDescriptor).not.toHaveBeenCalled();
    expect(api.getTowerPgWorkspaceMe).not.toHaveBeenCalled();
  });

  it('creates PG workspaces through Tower admin setup and connects with the returned descriptor', async () => {
    const api = await import('../src/api.js');
    api.createTowerPgAdminWorkspace.mockResolvedValue({ descriptor });
    api.getTowerPgWorkspaceDescriptor.mockResolvedValue(descriptor);
    api.getTowerPgWorkspaceMe.mockResolvedValue({ actor: { npub: 'npub1user' }, membership: { role: 'owner' } });
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const store = createStore({
      connectHostUrl: 'https://tower.example',
      backendUrl: 'https://tower.example',
      connectNewWorkspaceName: 'Pete docs',
      connectNewWorkspaceDescription: 'PG workspace',
      connectCreatingWorkspace: false,
    });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await store.connectCreateWorkspace();

    expect(api.createTowerPgAdminWorkspace).toHaveBeenCalledWith({
      workspace_name: 'Pete docs',
      workspace_description: 'PG workspace',
      app_npub: DEFAULT_BUILD_PG_APP_NPUB,
    }, {
      baseUrl: 'https://tower.example',
      appNpub: DEFAULT_BUILD_PG_APP_NPUB,
    });
    expect(api.createWorkspace).not.toHaveBeenCalled();
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgBackendMode: true,
      workspaceOwnerNpub: 'npub1owner',
    });
    expect(store.selectWorkspace).toHaveBeenCalledWith(
      'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
      { pgVerified: true, openWorkspaceHome: true },
    );
    expect(store.showConnectModal).toBe(false);
  });
});
