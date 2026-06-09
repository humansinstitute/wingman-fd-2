import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: vi.fn(() => true),
}));

vi.mock('../src/api.js', async () => {
  const actual = await vi.importActual('../src/api.js');
  return {
    ...actual,
    addTowerPgWorkspaceGroupMember: vi.fn(),
    createTowerPgChannelGrant: vi.fn(),
    createTowerPgWorkspaceGroup: vi.fn(),
    createTowerPgWorkspaceMember: vi.fn(),
    getTowerPgChannelGrants: vi.fn(),
    getTowerPgWorkspaceMembers: vi.fn(),
  };
});

vi.mock('../src/pg-read-hydrator.js', async () => {
  const actual = await vi.importActual('../src/pg-read-hydrator.js');
  return {
    ...actual,
    hydrateTowerPgAudioNotes: vi.fn(),
    hydrateTowerPgChannels: vi.fn(),
    hydrateTowerPgDocumentsAndFiles: vi.fn(),
    hydrateTowerPgScopes: vi.fn(),
    hydrateTowerPgTasks: vi.fn(),
  };
});

import {
  addTowerPgWorkspaceGroupMember,
  createTowerPgChannelGrant,
  createTowerPgWorkspaceGroup,
  createTowerPgWorkspaceMember,
  getTowerPgChannelGrants,
  getTowerPgWorkspaceMembers,
} from '../src/api.js';
import {
  hydrateTowerPgAudioNotes,
  hydrateTowerPgChannels,
  hydrateTowerPgDocumentsAndFiles,
  hydrateTowerPgScopes,
  hydrateTowerPgTasks,
} from '../src/pg-read-hydrator.js';
import {
  mapGroupEntry,
  mapCreatedGroup,
  mapRotatedGroup,
  deduplicateMembers,
  computeGroupMemberDiff,
  parseGroupMemberQueryNpubs,
  filterChannelsForViewer,
  filterChannelsByScope,
  aggregatePgChannelGrants,
  canManagePgChannelGrantsFromRows,
  channelsManagerMixin,
  capacityForPgChannelPermissions,
  permissionsForPgChannelCapacity,
} from '../src/channels-manager.js';

const channelsManagerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'src', 'channels-manager.js'),
  'utf-8',
);

beforeEach(() => {
  vi.clearAllMocks();
  createTowerPgChannelGrant.mockResolvedValue({ grant: { id: 'created-grant' } });
  createTowerPgWorkspaceGroup.mockResolvedValue({ group: { id: 'group-new', group_id: 'group-new', name: 'New group' } });
  createTowerPgWorkspaceMember.mockResolvedValue({ actor: { actor_id: 'actor-new', npub: 'npub1recipient' } });
  addTowerPgWorkspaceGroupMember.mockResolvedValue({ membership: { id: 'membership-new' } });
  getTowerPgChannelGrants.mockResolvedValue({ grants: [] });
  getTowerPgWorkspaceMembers.mockResolvedValue({ members: [] });
  hydrateTowerPgAudioNotes.mockResolvedValue(undefined);
  hydrateTowerPgChannels.mockResolvedValue(undefined);
  hydrateTowerPgDocumentsAndFiles.mockResolvedValue(undefined);
  hydrateTowerPgScopes.mockResolvedValue(undefined);
  hydrateTowerPgTasks.mockResolvedValue(undefined);
});

function applyChannelMixin(store) {
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(channelsManagerMixin))) {
    if (Object.prototype.hasOwnProperty.call(store, key)) continue;
    Object.defineProperty(store, key, descriptor);
  }
  return store;
}

function createPgGrantStore(overrides = {}) {
  const currentWorkspace = overrides.currentWorkspace || {
    workspaceId: 'workspace-1',
    workspaceOwnerNpub: 'npub1workspace',
    directHttpsUrl: 'https://tower.example',
    appNpub: 'flightdeck-app',
    pgBackendMode: true,
    pgMe: {
      actor: { actor_id: 'actor-manager', npub: 'npub1manager' },
      permissions: ['workspace.read', 'channel.grants.read', 'channel.grants.manage'],
    },
  };
  return applyChannelMixin({
    currentWorkspace,
    workspaceOwnerNpub: currentWorkspace.workspaceOwnerNpub,
    backendUrl: currentWorkspace.directHttpsUrl,
    session: { npub: currentWorkspace.pgMe?.actor?.npub || 'npub1manager' },
    selectedChannelId: 'channel-1',
    channelGrants: [
      {
        principal_type: 'actor',
        principal_id: 'actor-manager',
        permissions: ['channel.read', 'channel.grants.read', 'channel.grants.manage'],
      },
    ],
    channelGrantsLoading: false,
    channelGrantsSaving: false,
    channelGrantsError: null,
    channelGrantsNotice: '',
    channelGrantPrincipalType: 'actor',
    channelGrantActorId: 'actor-target',
    channelGrantGroupId: '',
    channelGrantCapacity: 'viewer',
    groups: [],
    currentWorkspaceGroups: [],
    canAdminWorkspace: false,
    refreshGroups: vi.fn(),
    rememberPeople: vi.fn(),
    getSenderName: vi.fn(() => ''),
    pgWorkspaceMembers: [{ actor_id: 'actor-target', npub: 'npub1target' }],
    pgGroupMemberDrafts: {},
    publishPgOnboardingAnnouncementForGrant: vi.fn().mockResolvedValue({ status: 'published' }),
    ...overrides,
  });
}

