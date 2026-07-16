import { describe, expect, it } from 'vitest';
import {
  filterWorkroomEvents,
  isWorkroomApprovalApprover,
  workroomAnnouncementChannelId,
  workroomAnnouncementMessageId,
  workroomAnnouncementThreadId,
  workroomApprovalDetails,
  workroomDetailMixin,
} from '../src/workroom-detail-manager.js';

const events = [
  { record_id: 'goal', event_type: 'goal_created', title: 'Initial goal', actor_npub: 'npub-human', created_at: '2026-07-10T01:00:00Z' },
  { record_id: 'pr', event_type: 'pull_request_opened', target_type: 'pull_request', target_ref: 'PR-42', title: 'Integration PR', created_at: '2026-07-11T01:00:00Z' },
  { record_id: 'deploy', event_type: 'preview_deployed', title: 'Preview deployed', body: 'Preview URL ready', created_at: '2026-07-12T01:00:00Z' },
  { record_id: 'blocker', event_type: 'blocker_reported', title: 'Access blocker', body: 'Participant access failed', created_at: '2026-07-13T01:00:00Z' },
];

describe('workroom detail event filters', () => {
  it('filters history by event family, actor, reference, and date', () => {
    expect(filterWorkroomEvents(events, { type: 'pr' }).map((event) => event.record_id)).toEqual(['pr']);
    expect(filterWorkroomEvents(events, { actor: 'npub-human' }).map((event) => event.record_id)).toEqual(['goal']);
    expect(filterWorkroomEvents(events, { artifact: 'PR-42' }).map((event) => event.record_id)).toEqual(['pr']);
    expect(filterWorkroomEvents(events, { from: '2026-07-12', to: '2026-07-12' }).map((event) => event.record_id)).toEqual(['deploy']);
  });

  it('recognizes blocker and deploy history using event metadata', () => {
    expect(filterWorkroomEvents(events, { type: 'blocker' }).map((event) => event.record_id)).toEqual(['blocker']);
    expect(filterWorkroomEvents(events, { type: 'deploy' }).map((event) => event.record_id)).toEqual(['deploy']);
  });
});

describe('workroom production merge approvals', () => {
  const room = {
    repo: { name: 'org/flight-deck' },
    branches: { integration: 'feature/fd-04', production: 'main' },
    integration_autopilot_npub: 'npub1autopilot',
    approval_policy: { human_approver_npubs: ['npub1approver'] },
  };
  const approval = {
    metadata: {
      repo: 'org/flight-deck',
      from_branch: 'feature/fd-04',
      to_branch: 'main',
      commit: 'abc123',
      preview_url: 'https://preview.example.test',
      validation_evidence: ['bun test', 'bun run build'],
    },
  };

  it('normalizes the exact merge context and validation evidence for review', () => {
    expect(workroomApprovalDetails(approval, room)).toEqual({
      repo: 'org/flight-deck',
      fromBranch: 'feature/fd-04',
      productionBranch: 'main',
      commit: 'abc123',
      previewUrl: 'https://preview.example.test',
      integrationAutopilot: 'npub1autopilot',
      validationEvidence: ['bun test', 'bun run build'],
    });
  });

  it('allows only policy or active human approvers to decide', () => {
    expect(isWorkroomApprovalApprover(room, [], 'npub1approver')).toBe(true);
    expect(isWorkroomApprovalApprover(room, [], 'npub1contributor')).toBe(false);
    expect(isWorkroomApprovalApprover({ approval_policy: {} }, [{ actor_npub: 'npub1approver', role: 'human_approver', access_status: 'granted', status: 'active' }], 'npub1approver')).toBe(true);
    expect(isWorkroomApprovalApprover({ approval_policy: {} }, [{ actor_npub: 'npub1approver', role: 'human_approver', access_status: 'failed', status: 'active' }], 'npub1approver')).toBe(false);
  });
});

