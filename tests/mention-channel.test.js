import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  alpineStartMock,
  alpineStoreMock,
} = vi.hoisted(() => ({
  alpineStartMock: vi.fn(),
  alpineStoreMock: vi.fn(),
}));

vi.mock('alpinejs', () => ({
  default: {
    store: alpineStoreMock,
    start: alpineStartMock,
  },
}));

beforeEach(() => {
  alpineStartMock.mockClear();
  alpineStoreMock.mockClear();
});

async function createStore() {
  vi.resetModules();
  const { initApp } = await import('../src/app.js');
  initApp();
  const store = alpineStoreMock.mock.calls.find(([name]) => name === 'chat')?.[1];
  expect(store).toBeTruthy();
  return store;
}

describe('channel mention lookup', () => {
  it('returns all active channels for the channel prefix', async () => {
    const store = await createStore();
    store.channels = Array.from({ length: 12 }, (_, index) => ({
      record_id: `channel-${index + 1}`,
      title: `Channel ${index + 1}`,
      record_state: 'active',
    })).concat({
      record_id: 'channel-deleted',
      title: 'Deleted channel',
      record_state: 'deleted',
    });
    store.getChannelLabel = (channel) => channel.title;

    const results = store.searchMentions('channel:');

    expect(results).toHaveLength(12);
    expect(results.every((result) => result.type === 'channel')).toBe(true);
    expect(results.map((result) => result.label)).toContain('Channel 12');
    expect(results.map((result) => result.label)).not.toContain('Deleted channel');
  });

  it('matches channel names in the general mention lookup', async () => {
    const store = await createStore();
    store.channels = [
      { record_id: 'channel-ops', title: 'Operations', record_state: 'active' },
      { record_id: 'channel-sales', title: 'Sales', record_state: 'active' },
    ];
    store.getChannelLabel = (channel) => channel.title;

    expect(store.searchMentions('oper')).toEqual([{
      type: 'channel',
      id: 'channel-ops',
      label: 'Operations',
      sublabel: 'Channel',
    }]);
  });

  it('finds people from workspace members and workroom participants', async () => {
    const store = await createStore();
    store.groups = [];
    store.pgWorkspaceMembers = [{ actor_id: 'actor-rick', npub: 'npub-rick', display_name: 'Rick', kind: 'agent' }];
    store.workroomParticipants = [{ actor_npub: 'npub-agent', label: 'Integrator Agent', role: 'integration' }];
    store.addressBookPeople = [];
    store.getSenderName = (npub) => ({ 'npub-rick': 'Rick', 'npub-agent': 'Integrator Agent' }[npub] || npub);

    expect(store.searchMentions('rick')).toEqual([{
      type: 'agent',
      id: 'npub-rick',
      label: 'Rick',
      sublabel: 'User',
    }]);
    expect(store.searchMentions('integrator')).toEqual([{
      type: 'person',
      id: 'npub-agent',
      label: 'Integrator Agent',
      sublabel: 'Workroom integration',
    }]);
  });

  it('preserves a selected Tower-human actor as a canonical person mention', async () => {
    const store = await createStore();
    const rickNpub = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    store.channels = [{ record_id: 'channel-rick', title: 'Rick', record_state: 'active' }];
    store.pgWorkspaceMembers = [{ npub: rickNpub, display_name: 'Rick', kind: 'human' }];
    store.workroomParticipants = [];
    store.addressBookPeople = [];
    store.groups = [];
    store.getSenderName = () => 'Rick';
    store.getChannelLabel = (channel) => channel.title;

    const results = store.searchMentions('Rick');
    expect(results[0]).toEqual({
      type: 'person', id: rickNpub, label: 'Rick', sublabel: 'User',
    });

    const target = {
      value: '@Rick', selectionStart: 5, dataset: { chatComposer: 'message' },
      dispatchEvent: vi.fn(), setSelectionRange: vi.fn(), focus: vi.fn(),
    };
    store._mentionTargetEl = target;
    store._mentionStartPos = 0;
    store.selectedAgentMentionsByComposer = {};
    store.selectMention(results[0]);

    expect(target.value).toBe(`@[Rick](mention:person:${rickNpub}) `);
    expect(store.selectedAgentMentionsByComposer.message).toEqual([
      { type: 'person', npub: rickNpub, label: 'Rick' },
    ]);
    const { canonicalAgentMentionsFromSelection } = await import('../src/agent-direct-chat.js');
    expect(canonicalAgentMentionsFromSelection(
      target.value,
      store.selectedAgentMentionsByComposer.message,
    )).toEqual([{ type: 'person', npub: rickNpub, label: 'Rick' }]);
  });

  it('updates lookahead immediately when the People directory member is renamed', async () => {
    const store = await createStore();
    const rickNpub = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    store.channels = [{ record_id: 'channel-rick', title: 'Rick', record_state: 'active' }];
    store.pgWorkspaceMembers = [{ actor_id: 'actor-rick', npub: rickNpub, display_name: '', kind: 'human' }];
    store.workroomParticipants = [];
    store.addressBookPeople = [];
    store.groups = [];
    store.getSenderName = () => 'Legacy Alias';
    store.getChannelLabel = (channel) => channel.title;

    expect(store.searchMentions('Rick')[0].type).toBe('channel');

    store.pgWorkspaceMembers = [{ actor_id: 'actor-rick', npub: rickNpub, display_name: 'Rick', kind: 'human' }];

    expect(store.searchMentions('Rick')[0]).toEqual({
      type: 'person', id: rickNpub, label: 'Rick', sublabel: 'User',
    });
  });

  it('keeps a configured integration agent visible before grants and groups hydrate', async () => {
    const store = await createStore();
    const rickNpub = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    store.selectedChannelId = 'channel-features';
    store.channels = [
      {
        record_id: 'channel-features',
        title: 'Features',
        record_state: 'active',
        metadata: {
          workroom_defaults: {
            integration_autopilot_npub: rickNpub,
            participants: [{ actor_npub: rickNpub, role: 'integration', label: 'Rick' }],
          },
        },
      },
      { record_id: 'channel-rick-dm', title: 'Rick', record_state: 'active' },
    ];
    store.groups = [];
    store.pgWorkspaceMembers = [{ npub: rickNpub, display_name: 'Rick', kind: 'human' }];
    store.workroomParticipants = [];
    store.addressBookPeople = [];
    store.channelGrantsChannelId = 'channel-features';
    store.channelGrants = [];
    store.getSenderName = (npub) => npub;
    store.getChannelLabel = (channel) => channel.title;
    store.getChannelParticipants = () => [];

    expect(store.searchMentions('Ric', { visibleOnly: true })).toEqual([
      { type: 'person', id: rickNpub, label: 'Rick', sublabel: 'User' },
      { type: 'channel', id: 'channel-rick-dm', label: 'Rick', sublabel: 'Channel' },
    ]);

    const target = {
      value: '@rick',
      selectionStart: 5,
      dataset: { chatComposer: 'message' },
      dispatchEvent: vi.fn(),
      setSelectionRange: vi.fn(),
      focus: vi.fn(),
    };
    store._mentionTargetEl = target;
    store._mentionStartPos = 0;
    store.selectedAgentMentionsByComposer = {};
    store.selectMention(store.searchMentions('Ric', { visibleOnly: true })[0]);

    expect(target.value).toBe(`@[Rick](mention:person:${rickNpub}) `);
    expect(store.selectedAgentMentionsByComposer.message).toEqual([
      { type: 'person', npub: rickNpub, label: 'Rick' },
    ]);
    const { canonicalAgentMentionsFromSelection } = await import('../src/agent-direct-chat.js');
    expect(canonicalAgentMentionsFromSelection(
      target.value,
      store.selectedAgentMentionsByComposer.message,
    )).toEqual([{ type: 'person', npub: rickNpub, label: 'Rick' }]);
  });

  it('keeps a durable workspace agent visible in a default-enabled ordinary channel', async () => {
    const store = await createStore();
    const ownerNpub = 'npub1owner';
    const rickNpub = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    store.currentWorkspaceOwnerNpub = ownerNpub;
    store.selectedChannelId = 'channel-autopilot';
    store.channels = [
      {
        record_id: 'channel-autopilot', title: 'Autopilot', record_state: 'active',
        metadata: {},
      },
      {
        record_id: 'channel-rick-dm', title: `DM: ${rickNpub}`, kind: 'dm', record_state: 'active',
        participant_npubs: ['npub1pete', rickNpub],
      },
    ];
    store.groups = [{
      group_id: 'group-agents', owner_npub: ownerNpub, name: 'Agents', member_npubs: [rickNpub],
    }];
    store.pgWorkspaceMembers = [{ npub: rickNpub, display_name: '', kind: 'human' }];
    store.workroomParticipants = [];
    store.addressBookPeople = [];
    store.channelGrants = [];
    store.channelGrantsChannelId = 'channel-autopilot';
    store.getSenderName = (npub) => npub;
    store.getChannelParticipants = (candidate) => candidate.participant_npubs || [];
    store.getChannelLabel = (candidate) => candidate.title;

    // Tower currently has no display name for this actor, so the npub is the
    // only honest searchable identity until Tower normalizes its actor profile.
    const results = store.searchMentions(rickNpub, { visibleOnly: true });
    expect(results[0]).toEqual({
      type: 'person', id: rickNpub, label: rickNpub, sublabel: 'User',
    });

    const target = {
      value: `@${rickNpub}`, selectionStart: rickNpub.length + 1, dataset: { chatComposer: 'message' },
      dispatchEvent: vi.fn(), setSelectionRange: vi.fn(), focus: vi.fn(),
    };
    store._mentionTargetEl = target;
    store._mentionStartPos = 0;
    store.selectedAgentMentionsByComposer = {};
    store.selectMention(results[0]);
    expect(target.value).toBe(`@[${rickNpub}](mention:person:${rickNpub}) `);
    expect(store.selectedAgentMentionsByComposer.message).toEqual([
      { type: 'person', npub: rickNpub, label: rickNpub },
    ]);
  });

  it('does not bypass visibility for workspace agents on an explicitly disabled channel', async () => {
    const store = await createStore();
    const rickNpub = 'npub1s4658awhcachmhzk5jhsg256gzdl7e4gh5a9zq8skjyt7g3k2axql224qz';
    store.currentWorkspaceOwnerNpub = 'npub1owner';
    store.selectedChannelId = 'channel-disabled';
    store.channels = [{
      record_id: 'channel-disabled', title: 'Disabled', record_state: 'active',
      metadata: { agent_chat: { enabled: false } },
    }];
    store.groups = [{
      group_id: 'group-agents', owner_npub: 'npub1owner', name: 'Agents', member_npubs: [rickNpub],
    }];
    store.pgWorkspaceMembers = [{ npub: rickNpub, display_name: 'Rick', kind: 'human' }];
    store.workroomParticipants = [];
    store.addressBookPeople = [];
    store.channelGrants = [];
    store.channelGrantsChannelId = 'channel-disabled';
    store.getSenderName = () => 'Rick';
    store.getChannelParticipants = () => [];

    expect(store.searchMentions('Rick', { visibleOnly: true })).toEqual([]);
  });

  it('scopes workroom mentions to channel-visible members through assigned groups', async () => {
    const store = await createStore();
    store.selectedChannelId = 'channel-ops';
    store.channels = [{ record_id: 'channel-ops', group_ids: ['group-agents'], record_state: 'active' }];
    store.currentWorkspaceOwnerNpub = 'npub-owner';
    store.groups = [
      { group_id: 'group-agents', owner_npub: 'npub-owner', name: 'Agents', member_npubs: ['npub-rick'] },
      { group_id: 'group-other', owner_npub: 'npub-owner', name: 'Other', member_npubs: ['npub-sam'] },
    ];
    store.pgWorkspaceMembers = [
      { npub: 'npub-rick', display_name: 'Rick' },
      { npub: 'npub-sam', display_name: 'Sam' },
    ];
    store.addressBookPeople = [];
    store.getSenderName = (npub) => ({ 'npub-rick': 'Rick', 'npub-sam': 'Sam' }[npub] || npub);
    store.getChannelParticipants = () => [];

    expect(store.searchMentions('r', { visibleOnly: true })).toEqual([{
      type: 'person', id: 'npub-rick', label: 'Rick', sublabel: 'User',
    }]);
    expect(store.searchMentions('sam', { visibleOnly: true })).toEqual([]);
  });

  it('finds locally indexed docs that are not in the visible docs list yet', async () => {
    const store = await createStore();
    store.documents = [];
    store.mentionDocumentIndex = [
      {
        record_id: 'doc-new',
        title: 'New Local Spec',
        record_state: 'active',
        updated_at: '2026-06-23T01:00:00.000Z',
      },
      {
        record_id: 'doc-deleted',
        title: 'Deleted Spec',
        record_state: 'deleted',
        updated_at: '2026-06-23T02:00:00.000Z',
      },
    ];

    expect(store.searchMentions('doc:new local')).toEqual([{
      type: 'doc',
      id: 'doc-new',
      label: 'New Local Spec',
      sublabel: 'Doc',
    }]);
  });

  it('keeps a newly patched doc available for mentions after visible docs are refreshed', async () => {
    const store = await createStore();
    store.documents = [];
    store.mentionDocumentIndex = [];
    store.refreshOpenDocFromLatestDocument = vi.fn();

    store.patchDocumentLocal({
      record_id: 'doc-new',
      title: 'New Local Spec',
      record_state: 'active',
      updated_at: '2026-06-23T01:00:00.000Z',
    });
    store.applyDocuments([]);

    expect(store.searchMentions('doc:new local')).toEqual([{
      type: 'doc',
      id: 'doc-new',
      label: 'New Local Spec',
      sublabel: 'Doc',
    }]);
  });

  it('navigates channel mentions to the selected chat channel', async () => {
    const store = await createStore();
    store.navSection = 'tasks';
    store.mobileNavOpen = true;
    store.startWorkspaceLiveQueries = vi.fn();
    store.selectChannel = vi.fn();

    store.handleMentionNavigate('channel', 'channel-ops');

    expect(store.navSection).toBe('chat');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.startWorkspaceLiveQueries).toHaveBeenCalledTimes(1);
    expect(store.selectChannel).toHaveBeenCalledWith('channel-ops');
  });

  it('navigates copied chat references to the source channel and thread', async () => {
    const store = await createStore();
    store.navSection = 'docs';
    store.mobileNavOpen = true;
    store.startWorkspaceLiveQueries = vi.fn();
    store.selectChannel = vi.fn().mockResolvedValue(undefined);
    store.openThread = vi.fn();
    store.syncRoute = vi.fn();

    store.handleMentionNavigate('chat', 'channel-ops#msg-1');
    await Promise.resolve();
    await Promise.resolve();

    expect(store.navSection).toBe('chat');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.selectChannel).toHaveBeenCalledWith('channel-ops', { syncRoute: false });
    expect(store.openThread).toHaveBeenCalledWith('msg-1', { scrollToLatest: false, syncRoute: false });
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('navigates copied folder and report references', async () => {
    const store = await createStore();
    store.navigateToFolder = vi.fn();
    store.startWorkspaceLiveQueries = vi.fn();
    store.openReportModalById = vi.fn();
    store.syncRoute = vi.fn();
    store.mobileNavOpen = true;

    store.handleMentionNavigate('directory', 'folder-1');
    store.handleMentionNavigate('report', 'report-1');

    expect(store.navigateToFolder).toHaveBeenCalledWith('folder-1');
    expect(store.navSection).toBe('reports');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.startWorkspaceLiveQueries).toHaveBeenCalledTimes(1);
    expect(store.openReportModalById).toHaveBeenCalledWith('report-1');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });
});