describe('channels-manager pure utilities', () => {
  it('does not call retired trigger diagnostics during ordinary group refresh', () => {
    expect(channelsManagerSource).not.toContain('refreshAgentChat' + 'TriggerDiagnostics');
  });

  describe('filterChannelsByScope', () => {
    const scopesMap = new Map([
      ['scope-a', { record_id: 'scope-a', level: 'l1', title: 'Scope A' }],
      ['scope-a-child', { record_id: 'scope-a-child', level: 'l2', title: 'Child', l1_id: 'scope-a' }],
      ['scope-b', { record_id: 'scope-b', level: 'l1', title: 'Scope B' }],
    ]);
    const channels = [
      { record_id: 'ch-a', title: 'A', scope_id: 'scope-a', scope_l1_id: 'scope-a' },
      { record_id: 'ch-a-child', title: 'A Child', scope_id: 'scope-a-child', scope_l1_id: 'scope-a', scope_l2_id: 'scope-a-child' },
      { record_id: 'ch-b', title: 'B', scope_id: 'scope-b', scope_l1_id: 'scope-b' },
      { record_id: 'ch-unscoped', title: 'Unscoped' },
      { record_id: 'ch-deleted', title: 'Deleted', scope_id: 'scope-a', record_state: 'deleted' },
    ];

    it('returns live channels for all and recent boards', () => {
      expect(filterChannelsByScope(channels, '__all__', null, scopesMap).map((channel) => channel.record_id)).toEqual([
        'ch-a',
        'ch-a-child',
        'ch-b',
        'ch-unscoped',
      ]);
      expect(filterChannelsByScope(channels, '__recent__', null, scopesMap).map((channel) => channel.record_id)).toEqual([
        'ch-a',
        'ch-a-child',
        'ch-b',
        'ch-unscoped',
      ]);
    });

    it('includes descendant channels for the selected scope', () => {
      expect(filterChannelsByScope(channels, 'scope-a', scopesMap.get('scope-a'), scopesMap).map((channel) => channel.record_id)).toEqual([
        'ch-a',
        'ch-a-child',
      ]);
    });

    it('returns only unscoped channels for the unscoped board', () => {
      expect(filterChannelsByScope(channels, '__unscoped__', null, scopesMap).map((channel) => channel.record_id)).toEqual([
        'ch-unscoped',
      ]);
    });
  });

  it('reconciles the selected chat channel to the filtered scope channel set', () => {
    const scopesMap = new Map([
      ['scope-a', { record_id: 'scope-a', level: 'l1', title: 'Scope A' }],
      ['scope-b', { record_id: 'scope-b', level: 'l1', title: 'Scope B' }],
    ]);
    const store = applyChannelMixin({
      channels: [
        { record_id: 'ch-a', title: 'A', scope_id: 'scope-a', scope_l1_id: 'scope-a' },
        { record_id: 'ch-b', title: 'B', scope_id: 'scope-b', scope_l1_id: 'scope-b' },
      ],
      selectedBoardId: 'scope-a',
      selectedBoardScope: scopesMap.get('scope-a'),
      scopesMap,
      selectedChannelId: 'ch-b',
      selectChannel: vi.fn(function selectChannel(recordId) {
        this.selectedChannelId = recordId;
      }),
      closeThread: vi.fn(),
      syncRoute: vi.fn(),
    });

    expect(store.scopeFilteredChannels.map((channel) => channel.record_id)).toEqual(['ch-a']);

    store.ensureSelectedChatChannelInScope({ syncRoute: false });

    expect(store.selectChannel).toHaveBeenCalledWith('ch-a', { syncRoute: false });
    expect(store.selectedChannelId).toBe('ch-a');
  });

  it('opens channel settings for an explicit PG context channel id', () => {
    const store = createPgGrantStore({
      channels: [
        { record_id: 'channel-1', title: 'Old channel' },
        { record_id: 'channel-2', title: 'Target channel' },
      ],
      selectedChannelId: 'channel-1',
      closeScopePicker: vi.fn(),
      closeChannelScopePicker: vi.fn(),
      preparePgChannelAccessPanel: vi.fn(),
    });

    channelsManagerMixin.openChannelSettings.call(store, 'channel-2');

    expect(store.selectedChannelId).toBe('channel-2');
    expect(store.showChannelSettingsModal).toBe(true);
    expect(store.preparePgChannelAccessPanel).toHaveBeenCalledOnce();
  });

  // --- mapGroupEntry ---
  describe('mapGroupEntry', () => {
    it('maps a group with id field', () => {
      const result = mapGroupEntry({
        id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        members: ['npub1a', 'npub1b'],
      });
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('maps a group with group_id field', () => {
      const result = mapGroupEntry({
        group_id: 'g2',
        group_npub: 'npub1grp2',
        owner_npub: 'npub1owner',
        name: 'Dev',
        member_npubs: ['npub1c'],
      });
      expect(result.group_id).toBe('g2');
      expect(result.group_npub).toBe('npub1grp2');
      expect(result.member_npubs).toEqual(['npub1c']);
    });

    it('defaults current_epoch to 1', () => {
      const result = mapGroupEntry({ id: 'g3', owner_npub: 'npub1o', name: 'X' });
      expect(result.current_epoch).toBe(1);
    });

    it('defaults group_kind to shared', () => {
      const result = mapGroupEntry({ id: 'g4', owner_npub: 'npub1o', name: 'Y' });
      expect(result.group_kind).toBe('shared');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapGroupEntry({ id: 'g5', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g5');
      expect(mapGroupEntry({ group_id: 'g6', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g6');
    });

    it('handles empty members gracefully', () => {
      const result = mapGroupEntry({ id: 'g7', owner_npub: 'o', name: 'Z' });
      expect(result.member_npubs).toEqual([]);
    });

    it('converts member entries to strings', () => {
      const result = mapGroupEntry({ id: 'g8', owner_npub: 'o', name: 'Z', members: [123, 'npub1x'] });
      expect(result.member_npubs).toEqual(['123', 'npub1x']);
    });

    it('extracts member_npub when members are objects', () => {
      const result = mapGroupEntry({
        id: 'g9',
        owner_npub: 'o',
        name: 'Z',
        members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }],
      });
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b']);
    });
  });

  // --- mapCreatedGroup ---
  describe('mapCreatedGroup', () => {
    it('maps a create-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }],
      };
      const result = mapCreatedGroup(response, 'Fallback Name', 'npub1owner');
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        owner_npub: 'npub1owner',
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('falls back name to provided name', () => {
      const result = mapCreatedGroup({}, 'My Group', 'npub1owner');
      expect(result.name).toBe('My Group');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapCreatedGroup({ id: 'x' }, 'n', 'o').group_npub).toBe('x');
      expect(mapCreatedGroup({ group_id: 'y' }, 'n', 'o').group_npub).toBe('y');
    });

    it('defaults current_epoch to 1', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.current_epoch).toBe(1);
    });

    it('filters out falsy members', () => {
      const result = mapCreatedGroup({ members: [{ member_npub: 'npub1a' }, { member_npub: '' }] }, 'n', 'o');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('handles missing members array', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.member_npubs).toEqual([]);
    });

    it('normalizes mixed member entry shapes in create responses', () => {
      const result = mapCreatedGroup({
        members: [{ member_npub: 'npub1a' }, { npub: 'npub1b' }, 'npub1c'],
      }, 'n', 'o');
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b', 'npub1c']);
    });
  });

  // --- mapRotatedGroup ---
  describe('mapRotatedGroup', () => {
    const baseGroup = {
      group_id: 'g1',
      group_npub: 'npub1old',
      current_epoch: 2,
      owner_npub: 'npub1owner',
      name: 'Original',
      group_kind: 'shared',
      private_member_npub: null,
    };

    it('maps a rotate-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1rotated',
        current_epoch: 3,
        owner_npub: 'npub1owner',
        name: 'Renamed',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }],
      };
      const result = mapRotatedGroup(response, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1rotated');
      expect(result.current_epoch).toBe(3);
      expect(result.name).toBe('Renamed');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('falls back to identity npub', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1identity');
    });

    it('increments epoch when response lacks it', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1id' }, baseGroup, [], {});
      expect(result.current_epoch).toBe(3);
    });

    it('falls back name to options.name then group.name', () => {
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], { name: 'Opt' }).name).toBe('Opt');
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], {}).name).toBe('Original');
    });

    it('falls back member_npubs to nextMembers', () => {
      const result = mapRotatedGroup({}, { npub: 'n' }, baseGroup, ['npub1x', 'npub1y'], {});
      expect(result.member_npubs).toEqual(['npub1x', 'npub1y']);
    });

    it('maps member objects from response', () => {
      const result = mapRotatedGroup(
        { members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }] },
        { npub: 'n' }, baseGroup, [], {},
      );
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b']);
    });

    it('normalizes fallback members when rotate response omits members', () => {
      const result = mapRotatedGroup(
        {},
        { npub: 'n' },
        baseGroup,
        [{ member_npub: 'npub1a' }, { npub: 'npub1b' }, 'npub1c'],
        {},
      );
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b', 'npub1c']);
    });
  });

  // --- deduplicateMembers ---
  describe('deduplicateMembers', () => {
    it('includes the owner first', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1b']);
      expect(result[0]).toBe('npub1owner');
    });

    it('deduplicates members', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1a', 'npub1owner']);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('trims and filters blank entries', () => {
      const result = deduplicateMembers('npub1owner', ['  npub1a  ', '', null, undefined]);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('handles null memberNpubs', () => {
      const result = deduplicateMembers('npub1owner', null);
      expect(result).toEqual(['npub1owner']);
    });

    it('converts non-string members to strings', () => {
      const result = deduplicateMembers('npub1owner', [123]);
      expect(result).toEqual(['npub1owner', '123']);
    });

    it('normalizes object-shaped member entries', () => {
      const result = deduplicateMembers('npub1owner', [{ member_npub: 'npub1a' }, { npub: 'npub1b' }]);
      expect(result).toEqual(['npub1owner', 'npub1a', 'npub1b']);
    });
  });

  // --- computeGroupMemberDiff ---
  describe('computeGroupMemberDiff', () => {
    it('computes members to add and remove', () => {
      const result = computeGroupMemberDiff(
        ['npub1a', 'npub1b', 'npub1c'],
        ['npub1a', 'npub1d'],
      );
      expect(result.membersToAdd).toEqual(['npub1b', 'npub1c']);
      expect(result.membersToRemove).toEqual(['npub1d']);
    });

    it('returns empty arrays when lists are identical', () => {
      const result = computeGroupMemberDiff(['npub1a'], ['npub1a']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual([]);
    });

    it('handles empty desired list', () => {
      const result = computeGroupMemberDiff([], ['npub1a', 'npub1b']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual(['npub1a', 'npub1b']);
    });

    it('handles empty existing list', () => {
      const result = computeGroupMemberDiff(['npub1a', 'npub1b'], []);
      expect(result.membersToAdd).toEqual(['npub1a', 'npub1b']);
      expect(result.membersToRemove).toEqual([]);
    });
  });

  // --- parseGroupMemberQueryNpubs ---
  describe('parseGroupMemberQueryNpubs', () => {
    const fakeNpub = 'npub1' + 'a'.repeat(58);

    it('extracts valid npubs from comma-separated query', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},npub1${'b'.repeat(58)}`);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(fakeNpub);
    });

    it('returns empty array for empty string', () => {
      expect(parseGroupMemberQueryNpubs('')).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(parseGroupMemberQueryNpubs(null)).toEqual([]);
    });

    it('ignores entries that are too short', () => {
      const result = parseGroupMemberQueryNpubs('npub1short,not-npub');
      expect(result).toEqual([]);
    });

    it('ignores entries not starting with npub1', () => {
      const result = parseGroupMemberQueryNpubs('nsec1' + 'a'.repeat(58));
      expect(result).toEqual([]);
    });

    it('trims whitespace around entries', () => {
      const result = parseGroupMemberQueryNpubs(`  ${fakeNpub}  `);
      expect(result).toEqual([fakeNpub]);
    });

    it('deduplicates entries', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},${fakeNpub}`);
      expect(result).toEqual([fakeNpub]);
    });
  });

  // --- filterChannelsForViewer ---
  describe('filterChannelsForViewer', () => {
    const OWNER = 'npub1owner';
    const VIEWER = 'npub1viewer';
    const OTHER = 'npub1other';

    const channels = [
      { record_id: 'ch1', title: 'Team Channel', participant_npubs: [OWNER, VIEWER, OTHER] },
      { record_id: 'ch2', title: 'DM: Pete', participant_npubs: [OWNER, OTHER] },
      { record_id: 'ch3', title: 'WM21', participant_npubs: [OWNER, OTHER] },
      { record_id: 'ch4', title: 'Open', participant_npubs: [] },
      { record_id: 'ch5', title: 'Legacy', participant_npubs: undefined },
    ];

    it('workspace owner sees all channels', () => {
      const result = filterChannelsForViewer(channels, OWNER, OWNER);
      expect(result).toHaveLength(5);
    });

    it('guest viewer only sees channels where they are a participant', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).toEqual(['ch1', 'ch4', 'ch5']);
    });

    it('guest viewer sees existing group channels after being added to the delivery group', () => {
      const result = filterChannelsForViewer([
        ...channels,
        {
          record_id: 'ch6',
          title: 'General',
          group_ids: ['shared-group'],
          participant_npubs: [OWNER, OTHER],
        },
      ], VIEWER, OWNER, [
        {
          group_id: 'shared-group',
          group_npub: 'npub1sharedgroup',
          member_npubs: [OWNER, VIEWER, OTHER],
        },
      ]);
      expect(result.map(c => c.record_id)).toContain('ch6');
    });

    it('guest viewer sees channels that reference the current group npub', () => {
      const result = filterChannelsForViewer([
        {
          record_id: 'ch6',
          title: 'General',
          group_ids: ['npub1sharedgroup'],
          participant_npubs: [OWNER, OTHER],
        },
      ], VIEWER, OWNER, [
        {
          group_id: 'shared-group',
          group_npub: 'npub1sharedgroup',
          member_npubs: [OWNER, VIEWER, OTHER],
        },
      ]);
      expect(result.map(c => c.record_id)).toEqual(['ch6']);
    });

    it('filters out channels where viewer is not in participant_npubs', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).not.toContain('ch2');
      expect(result.map(c => c.record_id)).not.toContain('ch3');
    });

    it('channels without participant_npubs are always visible', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).toContain('ch4');
      expect(result.map(c => c.record_id)).toContain('ch5');
    });

    it('returns all channels when viewerNpub is null', () => {
      const result = filterChannelsForViewer(channels, null, OWNER);
      expect(result).toHaveLength(5);
    });

    it('returns all channels when viewerNpub is undefined', () => {
      const result = filterChannelsForViewer(channels, undefined, OWNER);
      expect(result).toHaveLength(5);
    });
  });

  describe('new channel group suggestions', () => {
    function createPickerStore(overrides = {}) {
      const store = {
        currentWorkspaceContentGroups: [],
        groups: [
          { group_id: 'g-alpha', name: 'Alpha Team', member_npubs: ['npub1a'] },
          { group_id: 'g-beta', name: 'Beta Team', member_npubs: ['npub1b', 'npub1c'] },
        ],
        newChannelGroupId: '',
        resolveGroupId: (value) => value || null,
        ...overrides,
      };
      Object.defineProperty(
        store,
        'newChannelGroupOptions',
        Object.getOwnPropertyDescriptor(channelsManagerMixin, 'newChannelGroupOptions'),
      );
      return store;
    }

    it('returns browsable groups for an empty group query', () => {
      const store = createPickerStore();

      const suggestions = channelsManagerMixin.findNewChannelGroupSuggestions.call(store, '');

      expect(suggestions.map((group) => group.groupId)).toEqual(['g-alpha', 'g-beta']);
    });

    it('filters browsable groups by name when queried', () => {
      const store = createPickerStore();

      const suggestions = channelsManagerMixin.findNewChannelGroupSuggestions.call(store, 'beta');

      expect(suggestions.map((group) => group.groupId)).toEqual(['g-beta']);
    });

    it('omits the selected group from browsable suggestions', () => {
      const store = createPickerStore({ newChannelGroupId: 'g-alpha' });

      const suggestions = channelsManagerMixin.findNewChannelGroupSuggestions.call(store, '');

      expect(suggestions.map((group) => group.groupId)).toEqual(['g-beta']);
    });
  });

  describe('channel tab ordering', () => {
    const orderedChannels = [
      { record_id: 'ch1', title: 'Team Channel', participant_npubs: [] },
      { record_id: 'ch2', title: 'DM: Pete', participant_npubs: [] },
      { record_id: 'ch3', title: 'WM21', participant_npubs: [] },
    ];

    function createStore(overrides = {}) {
      return {
        channels: [],
        channelOrder: [],
        channelDragSourceId: '',
        selectedChannelId: '',
        session: { npub: 'npub1owner' },
        workspaceOwnerNpub: 'npub1owner',
        MAIN_FEED_PAGE_SIZE: 20,
        mainFeedVisibleCount: 20,
        chatFeedNearTop: false,
        expandedChatMessageIds: [],
        truncatedChatMessageIds: [],
        pendingChatScrollToLatest: false,
        getChannelParticipants: (channel) => channel.participant_npubs || [],
        rememberPeople: vi.fn(),
        closeThread: vi.fn(),
        startSelectedChannelLiveQuery: vi.fn(),
        syncRoute: vi.fn(),
        applyMessages: vi.fn(),
        updatePageTitle: vi.fn(),
        saveWorkspaceChannelOrder: vi.fn(),
        ...overrides,
      };
    }

    it('applies saved channel order when channels load', async () => {
      const store = createStore({ channelOrder: ['ch3', 'ch1'] });

      await channelsManagerMixin.applyChannels.call(store, orderedChannels, { syncRoute: false });

      expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.selectedChannelId).toBe('ch3');
    });

    it('applies group membership visibility when channels load', async () => {
      const store = createStore({
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        groups: [{ group_id: 'shared-group', member_npubs: ['npub1viewer'] }],
      });

      await channelsManagerMixin.applyChannels.call(store, [
        {
          record_id: 'ch-general',
          title: 'General',
          group_ids: ['shared-group'],
          participant_npubs: ['npub1owner'],
        },
      ], { syncRoute: false });

      expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch-general']);
      expect(store.selectedChannelId).toBe('ch-general');
    });

    it('does not hide cached Tower PG channels while PG groups are still hydrating', async () => {
      const store = createStore({
        currentWorkspace: { pgBackendMode: true },
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1workspace',
        groups: [],
      });

      await channelsManagerMixin.applyChannels.call(store, [
        {
          record_id: 'pg-channel',
          title: 'PG Channel',
          group_ids: ['pg-group-not-yet-loaded'],
          participant_npubs: [],
        },
      ], { syncRoute: false });

      expect(store.channels.map((channel) => channel.record_id)).toEqual(['pg-channel']);
      expect(store.selectedChannelId).toBe('pg-channel');
    });

    it('preserves saved channel order through an empty channel batch', async () => {
      const store = createStore({ channelOrder: ['ch3', 'ch1'] });

      await channelsManagerMixin.applyChannels.call(store, [], { syncRoute: false });

      expect(store.channelOrder).toEqual(['ch3', 'ch1']);
      expect(store.channels).toEqual([]);
    });

    it('persists the new order after a tab drop', async () => {
      const store = createStore({
        channels: orderedChannels,
        channelOrder: ['ch1', 'ch2', 'ch3'],
        channelDragSourceId: 'ch3',
      });
      const event = { preventDefault: vi.fn() };

      await channelsManagerMixin.dropChannelTab.call(store, 'ch1', event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(store.channelDragSourceId).toBe('');
      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.saveWorkspaceChannelOrder).toHaveBeenCalledWith(['ch3', 'ch1', 'ch2']);
    });

    it('keeps the local order and surfaces sync errors when saving fails', async () => {
      const store = createStore({
        channels: orderedChannels,
        channelOrder: ['ch1', 'ch2', 'ch3'],
        channelDragSourceId: 'ch3',
        saveWorkspaceChannelOrder: vi.fn().mockRejectedValue(new Error('missing group keys')),
      });

      await channelsManagerMixin.dropChannelTab.call(store, 'ch1', { preventDefault: vi.fn() });

      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.error).toBe('missing group keys');
    });
  });

  describe('PG channel grant capacity presets', () => {
    it('maps viewer to read-only channel-anchored permissions', () => {
      expect(permissionsForPgChannelCapacity('viewer')).toEqual([
        'channel.read',
        'task.read',
        'doc.read',
        'file.read',
        'audio_note.read',
      ]);
    });

    it('maps manager to channel grant management without workspace management', () => {
      const permissions = permissionsForPgChannelCapacity('manager');
      expect(permissions).toEqual(expect.arrayContaining([
        'channel.read',
        'channel.write',
        'channel.manage',
        'channel.grants.read',
        'channel.grants.manage',
        'task.create',
        'task.update',
        'doc.write',
        'file.write',
        'audio_note.write',
      ]));
      expect(permissions).not.toContain('workspace.manage');
      expect(permissions).not.toContain('scope.manage');
    });

    it('maps agent to content creation without workspace or channel management', () => {
      const permissions = permissionsForPgChannelCapacity('agent');
      expect(permissions).toEqual(expect.arrayContaining([
        'channel.read',
        'channel.write',
        'task.read',
        'task.create',
        'doc.write',
        'file.write',
        'audio_note.write',
      ]));
      expect(permissions).not.toContain('task.update');
      expect(permissions).not.toContain('channel.manage');
      expect(permissions).not.toContain('channel.grants.manage');
      expect(permissions).not.toContain('workspace.manage');
    });

    it('round-trips exact preset permissions to capacity names', () => {
      expect(capacityForPgChannelPermissions(permissionsForPgChannelCapacity('viewer'))).toBe('viewer');
      expect(capacityForPgChannelPermissions(permissionsForPgChannelCapacity('contributor'))).toBe('contributor');
      expect(capacityForPgChannelPermissions(permissionsForPgChannelCapacity('manager'))).toBe('manager');
      expect(capacityForPgChannelPermissions(permissionsForPgChannelCapacity('agent'))).toBe('agent');
    });

    it('aggregates Tower grant rows by principal and detects the matching capacity', () => {
      const rows = aggregatePgChannelGrants([
        {
          id: 'grant-1',
          principal_type: 'actor',
          principal_id: 'actor-1',
          permissions: ['channel.read'],
          created_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: 'grant-2',
          principal_type: 'actor',
          principal_id: 'actor-1',
          permissions: ['task.read', 'doc.read', 'file.read', 'audio_note.read'],
          created_at: '2026-06-01T00:00:01.000Z',
        },
        {
          id: 'grant-3',
          principal_type: 'group',
          principal_id: 'group-1',
          permission: 'channel.read',
        },
      ]);

      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.key === 'actor:actor-1')).toEqual(expect.objectContaining({
        principal_type: 'actor',
        principal_id: 'actor-1',
        capacity: 'viewer',
        permissions: ['audio_note.read', 'channel.read', 'doc.read', 'file.read', 'task.read'],
      }));
      expect(rows.find((row) => row.key === 'group:group-1')).toEqual(expect.objectContaining({
        capacity: 'custom',
        permissions: ['channel.read'],
      }));
    });

    it('detects selected-channel grant management for direct actor and effective group grants', () => {
      expect(canManagePgChannelGrantsFromRows({
        grants: [{
          principal_type: 'actor',
          principal_id: 'actor-manager',
          permissions: ['channel.grants.manage'],
        }],
        actorId: 'actor-manager',
        viewerNpub: 'npub1manager',
        groups: [],
      })).toBe(true);

      expect(canManagePgChannelGrantsFromRows({
        grants: [{
          principal_type: 'group',
          principal_id: 'group-managers',
          permissions: ['channel.grants.manage'],
        }],
        actorId: 'actor-member',
        viewerNpub: 'npub1nested',
        groups: [{
          group_id: 'group-managers',
          member_npubs: [],
          effective_member_npubs: ['npub1nested'],
        }],
      })).toBe(true);
    });

    it('does not treat viewer, contributor, or agent capacity as grant management', () => {
      for (const capacity of ['viewer', 'contributor', 'agent']) {
        expect(canManagePgChannelGrantsFromRows({
          grants: [{
            principal_type: 'actor',
            principal_id: 'actor-user',
            permissions: permissionsForPgChannelCapacity(capacity),
          }],
          actorId: 'actor-user',
          viewerNpub: 'npub1user',
          groups: [],
        })).toBe(false);
      }
    });

    it('allows workspace admins to submit a typed actor grant payload', async () => {
      const publishPgOnboardingAnnouncementForGrant = vi.fn().mockResolvedValue({ status: 'published' });
      const store = createPgGrantStore({
        canAdminWorkspace: true,
        channelGrants: [],
        channelGrantCapacity: 'contributor',
        publishPgOnboardingAnnouncementForGrant,
      });

      await store.createChannelGrant();

      expect(createTowerPgChannelGrant).toHaveBeenCalledWith('workspace-1', 'channel-1', {
        principal_type: 'actor',
        principal_id: 'actor-target',
        permissions: permissionsForPgChannelCapacity('contributor'),
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(publishPgOnboardingAnnouncementForGrant).toHaveBeenCalledWith({
        recipientNpub: 'npub1target',
        grantId: 'workspace-1:channel-1:actor-target',
        reason: 'added_to_workspace_or_group',
      });
    });

    it('publishes onboarding after a Tower PG workspace member grant succeeds', async () => {
      const publishPgOnboardingAnnouncementForGrant = vi.fn().mockResolvedValue({ status: 'published' });
      const store = createPgGrantStore({
        canAdminWorkspace: true,
        pgWorkspaceMemberNpub: 'npub1recipient',
        groupEditPending: false,
        publishPgOnboardingAnnouncementForGrant,
      });

      await store.addPgWorkspaceMember();

      expect(createTowerPgWorkspaceMember).toHaveBeenCalledWith('workspace-1', {
        member_npub: 'npub1recipient',
        role: 'member',
        kind: 'human',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(publishPgOnboardingAnnouncementForGrant).toHaveBeenCalledWith({
        recipientNpub: 'npub1recipient',
        grantId: 'workspace-1:workspace:npub1recipient',
        reason: 'added_to_workspace_or_group',
      });
      expect(store.pgWorkspaceMemberNpub).toBe('');
      expect(store.refreshGroups).toHaveBeenCalledWith({ force: true, minIntervalMs: 0 });
    });

    it('offers workspace members that are not already in the PG group', () => {
      const store = createPgGrantStore({
        groups: [{
          group_id: 'group-1',
          owner_npub: 'npub1workspace',
          member_npubs: ['npub1existing'],
        }],
        currentWorkspaceGroups: [{
          group_id: 'group-1',
          owner_npub: 'npub1workspace',
          member_npubs: ['npub1existing'],
        }],
        pgWorkspaceMembers: [
          { actor_id: 'actor-existing', npub: 'npub1existing' },
          { actor_id: 'actor-new', npub: 'npub1newmember' },
        ],
        getSenderName: vi.fn((npub) => npub === 'npub1newmember' ? 'New Member' : npub),
      });

      expect(store.getPgGroupMemberCandidates('group-1')).toEqual([{
        npub: 'npub1newmember',
        label: 'New Member',
        role: 'member',
      }]);
    });

    it('adds an existing workspace member to a Tower PG group', async () => {
      const publishPgOnboardingAnnouncementForGrant = vi.fn().mockResolvedValue({ status: 'published' });
      const store = createPgGrantStore({
        canAdminWorkspace: true,
        pgGroupMemberDrafts: { 'group-1': 'npub1recipient' },
        groupEditPending: false,
        publishPgOnboardingAnnouncementForGrant,
      });

      await store.addPgGroupMember('group-1');

      expect(addTowerPgWorkspaceGroupMember).toHaveBeenCalledWith('workspace-1', 'group-1', {
        member_npub: 'npub1recipient',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(publishPgOnboardingAnnouncementForGrant).toHaveBeenCalledWith({
        recipientNpub: 'npub1recipient',
        grantId: 'workspace-1:group-1:npub1recipient',
        reason: 'added_to_workspace_or_group',
      });
      expect(store.pgGroupMemberDrafts['group-1']).toBe('');
      expect(store.refreshGroups).toHaveBeenCalledWith({ force: true, minIntervalMs: 0 });
    });

    it('keeps the current PG actor visible when workspace members have not loaded', async () => {
      getTowerPgWorkspaceMembers.mockRejectedValueOnce(new Error('forbidden'));
      const store = createPgGrantStore({
        currentWorkspace: {
          workspaceId: 'workspace-1',
          workspaceOwnerNpub: 'npub1workspace',
          directHttpsUrl: 'https://tower.example',
          appNpub: 'flightdeck-app',
          pgBackendMode: true,
          pgMe: {
            actor: { actor_id: 'actor-self', npub: 'npub1self', kind: 'human' },
            membership: { role: 'owner', joined_at: '2026-06-07T00:00:00.000Z' },
            permissions: ['workspace.read'],
          },
        },
        pgWorkspaceMembers: [],
      });

      const members = await store.refreshTowerPgWorkspaceMembers();

      expect(members).toEqual([expect.objectContaining({
        actor_id: 'actor-self',
        npub: 'npub1self',
        role: 'owner',
      })]);
      expect(store.pgWorkspaceMembers).toHaveLength(1);
    });

    it('shows a clear message when creating a duplicate Tower PG group', async () => {
      const duplicate = new Error('Tower PG API 409 POST https://tower.example/groups: {"code":"duplicate_group"}');
      duplicate.status = 409;
      duplicate.responseText = '{"code":"duplicate_group"}';
      createTowerPgWorkspaceGroup.mockRejectedValueOnce(duplicate);
      const store = createPgGrantStore({
        canAdminWorkspace: true,
        newGroupName: 'Managers',
        newGroupMemberQuery: '',
        newGroupMembers: [],
        groupCreatePending: false,
        showNewGroupModal: true,
        consumeGroupMemberQuery: vi.fn(() => ({ members: [] })),
        resetNewGroupDraft: vi.fn(),
      });

      await store.createSharingGroup();

      expect(createTowerPgWorkspaceGroup).toHaveBeenCalledWith('workspace-1', {
        name: 'Managers',
        kind: 'custom',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(store.error).toBe('A group with this name already exists.');
      expect(store.showNewGroupModal).toBe(true);
    });

    it('allows selected-channel managers to submit group grants', async () => {
      const store = createPgGrantStore({
        channelGrantPrincipalType: 'group',
        channelGrantActorId: '',
        channelGrantGroupId: 'group-target',
        channelGrantCapacity: 'manager',
        channelGrants: [{
          principal_type: 'actor',
          principal_id: 'actor-manager',
          permissions: ['channel.read', 'channel.grants.read', 'channel.grants.manage'],
        }],
      });

      await store.createChannelGrant();

      expect(createTowerPgChannelGrant).toHaveBeenCalledWith('workspace-1', 'channel-1', {
        principal_type: 'group',
        principal_id: 'group-target',
        permissions: permissionsForPgChannelCapacity('manager'),
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(store.channelGrantsNotice).toBe('Channel access updated.');
    });

    it('blocks viewers from submitting channel grants', async () => {
      const store = createPgGrantStore({
        currentWorkspace: {
          workspaceId: 'workspace-1',
          workspaceOwnerNpub: 'npub1workspace',
          directHttpsUrl: 'https://tower.example',
          appNpub: 'flightdeck-app',
          pgBackendMode: true,
          pgMe: {
            actor: { actor_id: 'actor-viewer', npub: 'npub1viewer' },
            permissions: ['workspace.read', 'channel.read'],
          },
        },
        session: { npub: 'npub1viewer' },
        channelGrants: [{
          principal_type: 'actor',
          principal_id: 'actor-viewer',
          permissions: permissionsForPgChannelCapacity('viewer'),
        }],
      });

      await store.createChannelGrant();

      expect(createTowerPgChannelGrant).not.toHaveBeenCalled();
      expect(store.channelGrantsError).toBe('You do not have permission to manage grants for this channel.');
    });

    it('refreshes grants and PG materialization after a successful grant', async () => {
      getTowerPgChannelGrants.mockResolvedValueOnce({
        grants: [{
          principal_type: 'actor',
          principal_id: 'actor-target',
          permissions: permissionsForPgChannelCapacity('viewer'),
        }],
      });
      const store = createPgGrantStore({ canAdminWorkspace: true, channelGrants: [] });

      await store.createChannelGrant();

      expect(getTowerPgChannelGrants).toHaveBeenCalledWith('workspace-1', 'channel-1', {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck-app',
      });
      expect(store.channelGrants).toEqual([{
        principal_type: 'actor',
        principal_id: 'actor-target',
        permissions: permissionsForPgChannelCapacity('viewer'),
      }]);
      expect(hydrateTowerPgScopes).toHaveBeenCalledWith(store);
      expect(hydrateTowerPgChannels).toHaveBeenCalledWith(store);
      expect(hydrateTowerPgTasks).toHaveBeenCalledWith(store);
      expect(hydrateTowerPgDocumentsAndFiles).toHaveBeenCalledWith(store);
      expect(hydrateTowerPgAudioNotes).toHaveBeenCalledWith(store);
    });
  });
});
