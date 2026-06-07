import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  publishWorkspaceSelfIndexMock,
  queryWorkspaceSelfIndexCandidatesMock,
} = vi.hoisted(() => ({
  publishWorkspaceSelfIndexMock: vi.fn(),
  queryWorkspaceSelfIndexCandidatesMock: vi.fn(),
}));

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/nostr-workspace-self-index.js', () => ({
  flightDeckSelfIndexAppPubkeyHex: vi.fn(() => 'b'.repeat(64)),
  publishWorkspaceSelfIndex: publishWorkspaceSelfIndexMock,
  queryWorkspaceSelfIndexCandidates: queryWorkspaceSelfIndexCandidatesMock,
  workspaceSelfIndexRelayUrls: vi.fn((...lists) => lists.flat().filter(Boolean)),
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
  label: 'Wingers',
  links: {
    descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
    me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
  },
};

const workspace = {
  workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
  workspaceOwnerNpub: 'npub1owner',
  name: 'Wingers',
  directHttpsUrl: 'https://tower.example',
  towerServiceNpub: 'npub1tower',
  serviceNpub: 'npub1tower',
  workspaceServiceNpub: 'npub1workspace',
  workspaceId: 'workspace-1',
  appNpub: 'flightdeck_pg',
  pgSessionNpub: 'npub1user',
  pgBackendMode: true,
  pgDescriptor: descriptor,
};

function createStore(overrides = {}) {
  return {
    session: { npub: 'npub1user', pubkey: 'a'.repeat(64) },
    currentWorkspace: null,
    knownWorkspaces: [workspace],
    persistWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    verifyPgDescriptor: vi.fn().mockResolvedValue({
      descriptor,
      me: { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
    }),
    rememberVerifiedPgWorkspace: vi.fn(async () => workspace),
    ...overrides,
  };
}

describe('workspace self-index manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function bindStore(overrides = {}) {
    const { workspaceSelfIndexManagerMixin } = await import('../src/workspace-self-index-manager.js');
    const store = createStore(overrides);
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workspaceSelfIndexManagerMixin));
    return store;
  }

  it('marks a verified PG workspace indexed after successful publish', async () => {
    publishWorkspaceSelfIndexMock.mockResolvedValue({
      event: { id: 'event-1' },
      acceptedRelays: ['wss://relay.test'],
      publishedAt: '2026-06-07T00:00:00.000Z',
    });
    const store = await bindStore();

    await store.publishPgWorkspaceSelfIndex(workspace);

    expect(publishWorkspaceSelfIndexMock).toHaveBeenCalled();
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'indexed',
      pgSelfIndexEventId: 'event-1',
      pgSelfIndexRelays: ['wss://relay.test'],
    });
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
  });

  it('keeps the workspace local and records failure when relay publish fails', async () => {
    publishWorkspaceSelfIndexMock.mockRejectedValue(new Error('relay rejected'));
    const store = await bindStore();

    const result = await store.publishPgWorkspaceSelfIndex(workspace);

    expect(result).toBeNull();
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'failed',
      pgSelfIndexError: 'relay rejected',
      workspaceKey: workspace.workspaceKey,
    });
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
  });

  it('verifies discovered locators through Tower and merges them into knownWorkspaces', async () => {
    const store = await bindStore({ knownWorkspaces: [] });
    const candidate = {
      event: { id: 'event-1' },
      locator: {
        ...descriptor,
        tower_base_url: 'https://tower.example',
      },
    };

    const summary = await store.discoverPgWorkspaceSelfIndex({ candidates: [candidate] });

    expect(store.verifyPgDescriptor).toHaveBeenCalledWith(candidate.locator, {
      baseUrl: 'https://tower.example',
    });
    expect(store.rememberVerifiedPgWorkspace).toHaveBeenCalledWith(descriptor, {
      actor: { npub: 'npub1user' },
      membership: { role: 'member' },
    }, {
      select: false,
      publishSelfIndex: false,
    });
    expect(summary.verified).toBe(1);
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'verified',
      pgSelfIndexEventId: 'event-1',
    });
  });

  it('marks existing locators stale when Tower rejects current access', async () => {
    const store = await bindStore({
      verifyPgDescriptor: vi.fn().mockRejectedValue(new Error('Tower PG API 403')),
    });
    const candidate = {
      event: { id: 'event-2' },
      locator: {
        tower_base_url: 'https://tower.example',
        workspace_id: 'workspace-1',
        workspace_service_npub: 'npub1workspace',
      },
    };

    const summary = await store.discoverPgWorkspaceSelfIndex({ candidates: [candidate] });

    expect(summary.stale).toBe(1);
    expect(store.rememberVerifiedPgWorkspace).not.toHaveBeenCalled();
    expect(store.knownWorkspaces[0]).toMatchObject({
      pgSelfIndexStatus: 'stale',
      pgSelfIndexError: 'Tower PG API 403',
    });
  });
});
