import { describe, expect, it } from 'vitest';

import {
  buildAutopilotOverviewDocuments,
  buildAutopilotOverviewFiles,
  buildAutopilotOverviewTasks,
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
      selectedChannelId: 'chan-b',
    }).map((row) => row.id)).toEqual(['thread-b']);

    expect(buildAutopilotOverviewThreads({
      channels,
      messages,
      selectedScopeId: 'scope-a',
      selectedChannelId: 'chan-b',
    })).toEqual([]);
  });

  it('counts only unresolved document comments', () => {
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

    expect(countUnresolvedDocumentComments({ documents, comments })).toBe(2);
  });

  it('orders tasks by newest task comment and aggregates comment rows', () => {
    const rows = buildAutopilotOverviewTasks({
      tasks: [
        { record_id: 'task-a', title: 'Older task', updated_at: '2026-06-15T10:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
        { record_id: 'task-b', title: 'Commented task', updated_at: '2026-06-15T09:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
      ],
      comments: [
        {
          record_id: 'comment-b-1',
          target_record_id: 'task-b',
          target_record_family_hash: recordFamilyHash('task'),
          updated_at: '2026-06-15T11:00:00.000Z',
        },
        {
          record_id: 'comment-b-2',
          target_record_id: 'task-b',
          target_record_family_hash: recordFamilyHash('task'),
          updated_at: '2026-06-15T10:30:00.000Z',
        },
      ],
    });

    expect(rows.map((row) => row.recordId)).toEqual(['task-b', 'task-a']);
    expect(rows[0]).toMatchObject({
      reason: '2 recent comments',
      count: 2,
      activityAt: '2026-06-15T11:00:00.000Z',
    });
  });

  it('aggregates unresolved document comments and ignores resolved comments for ordering', () => {
    const rows = buildAutopilotOverviewDocuments({
      documents: [
        { record_id: 'doc-a', title: 'Doc A', updated_at: '2026-06-15T10:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
        { record_id: 'doc-b', title: 'Doc B', updated_at: '2026-06-15T09:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
      ],
      comments: [
        {
          record_id: 'comment-open',
          target_record_id: 'doc-b',
          target_record_family_hash: recordFamilyHash('document'),
          comment_status: 'open',
          updated_at: '2026-06-15T11:00:00.000Z',
        },
        {
          record_id: 'comment-resolved',
          target_record_id: 'doc-a',
          target_record_family_hash: recordFamilyHash('document'),
          comment_status: 'resolved',
          updated_at: '2026-06-15T12:00:00.000Z',
        },
      ],
    });

    expect(rows.map((row) => row.recordId)).toEqual(['doc-b', 'doc-a']);
    expect(rows[0]).toMatchObject({
      reason: '1 unresolved comment',
      count: 1,
      activityAt: '2026-06-15T11:00:00.000Z',
    });
  });

  it('excludes ambiguous records from scope and channel filtered task rows', () => {
    const rows = buildAutopilotOverviewTasks({
      tasks: [
        { record_id: 'task-a', title: 'Scoped', updated_at: '2026-06-15T10:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
        { record_id: 'task-missing-channel', title: 'Ambiguous', updated_at: '2026-06-15T11:00:00.000Z', scope_id: 'scope-a' },
      ],
      selectedScopeId: 'scope-a',
      selectedChannelId: 'chan-a',
    });

    expect(rows.map((row) => row.recordId)).toEqual(['task-a']);
    expect(rows.diagnostics).toEqual(['1 task record is hidden because scope/channel is missing.']);
  });

  it('orders files by newest update then name and filters scope plus channel', () => {
    const rows = buildAutopilotOverviewFiles([
      { object_id: 'b', name: 'Beta', updated_at: '2026-06-15T10:00:00.000Z' },
      { object_id: 'a', name: 'Alpha', updated_at: '2026-06-15T10:00:00.000Z' },
      { object_id: 'c', name: 'Gamma', updated_at: '2026-06-15T11:00:00.000Z' },
    ]);

    expect(rows.map((row) => row.object_id)).toEqual(['c', 'a', 'b']);

    const scopedRows = buildAutopilotOverviewFiles([
      { object_id: 'kept', name: 'Kept', updated_at: '2026-06-15T10:00:00.000Z', scope_id: 'scope-a', channel_id: 'chan-a' },
      { object_id: 'hidden', name: 'Hidden', updated_at: '2026-06-15T11:00:00.000Z', scope_id: 'scope-a' },
    ], {
      selectedScopeId: 'scope-a',
      selectedChannelId: 'chan-a',
    });

    expect(scopedRows.map((row) => row.object_id)).toEqual(['kept']);
    expect(scopedRows.diagnostics).toEqual(['1 file record is hidden because scope/channel is missing.']);
  });
});
