import { describe, expect, it } from 'vitest';
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
} from '../src/workroom-creation-manager.js';

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
      participants: [{ actor_npub: 'npub-human', role: 'human_approver', label: 'Pete' }],
    }), { scopeId: 'scope-1', channelId: 'channel-1' });
    expect(payload).toMatchObject({
      scope_id: 'scope-1',
      channel_id: 'channel-1',
      repo: { url: 'https://github.com/acme/app', name: 'acme/app' },
      branches: { integration: 'feature/release', production: 'main' },
      app_targets: { preview: 'preview-123', production: 'prod-123' },
      approval_policy: { mode: 'human_required' },
      participants: [{ actor_npub: 'npub-human', role: 'human_approver', kind: 'human' }],
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
      { actor_npub: 'npub-a', role: 'contributor', label: 'Alice', lookup_query: 'Alice' },
      { actor_npub: 'npub-b', role: 'contributor', label: 'Bob', lookup_query: 'Bob' },
    ]);
  });

  it('limits integration selection to channel members and assigns the integration role', () => {
    const store = {
      selectedChannel: { record_id: 'channel-1', participant_npubs: ['npub-a', 'npub-b'] },
      workroomCreationForm: createWorkroomForm({ participants: [
        { actor_npub: 'npub-a', role: 'contributor', label: 'Alice' },
      ] }),
      getChannelParticipants: (channel) => channel.participant_npubs,
      getSenderName: (npub) => npub === 'npub-b' ? 'Bob' : 'Alice',
      getSenderSecondaryLabel: () => '',
      getSenderAvatar: () => null,
    };
    Object.assign(store, workroomCreationMixin);
    const suggestions = store.workroomPeopleSuggestions('Bob');
    expect(suggestions.map((person) => person.npub)).toEqual(['npub-b']);
    store.selectWorkroomIntegration(suggestions[0]);
    expect(store.workroomCreationForm).toMatchObject({ integration_autopilot_npub: 'npub-b' });
    expect(store.workroomCreationForm.participants).toContainEqual(expect.objectContaining({ actor_npub: 'npub-b', role: 'integration' }));
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
});
