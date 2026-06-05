import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/api.js', () => ({
  setBaseUrl: vi.fn(),
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

  it('does not call Tower PG routes when no Nostr session exists', async () => {
    const api = await import('../src/api.js');
    const { connectSettingsManagerMixin } = await import('../src/connect-settings-manager.js');
    const store = createStore({ session: null });
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(connectSettingsManagerMixin));

    await expect(store.connectWithPgDescriptor(JSON.stringify(descriptor))).rejects.toThrow('Sign in first');

    expect(api.getTowerPgWorkspaceDescriptor).not.toHaveBeenCalled();
    expect(api.getTowerPgWorkspaceMe).not.toHaveBeenCalled();
  });
});
