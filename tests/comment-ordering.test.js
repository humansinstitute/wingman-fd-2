import { describe, expect, it } from 'vitest';
import { sortCommentsNewestFirst } from '../src/comment-ordering.js';

describe('comment ordering', () => {
  it('sorts comments newest first using updated timestamps', () => {
    const comments = [
      { record_id: 'oldest', updated_at: '2026-06-23T01:00:00.000Z' },
      { record_id: 'newest', updated_at: '2026-06-23T03:00:00.000Z' },
      { record_id: 'middle', updated_at: '2026-06-23T02:00:00.000Z' },
    ];

    expect(sortCommentsNewestFirst(comments).map((comment) => comment.record_id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('falls back to created timestamps before deterministic ids', () => {
    const comments = [
      { record_id: 'b', created_at: '2026-06-23T01:00:00.000Z' },
      { record_id: 'c' },
      { record_id: 'a', created_at: '2026-06-23T02:00:00.000Z' },
    ];

    expect(sortCommentsNewestFirst(comments).map((comment) => comment.record_id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
