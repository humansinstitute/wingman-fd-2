import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  autopilotOverviewManagerMixin,
  buildAutopilotOverviewDocuments,
  buildAutopilotOverviewFiles,
  buildAutopilotOverviewTasks,
  buildAutopilotOverviewThreads,
  countUnresolvedDocumentComments,
} from '../src/autopilot-overview-manager.js';
import { buildPgChannelTaskBoardId } from '../src/pg-record-context.js';
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
    const rows = buildAutopilotOverviewThreads({
      channels,
      messages,
      unreadChannelMap: { 'chan-a': true },
    });

    expect(rows.map((row) => row.id)).toEqual(['thread-a', 'thread-b']);
    expect(rows[0]).toMatchObject({
      latestMessage: 'Newest reply',
      latestMessageUpdatedAt: '2026-06-15T10:20:00.000Z',
      messageCount: 3,
      isUnread: true,
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

  it('uses resolved DM channel names in thread cards instead of raw npubs', () => {
    const rows = buildAutopilotOverviewThreads({
      channels: [{
        record_id: 'dm-1',
        title: 'DM: npub1wingman21',
        channel_type: 'dm',
        participant_npubs: ['npub1pete', 'npub1wingman21'],
      }],
      messages: [{
        record_id: 'thread-dm',
        channel_id: 'dm-1',
        body: 'Hello',
        updated_at: '2026-06-15T10:00:00.000Z',
      }],
      sessionNpub: 'npub1pete',
      getSenderName: (npub) => (npub === 'npub1wingman21' ? 'Wingman 21' : npub),
    });

    expect(rows[0].channelLabel).toBe('Wingman 21');
  });

  it('opens an overview thread directly after selecting its channel', async () => {
    const calls = [];
    const store = {
      ...autopilotOverviewManagerMixin,
      focusMessageId: null,
      navigateTo(section) {
        calls.push(['navigateTo', section]);
      },
      async selectChannel(recordId, options) {
        calls.push(['selectChannel', recordId, options]);
      },
      openThread(recordId, options) {
        calls.push(['openThread', recordId, options]);
      },
    };

    await store.openAutopilotOverviewThread({
      id: 'thread-id',
      rootRecordId: 'root-message-id',
      channelId: 'chan-a',
    });

    expect(store.focusMessageId).toBe('root-message-id');
    expect(calls).toEqual([
      ['navigateTo', 'chat'],
      ['selectChannel', 'chan-a', { syncRoute: false, scrollToLatest: false }],
      ['openThread', 'root-message-id', { scrollToLatest: false }],
    ]);
  });

  it('derives overview context from the existing selected channel and scope state', () => {
    const store = Object.assign(Object.create(autopilotOverviewManagerMixin), {
      channels,
      selectedBoardId: buildPgChannelTaskBoardId('chan-a'),
      pgContextSelectedChannelId: 'chan-a',
      selectedChannelId: 'chan-b',
      scopesMap: new Map([
        ['scope-a', { record_id: 'scope-a', title: 'Implementation' }],
        ['scope-b', { record_id: 'scope-b', title: 'Design' }],
      ]),
    });

    expect(store.autopilotOverviewContext).toEqual({
      mode: 'context',
      scopeId: 'scope-a',
      channelId: 'chan-a',
    });
  });

  it('treats explicit All scope as unfiltered even when a previous channel is remembered', () => {
    const store = Object.assign(Object.create(autopilotOverviewManagerMixin), {
      channels,
      messages,
      selectedBoardId: '__all__',
      pgContextSelectedChannelId: null,
      selectedChannelId: 'chan-a',
      scopesMap: new Map([
        ['scope-a', { record_id: 'scope-a', title: 'Implementation' }],
        ['scope-b', { record_id: 'scope-b', title: 'Design' }],
      ]),
    });

    expect(store.autopilotOverviewContext).toEqual({
      mode: 'all',
      scopeId: 'all',
      channelId: 'all',
    });
    expect(store.autopilotOverviewContextLabel).toBe('All workspace activity');
    expect(store.autopilotOverviewThreads.map((thread) => thread.channelId).sort()).toEqual(['chan-a', 'chan-b']);
  });

  it('shows today daily scope note even when it still has scope metadata', () => {
    const store = Object.assign(Object.create(autopilotOverviewManagerMixin), {
      selectedBoardId: '__all__',
      pgContextSelectedChannelId: null,
      selectedChannelId: 'chan-a',
      getTodayDateKey: () => '2026-06-17',
      dailyNotes: [
        {
          record_id: 'daily-older',
          note_date: '2026-06-17',
          title: 'Older Daily Scope',
          focus: 'Old focus',
          pg_scope_id: 'scope-a',
          pg_channel_id: 'chan-a',
          updated_at: '2026-06-17T08:00:00.000Z',
        },
        {
          record_id: 'daily-newer',
          note_date: '2026-06-17',
          title: 'Daily note',
          body: 'Narrative should not render in the preview card',
          focus: 'Deploy Kindling Pipelines, Kick Off Plantrite, Scout Cash',
          items: [
            { id: 'one', text: 'Deploy Kindling Pipelines', completed: true },
            { id: 'two', text: 'Kick Off Plantrite', completed: false },
            { id: 'three', text: 'Scout Cash', completed: false },
            { id: 'four', text: 'Review Daily Scope', completed: false },
          ],
          metadata: { scope_id: 'scope-b', channel_id: 'chan-b', source: 'manual' },
          updated_at: '2026-06-17T09:00:00.000Z',
        },
      ],
    });

    expect(store.autopilotOverviewDailyNote).toEqual(expect.objectContaining({
      note: expect.objectContaining({ record_id: 'daily-newer' }),
      duplicateCount: 1,
      title: 'Daily Note',
      progress: '1/4 done',
      body: 'Narrative should not render in the preview card',
      hasMoreBody: false,
      items: [
        { id: 'one', text: 'Deploy Kindling Pipelines', completed: true },
        { id: 'two', text: 'Kick Off Plantrite', completed: false },
        { id: 'three', text: 'Scout Cash', completed: false },
        { id: 'four', text: 'Review Daily Scope', completed: false },
      ],
    }));
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
      unreadTaskMap: { 'task-b': true },
    });

    expect(rows.map((row) => row.recordId)).toEqual(['task-b', 'task-a']);
    expect(rows[0]).toMatchObject({
      reason: '2 recent comments',
      count: 2,
      activityAt: '2026-06-15T11:00:00.000Z',
      isUnread: true,
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
      unreadDocumentMap: { 'doc-b': true },
    });

    expect(rows.map((row) => row.recordId)).toEqual(['doc-b', 'doc-a']);
    expect(rows[0]).toMatchObject({
      reason: '1 unresolved comment',
      count: 1,
      activityAt: '2026-06-15T11:00:00.000Z',
      isUnread: true,
    });
  });

  it('keeps file-backed document records out of the overview document rows', () => {
    const rows = buildAutopilotOverviewDocuments({
      documents: [
        { record_id: 'doc-a', title: 'Real doc', updated_at: '2026-06-15T10:00:00.000Z', scope_id: 'scope-a', pg_channel_id: 'chan-a' },
        {
          record_id: 'file-a',
          title: 'Uploaded file.pdf',
          updated_at: '2026-06-15T11:00:00.000Z',
          scope_id: 'scope-a',
          pg_channel_id: 'chan-a',
          pg_record_type: 'file',
          pg_storage_object_id: 'storage-file-a',
        },
      ],
    });

    expect(rows.map((row) => row.recordId)).toEqual(['doc-a']);
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

  it('orders files by created or uploaded fallback timestamps when updated time is absent', () => {
    const rows = buildAutopilotOverviewFiles([
      { object_id: 'older-upload', name: 'Older upload', uploaded_at: '2026-06-15T08:00:00.000Z' },
      { object_id: 'newer-created', name: 'Newer created', created_at: '2026-06-15T11:00:00.000Z' },
      { object_id: 'middle-upload', name: 'Middle upload', uploaded_at: '2026-06-15T10:00:00.000Z' },
    ]);

    expect(rows.map((row) => row.object_id)).toEqual(['newer-created', 'middle-upload', 'older-upload']);
    expect(rows.map((row) => row.activityAt)).toEqual([
      '2026-06-15T11:00:00.000Z',
      '2026-06-15T10:00:00.000Z',
      '2026-06-15T08:00:00.000Z',
    ]);
  });

  it('keeps document body storage rows out of overview files', () => {
    const rows = buildAutopilotOverviewFiles([
      { object_id: 'doc-body', name: 'Scratch pad', source_type: 'document', kind: 'document', updated_at: '2026-06-15T10:00:00.000Z' },
      { object_id: 'attachment', name: 'Upload.pdf', source_type: 'document', kind: 'file', updated_at: '2026-06-15T11:00:00.000Z' },
    ]);

    expect(rows.map((row) => row.object_id)).toEqual(['attachment']);
  });

  it('includes stable overview test ids and accessible labels', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    [
      'data-testid="autopilot-overview-page"',
      'data-testid="autopilot-overview-daily-scope"',
      'data-testid="autopilot-overview-recent-threads"',
      'data-testid="autopilot-overview-recent-tasks"',
      'data-testid="autopilot-overview-documents"',
      'data-testid="autopilot-overview-files"',
      'data-testid="autopilot-overview-threads-list"',
      'data-testid="autopilot-overview-tasks-list"',
      'data-testid="autopilot-overview-documents-list"',
      'data-testid="autopilot-overview-files-list"',
      'aria-label="View all recent threads"',
      'aria-label="Open selected thread"',
    ].forEach((expected) => {
      expect(html).toContain(expected);
    });

    [
      'data-testid="autopilot-overview-scope-select"',
      'data-testid="autopilot-overview-channel-select"',
      'aria-label="Filter Autopilot Overview by scope"',
      'aria-label="Filter Autopilot Overview by chat channel"',
    ].forEach((removed) => {
      expect(html).not.toContain(removed);
    });
  });
});
