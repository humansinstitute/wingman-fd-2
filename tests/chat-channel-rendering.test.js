import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

describe('Chat channel rendering hooks', () => {
  it('renders explicit unread-row and divider hooks for chat messages', () => {
    expect(html).toContain('chat-post-unread');
    expect(html).toContain('chat-post-divider');
  });

  it('keeps the load-more control wired to the shared visibility getter', () => {
    expect(html).toContain('showMainFeedLoadMoreControl');
  });

  it('keeps focus and unread styling on the same chat row binding', () => {
    expect(html).toMatch(/chat-post-focused[\s\S]*chat-post-unread/);
  });

  it('renders latest thread reply preview hooks in the main chat feed', () => {
    expect(html).toContain('getThreadReplierAvatars(msg.record_id)');
    expect(html).toContain('getLatestThreadReplyPreview(msg.record_id)');
    expect(html).toContain('chat-thread-latest-preview');
    expect(html).toContain('@click="$store.chat.openThread(msg.record_id)"');
  });

  it('renders the PG work context bar first in status, tasks, docs, and files', () => {
    const statusSectionIndex = html.indexOf('class="status-section"');
    const statusContextIndex = html.indexOf('class="pg-work-context-bar"', statusSectionIndex);
    const statusSummaryIndex = html.indexOf('data-testid="flightdeck-summary-overview"', statusSectionIndex);
    const taskSectionIndex = html.indexOf('class="tasks-section"');
    const taskContextIndex = html.indexOf('class="pg-work-context-bar"', taskSectionIndex);
    const taskCreateIndex = html.indexOf('class="task-create-bar"', taskSectionIndex);
    const docsViewIndex = html.indexOf('class="docs-view"');
    const docsContextIndex = html.indexOf('class="pg-work-context-bar"', docsViewIndex);
    const docsToolbarIndex = html.indexOf('class="docs-toolbar"', docsViewIndex);
    const filesSectionIndex = html.indexOf('class="files-section"');
    const filesContextIndex = html.indexOf('class="pg-work-context-bar files-work-context-bar"', filesSectionIndex);
    const filesHeaderIndex = html.indexOf('class="files-header"', filesSectionIndex);

    expect(statusContextIndex).toBeGreaterThan(statusSectionIndex);
    expect(statusContextIndex).toBeLessThan(statusSummaryIndex);
    expect(taskContextIndex).toBeGreaterThan(taskSectionIndex);
    expect(taskContextIndex).toBeLessThan(taskCreateIndex);
    expect(docsContextIndex).toBeGreaterThan(docsViewIndex);
    expect(docsContextIndex).toBeLessThan(docsToolbarIndex);
    expect(filesContextIndex).toBeGreaterThan(filesSectionIndex);
    expect(filesContextIndex).toBeLessThan(filesHeaderIndex);
    expect(html.match(/class="pg-work-context-bar/g) || []).toHaveLength(4);
  });

  it('renders the channel settings menu in every PG work context bar', () => {
    const contextBars = html.match(/<div class="pg-work-context-bar[\s\S]*?<div class="pg-context-thread-strip"/g) || [];

    expect(contextBars).toHaveLength(4);
    for (const contextBar of contextBars) {
      expect(contextBar).toContain('class="chat-channel-menu chat-channel-tab-menu"');
      expect(contextBar).toContain('@click.stop.prevent="$store.chat.openChannelSettings(channel.record_id)"');
    }
  });

  it('renders the fullscreen header toggle in the shared PG channel bar', () => {
    const globalBarIndex = html.indexOf('class="global-pg-channel-bar"');
    const globalBarEndIndex = html.indexOf('<template x-if="$store.chat.navSection === \'status\'">', globalBarIndex);
    const globalBar = html.slice(globalBarIndex, globalBarEndIndex);

    expect(globalBarIndex).toBeGreaterThan(-1);
    expect(globalBar).toContain('class="chat-channel-header-icon-btn"');
    expect(globalBar).toContain('@click="$store.chat.toggleAppHeaderHidden()"');
    expect(globalBar).toContain(":title=\"$store.chat.appHeaderHidden ? 'Show header' : 'Full screen'\"");
  });

  it('renders an all-scopes home tab before shared PG channel tabs', () => {
    const globalBarIndex = html.indexOf('class="global-pg-channel-bar"');
    const globalBarEndIndex = html.indexOf('<template x-if="$store.chat.navSection === \'status\'">', globalBarIndex);
    const globalBar = html.slice(globalBarIndex, globalBarEndIndex);
    const avatarIndex = globalBar.indexOf('class="channel-row-workspace-avatar-btn"');
    const scopeSwitcherIndex = globalBar.indexOf('class="channel-row-scope-switcher"');
    const homeIndex = globalBar.indexOf('class="chat-channel-tab-item channel-home-tab-item"');
    const channelLoopIndex = globalBar.indexOf('<template x-for="channel in $store.chat.pgContextChannels"');

    expect(avatarIndex).toBeGreaterThan(-1);
    expect(scopeSwitcherIndex).toBeGreaterThan(-1);
    expect(avatarIndex).toBeLessThan(scopeSwitcherIndex);
    expect(homeIndex).toBeGreaterThan(-1);
    expect(homeIndex).toBeLessThan(channelLoopIndex);
    expect(globalBar).toContain("pg-all-scopes-context");
    expect(globalBar).toContain('@click="$store.chat.openAllScopesOverview()"');
    expect(globalBar).toContain('currentWorkspaceAvatarUrl');
    expect(globalBar).toContain('currentWorkspaceInitials');
    expect(globalBar).toContain(':class="{ active: $store.chat.pgContextAllScopesSelected }"');
  });

  it('uses the same PG context controls in the chat channel bar', () => {
    const chatBarIndex = html.indexOf('aria-label="Chat channels"');
    const chatBarEndIndex = html.indexOf('<div class="chat-layout"', chatBarIndex);
    const chatBar = html.slice(chatBarIndex, chatBarEndIndex);
    const avatarIndex = chatBar.indexOf('class="channel-row-workspace-avatar-btn"');
    const scopeSwitcherIndex = chatBar.indexOf('class="channel-row-scope-switcher"');
    const homeIndex = chatBar.indexOf('class="chat-channel-tab-item channel-home-tab-item"');
    const channelLoopIndex = chatBar.indexOf('<template x-for="ch in $store.chat.pgContextChannels"');

    expect(chatBarIndex).toBeGreaterThan(-1);
    expect(avatarIndex).toBeGreaterThan(-1);
    expect(scopeSwitcherIndex).toBeGreaterThan(-1);
    expect(avatarIndex).toBeLessThan(scopeSwitcherIndex);
    expect(homeIndex).toBeGreaterThan(-1);
    expect(homeIndex).toBeLessThan(channelLoopIndex);
    expect(chatBar).toContain('@click="$store.chat.openAllScopesOverview()"');
    expect(chatBar).toContain('currentWorkspaceAvatarUrl');
    expect(chatBar).toContain('active: $store.chat.pgContextSelectedChannelId === ch.record_id');
    expect(chatBar).toContain(':aria-selected="$store.chat.pgContextSelectedChannelId === ch.record_id"');
    expect(chatBar).not.toContain('scopeFilteredChannels');
  });

  it('keeps channel tabs text-only while labels resolve through getChannelLabel', () => {
    expect(html).not.toContain('class="chat-channel-avatar"');
    expect(html).not.toContain('getChannelDmPeerNpub');
    expect(html.match(/getChannelLabel/g)?.length || 0).toBeGreaterThanOrEqual(5);
  });

  it('resolves profile identities in channel access rows', () => {
    expect(html).toContain('getPgChannelGrantPrincipalNpub(grant)');
    expect(html).toContain('getPgChannelGrantPrincipalLabel(grant)');
  });

  it('adds Get it done actions to every chat message surface', () => {
    const matches = html.match(/Get it done/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-chat-get-it-done="true"');
    expect(html).toContain('data-source-surface="main_feed"');
    expect(html).toContain('data-source-surface="thread_parent"');
    expect(html).toContain('data-source-surface="thread_reply"');
  });

  it('renders the chat Get it done modal hooks', () => {
    expect(html).toContain('data-testid="chat-get-it-done-modal"');
    expect(html).toContain('data-testid="chat-get-it-done-title"');
    expect(html).toContain('data-testid="chat-get-it-done-assignee"');
    expect(html).toContain('chatGetItDoneAssigneeSuggestions');
    expect(html).toContain('selectChatGetItDoneAssignee');
    expect(html).toContain('data-testid="chat-get-it-done-output-type"');
    expect(html).toContain('data-testid="chat-get-it-done-scope"');
    expect(html).toContain('chatGetItDoneScopeSuggestions');
    expect(html).toContain('selectChatGetItDoneScope');
    expect(html).toContain('data-testid="chat-get-it-done-submit"');
  });

  it('renders the dedicated chat-thread dispatch modal hooks', () => {
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-modal"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-flow-select"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-scope-select"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-launch-notes"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-preview"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-regenerate"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-stale-warning"');
    expect(html).toContain('data-testid="chat-thread-flow-dispatch-submit"');
    expect(html).toContain('<dt>Clicked message</dt>');
    expect(html).toContain('<dt>Canonical thread</dt>');
    expect(html).toContain('<dt>Thread messages</dt>');
    expect(html).toContain('<dt>Source surface</dt>');
  });
});
