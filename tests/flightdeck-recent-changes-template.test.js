import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('flight deck summary template', () => {
  it('renders the summary overview on the Flight Deck home page', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    const statusIndex = html.indexOf('navSection === \'status\'');
    const summaryIndex = html.indexOf('data-testid="flightdeck-summary-overview"', statusIndex);

    expect(summaryIndex).toBeGreaterThan(statusIndex);
    expect(html).toContain('Welcome <span x-text="$store.chat.greetingName"></span>, where will we focus today?');
    expect(html).toContain('x-text="$store.chat.autopilotOverviewContextLabel"');
    expect(html).toContain('class="my-agents-panel" aria-label="My Agents"');
    expect(html).toContain('<h3>My Agents</h3>');
    expect(html).toContain('class="autopilot-agent-launcher"');
    expect(html).toContain('Dive Deeper in Autopilot');
    expect(html).toContain('class="autopilot-agent-avatar-ring"');
    expect(html).toContain('x-text="$store.chat.harnessAgentLabel || \'Autopilot agent\'"');
    expect(html).not.toContain('aria-label="Open Autopilot">Open Autopilot</button>');
    expect(html).not.toContain('class="autopilot-overview-greeting"');
    expect(html).not.toContain('x-text="$store.chat.autopilotOverviewGreeting"');
    expect(html).toContain('data-testid="flightdeck-summary-daily-scope"');
    expect(html).toContain('data-testid="flightdeck-summary-threads"');
    expect(html).toContain('data-testid="flightdeck-summary-tasks"');
    expect(html).toContain('data-testid="flightdeck-summary-documents"');
    expect(html).toContain('data-testid="flightdeck-summary-files"');
  });

  it('uses attention card styles for summary rows', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('class="attention-card flightdeck-summary-card flightdeck-summary-card-chat"');
    expect(html).toContain('class="attention-card flightdeck-summary-card flightdeck-summary-card-task"');
    expect(html).toContain('class="attention-card flightdeck-summary-card flightdeck-summary-card-doc"');
    expect(html).toContain('class="attention-card flightdeck-summary-card flightdeck-summary-card-file"');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'chat\')"');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'task\')"');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'doc\')"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewThread(thread)"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewTask(task)"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewDocument(doc)"');
    expect(html).toContain('@click="$store.chat.openFileBrowserSource(file)"');
  });

  it('configures Autopilot as an agent plus URL instead of a bare launcher button', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('id="wingman-harness-agent-input"');
    expect(html).toContain('x-model="$store.chat.wingmanHarnessAgentQuery"');
    expect(html).toContain('@input="$store.chat.handleHarnessAgentInput($event.target.value)"');
    expect(html).toContain('x-show="$store.chat.harnessAgentSuggestions.length > 0"');
    expect(html).toContain('@click="$store.chat.selectHarnessAgent(person.npub)"');
    expect(html).toContain('id="wingman-harness-input"');
    expect(html).toContain('Test link');
  });

  it('does not expose the removed calendar surface', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('calendar')");
    expect(html).not.toContain("navSection === 'calendar'");
    expect(html).not.toContain('<span class="sidebar-label">Calendar</span>');
  });

  it('keeps schedules hidden while the surface is disabled', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('schedules')");
    expect(html).not.toContain("navSection === 'schedules'");
    expect(html).not.toContain('<span class="sidebar-label">Schedules</span>');
    expect(html).toContain('x-show="false" x-cloak class="settings-tab" :class="{ active: $store.chat.settingsTab === \'schedules\' }"');
  });

  it('moves scopes into settings instead of exposing a top-level section', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('scopes')");
    expect(html).not.toContain("navSection === 'scopes'");
    expect(html).not.toContain('<span class="sidebar-label">Scopes</span>');
    expect(html).toContain("settingsTab === 'scopes'");
  });

  it('keeps flows hidden while the surface is disabled', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('flows')");
    expect(html).not.toContain("navSection === 'flows'");
    expect(html).not.toContain('<span class="sidebar-label">Flows</span>');
    expect(html).not.toContain('$store.chat.settingsTab === \'flows\'');
  });

  it('labels setup without changing the settings route', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('@click="$store.chat.navigateTo(\'settings\')">Setup</button>');
    expect(html).toContain('<span class="sidebar-label">Setup</span>');
    expect(html).not.toContain('<span class="sidebar-label">Settings</span>');
  });

  it('hides people and opportunities in the sidebar', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain('$store.chat.navSection === \'people\'');
    expect(html).not.toContain('$store.chat.navSection === \'opportunities\'');
  });

  it('exposes files as a top-level sidebar section', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain("navigateTo('files')");
    expect(html).toContain("navSection === 'files'");
    expect(html).toContain('<span class="sidebar-label">Files</span>');
    expect(html).toContain('class="files-section"');
    expect(html).toContain('x-for="row in $store.chat.filteredFileBrowserRows"');
  });

  it('keeps reports hidden from the sidebar and Flight Deck cards', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain('<span class="sidebar-label">Reports</span>');
    expect(html).toContain('<section class="flightdeck-reports-section" x-show="false" x-cloak>');
    expect(html).toContain('class="flightdeck-report-card flightdeck-report-card-link"');
  });

  it('renders chat channels as in-view tabs instead of sidebar rows', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('class="page-header" x-show="!$store.chat.appHeaderHidden"');
    expect(html).toContain('x-show="$store.chat.navSection === \'chat\'"');
    expect(html).toContain('class="chat-channel-tab-item"');
    expect(html).toContain('class="chat-channel-tab-scroll" role="tablist" aria-label="Chat channels"');
    expect(html).toContain('class="chat-channel-tab"');
    expect(html).toContain('class="chat-channel-header-icon-btn"');
    expect(html).toContain('@click="$store.chat.toggleAppHeaderHidden()"');
    expect(html).toContain('@click="$store.chat.openAllScopesOverview()"');
    expect(html).toContain('x-for="ch in $store.chat.pgContextChannels"');
    expect(html).toContain('active: $store.chat.pgContextSelectedChannelId === ch.record_id');
    expect(html).not.toContain('class="app-header-icon-btn"');
    expect(html).not.toContain('class="app-header-restore"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('@dragstart="$store.chat.startChannelTabDrag(ch.record_id, $event)"');
    expect(html).toContain('@drop.prevent="$store.chat.dropChannelTab(ch.record_id, $event)"');
    expect(html).toContain('class="chat-channel-menu chat-channel-tab-menu"');
    expect(html).toContain('class="chat-channel-menu-button"');
    expect(html).toContain('@click.stop.prevent="$store.chat.openChannelSettings()"');
    expect(html).not.toContain('class="chat-channel-tabs"');
    expect(html).not.toContain('class="sidebar-channels"');
    expect(html).not.toContain('class="sidebar-channel-item"');
  });
});
