import { describe, expect, it } from 'vitest';

import {
  isVisibleAgentActivity,
  mapPgAgentActivity,
  reconcileAgentActivity,
} from '../src/agent-activity.js';

function activity(overrides = {}) {
  return mapPgAgentActivity({
    id: 'row-1',
    activity_id: 'activity-1',
    channel_id: 'channel-1',
    thread_id: 'thread-1',
    trigger_message_id: 'message-1',
    session_id: 'session-1',
    agent_npub: 'npub1agent',
    state: 'working',
    visibility: 'user_visible',
    sequence: 1,
    summary: 'Running validation',
    body: 'Only explicit commentary is included.',
    expires_at: '2999-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('agent activity lifecycle', () => {
  it('replaces only with a newer sequence', () => {
    const current = activity({ sequence: 4, summary: 'Current' });
    expect(reconcileAgentActivity(current, activity({ sequence: 3, summary: 'Stale' }))).toBe(current);
    expect(reconcileAgentActivity(current, activity({ sequence: 5, summary: 'Newer' })).summary).toBe('Newer');
  });

  it.each(['completed', 'failed', 'cancelled'])('cleans up terminal state %s', (state) => {
    expect(reconcileAgentActivity(activity(), activity({ state, sequence: 2 }))).toBeNull();
  });

  it('rejects unsafe visibility and expires stale snapshots', () => {
    expect(activity({ visibility: 'hidden_reasoning' })).toBeNull();
    expect(isVisibleAgentActivity(activity({ expires_at: '2000-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isVisibleAgentActivity(activity())).toBe(true);
  });
});
