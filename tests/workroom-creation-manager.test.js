import { describe, expect, it } from 'vitest';
import {
  buildWorkroomCreatePayload,
  createWorkroomForm,
  failedWorkroomParticipants,
  mergeWorkroomFormWithChannelDefaults,
  workroomDefaultsFromChannel,
} from '../src/workroom-creation-manager.js';

describe('workroom creation flow helpers', () => {
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

  it('identifies participant access failures for the warning state', () => {
    expect(failedWorkroomParticipants([
      { actor_npub: 'npub-ok', access_status: 'granted' },
      { actor_npub: 'npub-failed', access_status: 'failed', access_issue: 'workspace_membership_missing' },
    ])).toEqual([{ actor_npub: 'npub-failed', access_status: 'failed', access_issue: 'workspace_membership_missing' }]);
  });
});
