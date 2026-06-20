import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');
const STYLES_PATH = resolve(process.cwd(), 'src/styles.css');

describe('flight deck summary template', () => {
  it('renders the summary overview on the Flight Deck home page', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    const statusIndex = html.indexOf('navSection === \'status\'');
    const summaryIndex = html.indexOf('data-testid="flightdeck-summary-overview"', statusIndex);

    expect(summaryIndex).toBeGreaterThan(statusIndex);
    expect(html).toContain('<h2 x-text="$store.chat.dashboardGreetingText"></h2>');
    expect(html).toContain('x-text="$store.chat.autopilotOverviewContextLabel"');
    expect(html).toContain('class="launcher-stack-panel my-agents-panel agents-stack-panel"');
    expect(html).toContain('aria-label="My WApps"');
    expect(html).toContain('<h3>My Agents</h3>');
    expect(html).toContain('class="launcher-pill autopilot-agent-launcher"');
    expect(html).toContain('class="agents-stack-hitbox"');
    expect(html).toContain('$store.chat.visiblePersonalAgents.length > 1');
    expect(html).toContain('$store.chat.personalAgentsOverlayOpen');
    expect(html).toContain('Dive Deeper in Autopilot');
    expect(html).toContain('class="launcher-avatar-ring autopilot-agent-avatar-ring"');
    expect(html).toContain('x-text="$store.chat.previewPersonalAgents[0]?.title || \'Autopilot agent\'"');
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
    expect(html).toContain('attention-card-new-dot');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'chat\')"');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'task\')"');
    expect(html).toContain('x-html="$store.chat.getAttentionIconSvg(\'doc\')"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewThread(thread)"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewTask(task)"');
    expect(html).toContain('@click="$store.chat.openAutopilotOverviewDocument(doc)"');
    expect(html).toContain('@click="$store.chat.openFileBrowserSource(file)"');
  });

  it('uses collapsible summary quadrant headings with updated labels', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const styles = readFileSync(STYLES_PATH, 'utf8');

    expect(html).toContain('class="summary-panel-heading-toggle"');
    expect(html).toContain('class="overview-panel-pager daily-note-date-pager"');
    expect(html).toContain('class="overview-panel-pager-all"');
    expect(html).toContain('>All</button>');
    expect(html).toContain("showPreviousSummaryPanelPage('chats')");
    expect(html).toContain("showNextSummaryPanelPage('files')");
    expect(html).toContain('$store.chat.pagedAutopilotOverviewThreads');
    expect(html).toContain('$store.chat.pagedAutopilotOverviewFiles');
    expect(html).toContain("'summary-panel-collapsed': $store.chat.isSummaryPanelCollapsed('chats')");
    expect(html).toContain("@click=\"$store.chat.toggleSummaryPanel('chats')\"");
    expect(html).toContain('<h3>Chats</h3>');
    expect(html).toContain('<h3>Docs</h3>');
    expect(html).not.toContain('<h3>Threads</h3>');
    expect(html).not.toContain('<h3>Docs and Comments</h3>');
    expect(styles).toMatch(/summary-panel-collapsed[\s\S]*min-height:\s*0;/);
    expect(styles).toMatch(/flightdeck-summary-header h2[\s\S]*white-space:\s*pre-line;/);
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
    expect(html).toContain('class="global-pg-channel-bar" x-show="$store.chat.isLoggedIn"');
    expect(html).toContain('class="content-scroll-area"');
    expect(html).toContain('class="chat-channel-tab-item"');
    expect(html).toContain('class="chat-channel-tab-scroll" role="tablist" aria-label="Workspace channels"');
    expect(html).toContain('class="chat-channel-tab"');
    expect(html).toContain('class="chat-channel-header-icon-btn"');
    expect(html).toContain('@click="$store.chat.toggleAppHeaderHidden()"');
    expect(html).toContain('@click="$store.chat.openAllScopesOverview()"');
    expect(html).toContain('@click="$store.chat.openPgScopeHome()"');
    expect(html).toContain('x-for="channel in $store.chat.pgContextChannels"');
    expect(html).toContain('active: $store.chat.pgContextSelectedChannelId === channel.record_id');
    expect(html).toContain("$store.chat.navSection === 'chat' ? $store.chat.selectChannel(channel.record_id) : $store.chat.selectPgChannelContext(channel.record_id)");
    expect(html).not.toContain('class="app-header-icon-btn"');
    expect(html).not.toContain('class="app-header-restore"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('@dragstart="$store.chat.startChannelTabDrag(channel.record_id, $event)"');
    expect(html).toContain('@drop.prevent="$store.chat.dropChannelTab(channel.record_id, $event)"');
    expect(html).toContain('class="chat-channel-menu chat-channel-tab-menu"');
    expect(html).toContain('class="chat-channel-menu-button"');
    expect(html).toContain('@click.stop.prevent="$store.chat.openChannelSettings(channel.record_id)"');
    expect(html).not.toContain('class="chat-channel-tabs"');
    expect(html).not.toContain('class="sidebar-channels"');
    expect(html).not.toContain('class="sidebar-channel-item"');
  });
});
