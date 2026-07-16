import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPendingWorkroomApprovals,
  getWorkroomEvents,
  getWorkroomLinks,
  getWorkroomParticipants,
  getWorkroomsByChannel,
  openWorkspaceDb,
  replacePgWorkroomsForChannel,
  replaceWorkroomApprovalsForRoom,
  replaceWorkroomEventsForRoom,
  replaceWorkroomLinksForRoom,
  replaceWorkroomParticipantsForRoom,
  upsertWorkroom,
} from '../src/db.js';
import {
  filterActiveWorkrooms,
  filterArchivedWorkrooms,
  filterCurrentChannelWorkrooms,
  searchLocalWorkrooms,
  searchWorkroomRows,
} from '../src/workrooms.js';

const TEST_OWNER = 'npub_test_workrooms_workspace';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
});

function room(overrides = {}) {
  return {
    record_id: 'room-1',
    workspace_id: 'workspace-1',
    scope_id: 'scope-1',
    channel_id: 'channel-1',
    title: 'Release workroom',
    goal: 'Prepare production merge',
    status: 'active',
    repo: { url: 'https://github.example/app' },
    branches: { integration: 'feature/workroom', production: 'main' },
    app_targets: { preview_url: 'https://preview.example' },
    metadata: {},
    row_version: 1,
    created_at: '2026-07-16T01:00:00.000Z',
    updated_at: '2026-07-16T02:00:00.000Z',
    ...overrides,
  };
}

describe('workroom db helpers', () => {
  it('stores and replaces channel workrooms', async () => {
    await upsertWorkroom(room());
    await replacePgWorkroomsForChannel('channel-1', [
      room({ record_id: 'room-2', title: 'Second room' }),
    ]);

    const rows = await getWorkroomsByChannel('channel-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].record_id).toBe('room-2');
  });

  it('stores participants, events, links, and pending approvals by workroom', async () => {
    await replaceWorkroomParticipantsForRoom('room-1', [{
      record_id: 'participant-1',
      workroom_id: 'room-1',
      actor_npub: 'npub1human',
      role: 'human_approver',
      status: 'active',
      access_status: 'granted',
      updated_at: '2026-07-16T02:00:00.000Z',
    }]);
    await replaceWorkroomEventsForRoom('room-1', [{
      record_id: 'event-1',
      workroom_id: 'room-1',
      event_type: 'approval_requested',
      created_at: '2026-07-16T02:01:00.000Z',
    }]);
    await replaceWorkroomLinksForRoom('room-1', [{
      record_id: 'link-1',
      workroom_id: 'room-1',
      link_type: 'pull_request',
      target_type: 'external',
      external_url: 'https://github.example/pr/1',
      updated_at: '2026-07-16T02:02:00.000Z',
    }]);
    await replaceWorkroomApprovalsForRoom('room-1', [{
      record_id: 'approval-1',
      target_type: 'workroom',
      target_id: 'room-1',
      action: 'production_merge',
      status: 'requested',
      channel_id: 'channel-1',
      updated_at: '2026-07-16T02:03:00.000Z',
    }]);

    expect(await getWorkroomParticipants('room-1')).toHaveLength(1);
    expect((await getWorkroomEvents('room-1'))[0].record_id).toBe('event-1');
    expect((await getWorkroomLinks('room-1'))[0].record_id).toBe('link-1');
    expect((await getPendingWorkroomApprovals({ channelId: 'channel-1' }))[0].record_id).toBe('approval-1');
  });
});

describe('workroom selectors', () => {
  it('filters current channel active and archived workrooms', () => {
    const rows = [
      room({ record_id: 'active', status: 'active', channel_id: 'channel-1' }),
      room({ record_id: 'archived', status: 'archived', channel_id: 'channel-1', archived_at: '2026-07-16T03:00:00.000Z' }),
      room({ record_id: 'other-channel', status: 'active', channel_id: 'channel-2' }),
    ];

    expect(filterCurrentChannelWorkrooms(rows, 'channel-1').map((row) => row.record_id)).toEqual(['archived', 'active']);
    expect(filterActiveWorkrooms(rows).map((row) => row.record_id)).toEqual(['other-channel', 'active']);
    expect(filterArchivedWorkrooms(rows).map((row) => row.record_id)).toEqual(['archived']);
  });

  it('searches title, goal, repo, branches, app targets, and metadata', () => {
    const rows = [
      room({ record_id: 'repo-match', repo: { url: 'https://github.example/payments' } }),
      room({ record_id: 'metadata-match', metadata: { pull_request: 42 } }),
    ];

    expect(searchWorkroomRows(rows, 'payments').map((row) => row.record_id)).toEqual(['repo-match']);
    expect(searchWorkroomRows(rows, '42').map((row) => row.record_id)).toEqual(['metadata-match']);
  });

  it('returns no local search rows without a workspace or channel scope', async () => {
    await expect(searchLocalWorkrooms('release')).resolves.toEqual([]);
  });
});
