import { describe, expect, it } from 'vitest';

import {
  buildAutopilotOverviewFiles,
  buildAutopilotOverviewThreads,
  countUnresolvedDocumentComments,
} from '../src/autopilot-overview-manager.js';
import { recordFamilyHash } from '../src/translators/chat.js';

describe('autopilot overview manager', () => {
  const channels = [
    { record_id: 'chan-a', title: 'Implementation', scope_id: 'scope-a' },
    { record_id: 'chan-b', title: 'Design', scope_id: 'scope-b' },
  ];

  const messages = [
    {
      record_id: 'thread-a',
      channel_id: 'chan-a',
      body: 'Initial request',
      updated_at: '2026-06-15T10:00:00.000Z',
    },
    {
      record_id: 'reply-a-old',
      channel_id: 'chan-a',
      parent_message_id: 'thread-a',
      body: 'Older reply',
      updated_at: '2026-06-15T10:05:00.000Z',
    },
    {
      record_id: 'reply-a-new',
      channel_id: 'chan-a',
      parent_message_id: 'thread-a',
      body: 'Newest reply',
      updated_at: '2026-06-15T10:20:00.000Z',
    },
    {
      record_id: 'thread-b',
      channel_id: 'chan-b',
      body: 'Design thread',
      updated_at: '2026-06-15T10:10:00.000Z',
    },
  ];

  it('orders threads by latest message, not thread root timestamp', () => {
    const rows = buildAutopilotOverviewThreads({ channels, messages });

    expect(rows.map((row) => row.id)).toEqual(['thread-a', 'thread-b']);
    expect(rows[0]).toMatchObject({
      latestMessage: 'Newest reply',
      latestMessageUpdatedAt: '2026-06-15T10:20:00.000Z',
      messageCount: 3,
    });
  });

  it('filters overview threads by scope and channel together', () => {
    expect(buildAutopilotOverviewThreads({
      channels,
      messages,
      selectedScopeId: 'scope-b',
    }).map((row) => row.id)).toEqual(['thread-b']);

    expect(buildAutopilotOverviewThreads({
      channels,
      messages,
      selectedScopeId: 'scope-a',
      selectedChannelId: 'chan-b',
    })).toEqual([]);
  });

  it('counts only unresolved root document comments', () => {
    const documents = [
      { record_id: 'doc-open', title: 'Open', record_state: 'active' },
      { record_id: 'doc-deleted', title: 'Deleted', record_state: 'deleted' },
    ];
    const comments = [
      {
        record_id: 'comment-open',
        target_record_id: 'doc-open',
        target_record_family_hash: recordFamilyHash('document'),
        comment_status: 'open',
      },
      {
        record_id: 'comment-reply',
        target_record_id: 'doc-open',
        target_record_family_hash: recordFamilyHash('document'),
        parent_comment_id: 'comment-open',
        comment_status: 'open',
      },
      {
        record_id: 'comment-resolved',
        target_record_id: 'doc-open',
        target_record_family_hash: recordFamilyHash('document'),
        comment_status: 'resolved',
      },
      {
        record_id: 'comment-deleted-doc',
        target_record_id: 'doc-deleted',
        target_record_family_hash: recordFamilyHash('document'),
        comment_status: 'open',
      },
    ];

    expect(countUnresolvedDocumentComments({ documents, comments })).toBe(1);
  });

  it('orders files by newest update then name', () => {
    const rows = buildAutopilotOverviewFiles([
      { object_id: 'b', name: 'Beta', updated_at: '2026-06-15T10:00:00.000Z' },
      { object_id: 'a', name: 'Alpha', updated_at: '2026-06-15T10:00:00.000Z' },
      { object_id: 'c', name: 'Gamma', updated_at: '2026-06-15T11:00:00.000Z' },
    ]);

    expect(rows.map((row) => row.object_id)).toEqual(['c', 'a', 'b']);
  });
});
