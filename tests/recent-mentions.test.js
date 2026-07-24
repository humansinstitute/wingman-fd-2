import { describe, expect, it } from 'vitest';
import { rankRecentActorMentions } from '../src/recent-mentions.js';

const people = ['alice', 'bob', 'rick', 'gone'].map((id) => ({ type: id === 'rick' ? 'agent' : 'person', id, label: id }));
const message = (id, mentions, created_at, thread_id = '') => ({
  record_id: id,
  thread_id,
  created_at,
  metadata: { mentions: mentions.map((npub) => ({ npub })) },
});

describe('rankRecentActorMentions', () => {
  it('ranks distinct active-thread mentions before newer channel mentions', () => {
    const results = rankRecentActorMentions({
      messages: [
        message('channel', ['alice'], '2026-07-24T03:00:00Z'),
        message('thread-old', ['bob'], '2026-07-24T01:00:00Z', 'thread-1'),
        message('thread-new', ['rick'], '2026-07-24T02:00:00Z', 'thread-1'),
        message('thread-1', ['gone'], '2026-07-24T00:00:00Z'),
      ],
      threadId: 'thread-1',
      mentionPeople: people,
    });
    expect(results.map((person) => person.id)).toEqual(['rick', 'bob', 'gone', 'alice']);
  });

  it('excludes the viewer, draft mentions, duplicates, deleted messages, and unresolved actors', () => {
    const results = rankRecentActorMentions({
      messages: [
        message('latest', ['alice', 'unknown', 'bob', 'alice'], '2026-07-24T03:00:00Z'),
        { ...message('deleted', ['rick'], '2026-07-24T04:00:00Z'), record_state: 'deleted' },
      ],
      mentionPeople: people.filter((person) => person.id !== 'gone'),
      currentUserNpub: 'alice',
      draft: '@[Bob](mention:person:bob)',
    });
    expect(results).toEqual([]);
  });

  it('reads PG mention metadata and respects the compact limit', () => {
    const results = rankRecentActorMentions({
      messages: [{ created_at: '2026-07-24T03:00:00Z', pg_metadata: { mentions: [{ npub: 'alice' }, { npub: 'bob' }] } }],
      mentionPeople: people,
      limit: 1,
    });
    expect(results.map((person) => person.id)).toEqual(['bob']);
  });
});