describe('workroom announcement thread helpers', () => {
  it('resolves durable announcement ids from workroom metadata', () => {
    const room = {
      channel_id: 'channel-1',
      metadata: {
        announcement_message_id: 'message-1',
        announcement_thread_id: 'thread-1',
      },
    };
    expect(workroomAnnouncementMessageId(room)).toBe('message-1');
    expect(workroomAnnouncementThreadId(room)).toBe('thread-1');
    expect(workroomAnnouncementChannelId(room)).toBe('channel-1');
  });

  it('activates the announcement message as the selected workroom thread', async () => {
    const opened = [];
    const store = {
      activeWorkroomId: 'room-1',
      selectedChannelId: 'old-channel',
      workrooms: [{
        record_id: 'room-1',
        channel_id: 'channel-1',
        metadata: {
          announcement_message_id: 'message-1',
          announcement_thread_id: 'thread-1',
        },
      }],
      messages: [{ record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1', metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } }],
      selectPgChannelContext(channelId) { this.selectedChannelId = channelId; },
      refreshMessages: async () => {},
      openThread(recordId, options) { opened.push({ recordId, options }); },
    };
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workroomDetailMixin));

    await store.openSelectedWorkroomThread({ syncRoute: false });

    expect(store.selectedChannelId).toBe('channel-1');
    expect(opened).toEqual([{ recordId: 'message-1', options: { scrollToLatest: true, syncRoute: false, preserveComposer: false } }]);
  });

  it('opens the announcement root when only the thread id is persisted on the workroom', async () => {
    const opened = [];
    const store = {
      activeWorkroomId: 'room-1',
      selectedChannelId: 'channel-1',
      workroomDetailNotice: '',
      workrooms: [{
        record_id: 'room-1',
        channel_id: 'channel-1',
        metadata: { announcement_thread_id: 'thread-1' },
      }],
      messages: [{ record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1', parent_message_id: null, pg_metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } }],
      refreshMessages: async () => {},
      openThread(recordId, options) { opened.push({ recordId, options }); },
    };
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workroomDetailMixin));

    await store.openSelectedWorkroomThread({ syncRoute: false });

    expect(store.selectedWorkroomAnnouncementMessageId).toBe('message-1');
    expect(store.workroomDetailNotice).toBe('');
    expect(opened).toEqual([{ recordId: 'message-1', options: { scrollToLatest: true, syncRoute: false, preserveComposer: false } }]);
  });

  it('ignores stale unthreaded announcement duplicates when a durable thread id exists', async () => {
    const opened = [];
    const store = {
      activeWorkroomId: 'room-1',
      selectedChannelId: 'channel-1',
      workroomDetailNotice: '',
      workrooms: [{
        record_id: 'room-1',
        channel_id: 'channel-1',
        metadata: {
          announcement_thread_id: 'thread-1',
        },
      }],
      messages: [
        { record_id: 'stale-message', channel_id: 'channel-1', pg_thread_id: null, parent_message_id: null, pg_metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } },
        { record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1', parent_message_id: null, pg_metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } },
      ],
      refreshMessages: async () => {},
      openThread(recordId, options) { opened.push({ recordId, options }); },
    };
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workroomDetailMixin));

    await store.openSelectedWorkroomThread({ syncRoute: false });

    expect(store.selectedWorkroomAnnouncementMessageId).toBe('message-1');
    expect(store.workroomDetailNotice).toBe('');
    expect(opened).toEqual([{ recordId: 'message-1', options: { scrollToLatest: true, syncRoute: false, preserveComposer: false } }]);
  });

  it('uses a metadata-tagged announcement message even before durable ids are hydrated', async () => {
    const opened = [];
    const store = {
      activeWorkroomId: 'room-1',
      selectedChannelId: 'channel-1',
      workroomDetailNotice: '',
      workrooms: [{ record_id: 'room-1', channel_id: 'channel-1', metadata: {} }],
      messages: [{ record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1', parent_message_id: null, pg_metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } }],
      refreshMessages: async () => {},
      openThread(recordId, options) { opened.push({ recordId, options }); },
    };
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workroomDetailMixin));

    await store.openSelectedWorkroomThread({ syncRoute: false });

    expect(store.selectedWorkroomAnnouncementMessageId).toBe('message-1');
    expect(opened).toEqual([{ recordId: 'message-1', options: { scrollToLatest: true, syncRoute: false, preserveComposer: false } }]);
  });

  it('preserves the typed room reply while activating the announcement thread for send', async () => {
    const sent = [];
    const opened = [];
    const store = {
      activeWorkroomId: 'room-1',
      selectedChannelId: 'channel-1',
      threadInput: 'Reply from the workroom',
      workrooms: [{
        record_id: 'room-1',
        channel_id: 'channel-1',
        metadata: {
          announcement_message_id: 'message-1',
          announcement_thread_id: 'thread-1',
        },
      }],
      messages: [{ record_id: 'message-1', channel_id: 'channel-1', pg_thread_id: 'thread-1', parent_message_id: null, pg_metadata: { kind: 'workroom_announcement', workroom_id: 'room-1' } }],
      refreshMessages: async () => {},
      openThread(recordId, options) {
        opened.push({ recordId, options });
        if (options?.preserveComposer !== true) this.threadInput = '';
        this.activeThreadId = recordId;
      },
      sendThreadReply() { sent.push({ activeThreadId: this.activeThreadId, body: this.threadInput }); },
    };
    Object.defineProperties(store, Object.getOwnPropertyDescriptors(workroomDetailMixin));

    await store.sendSelectedWorkroomThreadReply();

    expect(opened).toEqual([{ recordId: 'message-1', options: { scrollToLatest: true, syncRoute: false, preserveComposer: true } }]);
    expect(sent).toEqual([{ activeThreadId: 'message-1', body: 'Reply from the workroom' }]);
  });
});
