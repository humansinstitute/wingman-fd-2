import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAgentActivity,
  getAgentActivitiesForChannel,
  openWorkspaceDb,
  replacePgAgentActivitiesForChannel,
  upsertAgentActivity,
} from '../src/db.js';

const TEST_WORKSPACE = 'agent-activity-db-workspace';

beforeEach(async () => {
  const db = openWorkspaceDb(TEST_WORKSPACE);
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

function row(overrides = {}) {
  return {
    record_id: 'row-1', activity_id: 'activity-1', channel_id: 'channel-1', thread_id: 'thread-1',
    trigger_message_id: 'message-1', session_id: 'session-1', agent_npub: 'npub1agent',
    state: 'working', visibility: 'user_visible', sequence: 1,
    expires_at: '2999-01-01T00:00:00.000Z', updated_at: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent activity db', () => {
  it('keeps newer snapshots when stale SSE work arrives later', async () => {
    await upsertAgentActivity(row({ sequence: 3, summary: 'Newer' }));
    expect(await upsertAgentActivity(row({ sequence: 2, summary: 'Stale' }))).toBe(false);
    expect((await getAgentActivitiesForChannel('channel-1'))[0].summary).toBe('Newer');
  });

  it('replaces reconnect hydration and supports terminal cleanup', async () => {
    await replacePgAgentActivitiesForChannel('channel-1', [row()]);
    expect(await getAgentActivitiesForChannel('channel-1')).toHaveLength(1);
    await clearAgentActivity('row-1');
    expect(await getAgentActivitiesForChannel('channel-1')).toEqual([]);
  });
});
