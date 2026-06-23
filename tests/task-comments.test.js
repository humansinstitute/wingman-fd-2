import { describe, expect, it } from 'vitest';
import {
  isTaskCommentExpanded,
  isTaskCommentTruncated,
  normalizeTaskComments,
  syncTaskCommentPreviewState,
  toggleTaskCommentExpandedId,
} from '../src/task-comments.js';

describe('task comment helpers', () => {
  it('sorts comments newest first and removes duplicate record ids', () => {
    const comments = normalizeTaskComments([
      { record_id: 'comment-a', updated_at: '2026-06-22T10:00:00.000Z' },
      { record_id: 'comment-b', updated_at: '2026-06-22T11:00:00.000Z' },
      { record_id: 'comment-a', updated_at: '2026-06-22T12:00:00.000Z' },
      { record_id: '', updated_at: '2026-06-22T13:00:00.000Z' },
    ]);

    expect(comments.map((comment) => comment.record_id)).toEqual(['comment-a', 'comment-b']);
    expect(comments[0].updated_at).toBe('2026-06-22T12:00:00.000Z');
  });

  it('tracks expanded and truncated preview ids without stale comment ids', () => {
    expect(isTaskCommentExpanded(['comment-1'], 'comment-1')).toBe(true);
    expect(isTaskCommentTruncated(['comment-2'], 'comment-2')).toBe(true);
    expect(toggleTaskCommentExpandedId(['comment-1'], 'comment-1')).toEqual([]);
    expect(toggleTaskCommentExpandedId([], 'comment-1')).toEqual(['comment-1']);

    expect(syncTaskCommentPreviewState({
      comments: [{ record_id: 'comment-1' }],
      expandedIds: ['comment-1', 'stale-comment'],
      truncatedIds: ['comment-1', 'other-stale-comment'],
    })).toEqual({
      expandedIds: ['comment-1'],
      truncatedIds: ['comment-1'],
    });
  });
});
