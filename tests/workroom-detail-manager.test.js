import { describe, expect, it } from 'vitest';
import { filterWorkroomEvents } from '../src/workroom-detail-manager.js';

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
