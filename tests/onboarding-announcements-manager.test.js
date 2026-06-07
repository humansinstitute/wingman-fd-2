import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  publishOnboardingAnnouncementMock,
  queryOnboardingAnnouncementCandidatesMock,
} = vi.hoisted(() => ({
  publishOnboardingAnnouncementMock: vi.fn(),
  queryOnboardingAnnouncementCandidatesMock: vi.fn(),
}));

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/nostr-onboarding-announcements.js', async () => {
  const actual = await vi.importActual('../src/nostr-onboarding-announcements.js');
  return {
    ...actual,
    flightDeckOnboardingAppPubkeyHex: vi.fn(() => 'b'.repeat(64)),
    onboardingAnnouncementRelayUrls: vi.fn((...lists) => lists.flat().filter(Boolean)),
    publishOnboardingAnnouncement: publishOnboardingAnnouncementMock,
    queryOnboardingAnnouncementCandidates: queryOnboardingAnnouncementCandidatesMock,
  };
});

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
    currentWorkspace: workspace,
    knownWorkspaces: [workspace],
    backendUrl: 'https://tower.example',
    superbasedTokenInput: 'connection-token',
    pgOnboardingAnnouncementStatuses: [],
    selectedWorkspaceKey: '',
    currentWorkspaceOwnerNpub: '',
    verifyPgDescriptor: vi.fn().mockResolvedValue({
      descriptor,
      me: { actor: { npub: 'npub1user' }, membership: { role: 'member' } },
    }),
    rememberVerifiedPgWorkspace: vi.fn(async () => workspace),
    ...overrides,
  };
}

describe('onboarding announcements manager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function bindStore(overrides = {}) {
    const { onboardingAnnouncementsManagerMixin } = await import('../src/onboarding-announcements-manager.js');
    const store = createStore(overrides);
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(onboardingAnnouncementsManagerMixin));
    return store;
  }

  it('records published announcement status after a Tower grant', async () => {
    publishOnboardingAnnouncementMock.mockResolvedValue({
      event: { id: 'event-1' },
      acceptedRelays: ['wss://relay.test'],
    });
    const store = await bindStore();

    const status = await store.publishPgOnboardingAnnouncementForGrant({
      recipientNpub: 'npub1recipient',
      grantId: 'grant-1',
    });

    expect(publishOnboardingAnnouncementMock).toHaveBeenCalledWith(expect.objectContaining({
      recipientNpub: 'npub1recipient',
      issuerNpub: 'npub1user',
      issuerPubkeyHex: 'a'.repeat(64),
      workspace,
      grantId: 'grant-1',
      reason: 'added_to_workspace_or_group',
    }));
    expect(status).toMatchObject({
      status: 'published',
      eventId: 'event-1',
      relays: ['wss://relay.test'],
    });
  });

  it('keeps the grant recoverable when relay publishing fails', async () => {
    publishOnboardingAnnouncementMock.mockRejectedValue(new Error('relay unavailable'));
    const store = await bindStore();

    const status = await store.publishPgOnboardingAnnouncementForGrant({
      recipientNpub: 'npub1recipient',
      grantId: 'grant-1',
    });

    expect(status).toMatchObject({
      status: 'failed',
      error: 'relay unavailable',
    });
    expect(store.pgOnboardingAnnouncementStatuses[0].retryInput).toMatchObject({
      recipientNpub: 'npub1recipient',
      grantId: 'grant-1',
    });

    publishOnboardingAnnouncementMock.mockResolvedValue({
      event: { id: 'event-retry' },
      acceptedRelays: ['wss://relay.test'],
    });
    const retry = await store.retryPgOnboardingAnnouncement(status.key);
    expect(retry).toMatchObject({
      status: 'published',
      eventId: 'event-retry',
    });
  });

  it('verifies discovered onboarding events through Tower before importing', async () => {
    const store = await bindStore({ knownWorkspaces: [] });
    const candidate = {
      event: { id: 'event-1' },
      locator: {
        ...descriptor,
        tower_base_url: 'https://tower.example',
      },
    };

    const summary = await store.discoverPgOnboardingAnnouncements({ candidates: [candidate] });

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
    expect(store.selectedWorkspaceKey).toBe(workspace.workspaceKey);
    expect(store.currentWorkspaceOwnerNpub).toBe(workspace.workspaceOwnerNpub);
  });

  it('keeps stale onboarding events diagnostic-only when Tower rejects access', async () => {
    const store = await bindStore({
      knownWorkspaces: [],
      rememberVerifiedPgWorkspace: vi.fn(),
      verifyPgDescriptor: vi.fn().mockRejectedValue(new Error('Tower PG API 403')),
    });
    const summary = await store.discoverPgOnboardingAnnouncements({
      candidates: [{
        event: { id: 'event-stale' },
        locator: {
          ...descriptor,
          tower_base_url: 'https://tower.example',
        },
      }],
    });

    expect(summary.stale).toBe(1);
    expect(store.rememberVerifiedPgWorkspace).not.toHaveBeenCalled();
    expect(store.pgOnboardingAnnouncementSummary.rejected[0]).toMatchObject({
      eventId: 'event-stale',
      error: 'Tower PG API 403',
    });
  });

  it('surfaces relay events that were fetched but rejected before import', async () => {
    queryOnboardingAnnouncementCandidatesMock.mockResolvedValue({
      events: [{ id: 'event-encrypted' }],
      candidates: [],
      rejected: [{
        eventId: 'event-encrypted',
        error: 'NIP-44 decrypt failed',
      }],
    });
    const store = await bindStore({ knownWorkspaces: [] });

    const summary = await store.discoverPgOnboardingAnnouncements();

    expect(summary.eventsSeen).toBe(1);
    expect(summary.discovered).toBe(0);
    expect(summary.rejected[0]).toMatchObject({
      eventId: 'event-encrypted',
      error: 'NIP-44 decrypt failed',
    });
    expect(store.pgOnboardingAnnouncementError).toContain('Found 1 onboarding event');
    expect(store.rememberVerifiedPgWorkspace).not.toHaveBeenCalled();
  });
});
