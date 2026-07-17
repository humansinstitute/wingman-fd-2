import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api.js', async () => {
  const actual = await vi.importActual('../src/api.js');
  return {
    ...actual,
    startTowerPgWorkroom: vi.fn(),
  };
});

import { startTowerPgWorkroom } from '../src/api.js';
import {
  buildWorkroomCreatePayload,
  channelParticipantFormRows,
  createWorkroomForm,
  failedWorkroomParticipants,
  inferWorkroomRepo,
  mergeWorkroomFormWithChannelDefaults,
  workroomCreationMixin,
  workroomRepoSuggestions,
  workroomDefaultsFromChannel,
  workroomVisibleParticipantNpubs,
} from '../src/workroom-creation-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('workroom creation flow helpers', () => {
  it('uses conventional branch defaults', () => {
    expect(createWorkroomForm()).toMatchObject({
      integration_branch: 'staging',
      production_branch: 'deployed',
    });
  });

  it('applies channel defaults while keeping room fields overridable', () => {
    const channel = {
      metadata: {
        workroom_defaults: {
          repo_url: 'https://github.com/acme/app',
          production_branch: 'release',
          participants: [{ actor_npub: 'npub-default', role: 'reviewer' }],
        },
      },
    };
    expect(workroomDefaultsFromChannel(channel).production_branch).toBe('release');
    expect(mergeWorkroomFormWithChannelDefaults(channel, { production_branch: 'main' })).toMatchObject({
      repo_url: 'https://github.com/acme/app',
      production_branch: 'main',
    });
  });

  it('builds the Tower create payload with all FD-02 fields', () => {
    const payload = buildWorkroomCreatePayload(createWorkroomForm({
      title: 'Release',
      goal: 'Ship it',
      integration_autopilot_npub: 'npub-auto',
      repo_url: 'https://github.com/acme/app',
      repo_name: 'acme/app',
      integration_branch: 'feature/release',
      production_branch: 'main',
      preview_app_target: 'preview-123',
      production_app_target: 'prod-123',
      approval_policy: 'human_required',
      participants: [
        { actor_npub: 'npub-human', role: 'human_approver', label: 'Pete' },
        { actor_npub: 'npub-integration', role: 'integration', label: 'Autopilot' },
      ],
    }), { scopeId: 'scope-1', channelId: 'channel-1' });
    expect(payload).toMatchObject({
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      repo: { url: 'https://github.com/acme/app', name: 'acme/app' },
      branches: { integration: 'feature/release', production: 'main' },
      app_targets: { preview: 'preview-123', production: 'prod-123' },
      approval_policy: { mode: 'human_required' },
      integration_autopilot_npub: 'npub-integration',
      participants: [
        { actor_npub: 'npub-human', role: 'human_approver', kind: 'human' },
        { actor_npub: 'npub-integration', role: 'integration', kind: 'human' },
      ],
    });
  });

  it('infers repository name and URL in either direction', () => {
    expect(inferWorkroomRepo('https://github.com/acme/app.git')).toEqual({
      url: 'https://github.com/acme/app',
      name: 'acme/app',
    });
    expect(inferWorkroomRepo('acme/app')).toEqual({
      url: 'https://github.com/acme/app',
      name: 'acme/app',
    });
  });

  it('prefills channel participants as contributors with resolved labels', () => {
    const rows = channelParticipantFormRows(
      { participant_npubs: ['npub-a', 'npub-b', 'npub-a'] },
      (channel) => channel.participant_npubs,
      (npub) => npub === 'npub-a' ? 'Alice' : 'Bob',
    );
    expect(rows).toEqual([
      { actor_npub: 'npub-a', role: 'contributor', label: 'Alice' },
      { actor_npub: 'npub-b', role: 'contributor', label: 'Bob' },
    ]);
    expect(channelParticipantFormRows({}, () => [])).toEqual([]);
  });

  it('prefills the channel roster and assigns one integration role', () => {
    const store = {
      selectedChannel: { record_id: 'channel-1', participant_npubs: ['npub-a', 'npub-b'] },
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: (channel) => channel.participant_npubs,
      getSenderName: (npub) => npub === 'npub-b' ? 'Bob' : 'Alice',
    };
    Object.assign(store, workroomCreationMixin);
    store.openWorkroomCreation();
    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-a', role: 'contributor', label: 'Alice' },
      { actor_npub: 'npub-b', role: 'contributor', label: 'Bob' },
    ]);
    store.setWorkroomParticipantRole(1, 'integration');
    expect(store.workroomCreationForm.integration_autopilot_npub).toBe('npub-b');
    store.setWorkroomParticipantRole(0, 'integration');
    expect(store.workroomCreationForm.participants[0].role).toBe('integration');
    expect(store.workroomCreationForm.participants[1].role).toBe('contributor');
    expect(store.workroomCreationForm.integration_autopilot_npub).toBe('npub-a');
  });

  it('expands actor grants for a non-DM PG channel', () => {
    expect(workroomVisibleParticipantNpubs({ record_id: 'channel-1' }, {
      channelGrants: [{ principal_type: 'actor', principal_id: 'actor-rick' }],
      workspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      sessionNpub: 'npub-pete',
    })).toEqual(['npub-rick', 'npub-pete']);
  });

  it('uses cached PG grants when opening the Workroom Creation modal', () => {
    const store = {
      selectedChannelId: 'channel-1',
      selectedChannel: { record_id: 'channel-1', channel_type: 'channel' },
      channelGrants: [{ principal_type: 'actor', principal_id: 'actor-rick' }],
      pgWorkspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      session: { npub: 'npub-pete' },
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: () => [],
      getSenderName: () => '',
    };
    Object.assign(store, workroomCreationMixin);
    store.openWorkroomCreation();
    expect(store.workroomCreationForm.participants.map((row) => row.actor_npub)).toEqual([
      'npub-rick',
      'npub-pete',
    ]);
  });

  it('uses channel-aware grant rows when opening the Workroom Creation modal', () => {
    const store = {
      selectedChannelId: 'channel-2',
      selectedChannel: { record_id: 'channel-2', channel_type: 'channel' },
      channelGrantsChannelId: 'channel-1',
      channelGrants: [{ principal_type: 'actor', principal_id: 'actor-stale' }],
      currentWorkspaceGroups: [{ group_id: 'group-agents', name: 'Agents', member_npubs: ['npub-rick'] }],
      pgWorkspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      session: { npub: 'npub-pete' },
      workroomCreationForm: createWorkroomForm(),
      getSelectedChannelGrantRows: vi.fn(() => [{ principal_type: 'group', principal_id: 'group-agents' }]),
      getChannelParticipants: () => [],
      getSenderName: (npub) => npub === 'npub-rick' ? 'Rick' : 'Pete',
    };
    Object.assign(store, workroomCreationMixin);

    store.openWorkroomCreation();

    expect(store.getSelectedChannelGrantRows).toHaveBeenCalledWith('channel-2');
    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-rick', role: 'contributor', label: 'Rick' },
      { actor_npub: 'npub-pete', role: 'contributor', label: 'Pete' },
    ]);
  });

  it('refreshes PG groups, members, and channel grants before finalizing the Workroom Creation roster', async () => {
    const store = {
      selectedChannelId: 'channel-1',
      selectedChannel: { record_id: 'channel-1', channel_type: 'channel' },
      channelGrants: [],
      currentWorkspaceGroups: [],
      pgWorkspaceMembers: [],
      session: { npub: 'npub-pete' },
      canAttemptSelectedPgChannelGrantRead: true,
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: () => [],
      getSenderName: (npub) => npub === 'npub-rick' ? 'Rick' : 'Pete',
      refreshGroups: vi.fn(async function refreshGroups() {
        this.currentWorkspaceGroups = [{ group_id: 'group-agents', name: 'Agents', member_npubs: ['npub-rick'] }];
        return this.currentWorkspaceGroups;
      }),
      refreshTowerPgWorkspaceMembers: vi.fn(async function refreshTowerPgWorkspaceMembers() {
        this.pgWorkspaceMembers = [{ actor_id: 'actor-rick', npub: 'npub-rick' }];
        return this.pgWorkspaceMembers;
      }),
      refreshChannelGrants: vi.fn(async function refreshChannelGrants() {
        this.channelGrants = [{ principal_type: 'group', principal_id: 'group-agents' }];
        return this.channelGrants;
      }),
    };
    Object.assign(store, workroomCreationMixin);

    await store.openWorkroomCreation();

    expect(store.refreshGroups).toHaveBeenCalledWith({ force: true, minIntervalMs: 0 });
    expect(store.refreshTowerPgWorkspaceMembers).toHaveBeenCalledWith({ force: true, limit: 200 });
    expect(store.refreshChannelGrants).toHaveBeenCalled();
    expect(store.workroomCreationPeopleLoading).toBe(false);
    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-pete', role: 'contributor', label: 'Pete' },
      { actor_npub: 'npub-rick', role: 'contributor', label: 'Rick' },
    ]);
  });

  it('includes members from enclosing scope groups when creating a channel workroom', async () => {
    const store = {
      selectedChannelId: 'channel-1',
      selectedChannel: { record_id: 'channel-1', scope_id: 'scope-feature', channel_type: 'channel' },
      scopesMap: new Map([['scope-feature', { record_id: 'scope-feature', group_ids: ['group-agents'] }]]),
      groups: [{ group_id: 'group-agents', name: 'Agents', member_npubs: ['npub-rick'] }],
      currentWorkspaceGroups: [],
      channelGrants: [],
      pgWorkspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      session: { npub: 'npub-pete' },
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: () => ['npub-pete'],
      getSenderName: (npub) => npub === 'npub-rick' ? 'Rick' : 'Pete',
      refreshGroups: vi.fn(async function refreshGroups() { return this.groups; }),
      refreshTowerPgWorkspaceMembers: vi.fn(async function refreshTowerPgWorkspaceMembers() { return this.pgWorkspaceMembers; }),
      refreshChannelGrants: vi.fn(async function refreshChannelGrants() { return this.channelGrants; }),
    };
    Object.assign(store, workroomCreationMixin);

    await store.openWorkroomCreation();

    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-pete', role: 'contributor', label: 'Pete' },
      { actor_npub: 'npub-rick', role: 'contributor', label: 'Rick' },
    ]);
  });

  it('uses the selected scope context when the channel row lacks a scope id', async () => {
    const store = {
      selectedChannelId: 'channel-1',
      selectedChannel: { record_id: 'channel-1', title: 'Features', channel_type: 'channel' },
      selectedBoardScope: { record_id: 'scope-feature', group_ids: ['group-agents'] },
      scopesMap: new Map([['scope-feature', { record_id: 'scope-feature', group_ids: ['group-agents'] }]]),
      groups: [{ group_id: 'group-agents', name: 'Agents', member_npubs: ['npub-rick'] }],
      currentWorkspaceGroups: [],
      channelGrants: [],
      pgWorkspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      session: { npub: 'npub-pete' },
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: () => ['npub-pete'],
      getSenderName: (npub) => npub === 'npub-rick' ? 'Rick' : 'Pete',
      refreshGroups: vi.fn(async function refreshGroups() { return this.groups; }),
      refreshTowerPgWorkspaceMembers: vi.fn(async function refreshTowerPgWorkspaceMembers() { return this.pgWorkspaceMembers; }),
      refreshChannelGrants: vi.fn(async function refreshChannelGrants() { return this.channelGrants; }),
    };
    Object.assign(store, workroomCreationMixin);

    await store.openWorkroomCreation();

    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-pete', role: 'contributor', label: 'Pete' },
      { actor_npub: 'npub-rick', role: 'contributor', label: 'Rick' },
    ]);
  });

  it('does not shrink the creation roster when async visibility refresh returns partial data', async () => {
    const store = {
      selectedChannelId: 'channel-1',
      selectedChannel: { record_id: 'channel-1', title: 'Features', channel_type: 'channel' },
      selectedBoardScope: { record_id: 'scope-feature', group_ids: ['group-agents'] },
      scopesMap: new Map([['scope-feature', { record_id: 'scope-feature', group_ids: ['group-agents'] }]]),
      groups: [{ group_id: 'group-agents', name: 'Agents', member_npubs: ['npub-rick'] }],
      currentWorkspaceGroups: [],
      channelGrants: [],
      pgWorkspaceMembers: [{ actor_id: 'actor-rick', npub: 'npub-rick' }],
      session: { npub: 'npub-pete' },
      workroomCreationForm: createWorkroomForm(),
      getChannelParticipants: () => ['npub-pete'],
      getSenderName: (npub) => npub === 'npub-rick' ? 'Rick' : 'Pete',
      refreshGroups: vi.fn(async function refreshGroups() {
        this.groups = [];
        return [];
      }),
      refreshTowerPgWorkspaceMembers: vi.fn(async function refreshTowerPgWorkspaceMembers() { return this.pgWorkspaceMembers; }),
      refreshChannelGrants: vi.fn(async function refreshChannelGrants() { return []; }),
    };
    Object.assign(store, workroomCreationMixin);

    await store.openWorkroomCreation();

    expect(store.workroomCreationForm.participants).toEqual([
      { actor_npub: 'npub-pete', role: 'contributor', label: 'Pete' },
      { actor_npub: 'npub-rick', role: 'contributor', label: 'Rick' },
    ]);
  });

  it('expands group grants through known group members', () => {
    expect(workroomVisibleParticipantNpubs({ record_id: 'channel-1' }, {
      channelGrants: [{ principal_type: 'group', principal_id: 'group-team' }],
      groups: [{ group_id: 'group-team', member_npubs: ['npub-rick', 'npub-pete'] }],
    })).toEqual(['npub-rick', 'npub-pete']);
  });

  it('expands embedded Tower group principals in channel grants', () => {
    expect(workroomVisibleParticipantNpubs({ record_id: 'channel-1' }, {
      channelGrants: [{
        principal_type: 'group',
        principal: {
          group_id: 'group-agents',
          members: [{ actor: { npub: 'npub-rick' } }],
        },
      }],
    })).toEqual(['npub-rick']);
  });

  it('includes the current viewer when local channel visibility is incomplete', () => {
    expect(workroomVisibleParticipantNpubs({ record_id: 'channel-1' }, {
      currentViewerNpub: 'npub-pete',
    })).toEqual(['npub-pete']);
  });

  it('preserves direct channel participants while deduplicating them', () => {
    expect(workroomVisibleParticipantNpubs({ participant_npubs: ['npub-pete', 'npub-rick', 'npub-pete'] }, {
      sessionNpub: 'npub-pete',
    })).toEqual(['npub-pete', 'npub-rick']);
  });

  it('prioritizes channel defaults and existing workroom repositories', () => {
    const suggestions = workroomRepoSuggestions({
      metadata: { workroom_defaults: { repo_url: 'https://github.com/acme/defaults' } },
    }, [{ repo: { name: 'acme/prior' } }]);
    expect(suggestions).toEqual([
      { url: 'https://github.com/acme/defaults', name: 'acme/defaults' },
      { url: 'https://github.com/acme/prior', name: 'acme/prior' },
    ]);
  });

  it('identifies participant access failures for the warning state', () => {
    expect(failedWorkroomParticipants([
      { actor_npub: 'npub-ok', access_status: 'granted' },
      { actor_npub: 'npub-failed', access_status: 'failed', access_issue: 'workspace_membership_missing' },
    ])).toEqual([{ actor_npub: 'npub-failed', access_status: 'failed', access_issue: 'workspace_membership_missing' }]);
  });

  it('shows start failures in the creation modal after creating the draft', async () => {
    startTowerPgWorkroom.mockRejectedValueOnce(new Error('integration autopilot is missing'));
    const store = {
      workrooms: [],
      messages: [],
      selectedChannel: { record_id: 'channel-1', scope_id: 'scope-1' },
      workroomCreationOpen: true,
      workroomCreationForm: createWorkroomForm({ title: 'Quick', goal: 'Updates' }),
      workroomError: '',
      workroomCreationError: '',
      workroomStartingId: '',
      currentWorkspace: { pgBackendMode: true, workspaceId: 'workspace-1', directHttpsUrl: 'https://tower.example', appNpub: 'flightdeck-app' },
      backendUrl: 'https://tower.example',
    };
    Object.assign(store, workroomCreationMixin);

    await store.startWorkroom({ record_id: 'room-1', row_version: 1 });

    expect(store.workroomCreationError).toBe('Workroom draft created but not started: integration autopilot is missing');
    expect(store.workroomError).toBe('integration autopilot is missing');
  });
});
