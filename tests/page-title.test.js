import { describe, expect, it } from 'vitest';
import { buildFlightDeckDocumentTitle } from '../src/page-title.js';

describe('page title', () => {
  it('builds task titles', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'tasks' })).toBe('Tasks - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'tasks', workspaceLabel: 'Pete' })).toBe('Tasks | Pete - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'workroom', workspaceLabel: 'Pete' })).toBe('Workroom | Pete - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'opportunities' })).toBe('Opportunities - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'settings' })).toBe('Setup - Wingman: Deck');
  });

  it('builds chat titles with channel context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'chat' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', channelLabel: 'WM21' })).toBe('Chat | WM21 - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'chat', workspaceLabel: 'Other Stuff', channelLabel: 'WM21' })).toBe('Chat | Other Stuff | WM21 - Wingman: Deck');
  });

  it('falls back to chat titles for removed or unknown sections', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'live' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'calendar' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'schedules' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'scopes' })).toBe('Chat - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'flows' })).toBe('Chat - Wingman: Deck');
  });

  it('builds docs titles from folder or document context', () => {
    expect(buildFlightDeckDocumentTitle({ section: 'docs', folderLabel: 'Ops' })).toBe('Docs | Ops - Wingman: Deck');
    expect(buildFlightDeckDocumentTitle({ section: 'docs', workspaceLabel: 'Pete', docTitle: 'Launch Plan' })).toBe('Docs | Pete | Launch Plan - Wingman: Deck');
  });
});
