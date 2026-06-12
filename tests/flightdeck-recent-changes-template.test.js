import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('flight deck attention feed template', () => {
  it('labels the attention panel and renders grouped attention cards', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<h3>Needs Attention</h3>');
    expect(html).toContain('x-text="$store.chat.attentionFeedSummary"');
    expect(html).toContain('x-for="group in $store.chat.attentionFeedGroups"');
    expect(html).toContain('x-for="item in group.items"');
    expect(html).toContain('@click="$store.chat.openAttentionItem(item)"');
    expect(html).toContain('@change="$store.chat.refreshStatusRecentChanges({ force: true })"');
  });

  it('renders recent scope shortcuts under the Flight Deck scope selector', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const statusIndex = html.indexOf('navSection === \'status\'');
    const tasksIndex = html.indexOf('<!-- ═══ TASKS SECTION ═══ -->');
    const scopeInputIndex = html.indexOf('id="flightdeck-scope-select"');
    const scopeRowCloseIndex = html.indexOf('</div>\n            <template x-if="$store.chat.recentFocusAreas.length > 0">', scopeInputIndex);
    const focusIndex = html.indexOf('class="focus-areas-panel flightdeck-focus-areas"');

    expect(statusIndex).toBeGreaterThan(-1);
    expect(scopeInputIndex).toBeGreaterThan(statusIndex);
    expect(scopeRowCloseIndex).toBeGreaterThan(scopeInputIndex);
    expect(focusIndex).toBeGreaterThan(statusIndex);
    expect(focusIndex).toBeGreaterThan(scopeRowCloseIndex);
    expect(focusIndex).toBeLessThan(tasksIndex);
    expect(html).not.toContain('class="focus-areas-heading"');
    expect(html).not.toContain('>Focus Areas<');
    expect(html).toContain('aria-label="Recent scope shortcuts"');
    expect(html).toContain('x-for="area in $store.chat.recentFocusAreas"');
    expect(html).toContain('@click="$store.chat.selectBoard(area.id)"');
  });

  it('uses the side column for timing instead of duplicating approvals', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<h3>Timing</h3>');
    expect(html).toContain('x-show="$store.chat.statusTimingFeed.upcoming.length > 0"');
    expect(html).toContain('x-show="$store.chat.statusTimingFeed.justGone.length > 0"');
    expect(html).toContain('@click="$store.chat.openTimingItem(item)"');
    expect(html).not.toContain('class="flightdeck-side-panel flightdeck-approvals-panel"');
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

    expect(html).toContain('class="chat-channel-header" x-show="$store.chat.navSection === \'chat\'"');
    expect(html).toContain('class="chat-channel-tab-item"');
    expect(html).toContain('class="chat-channel-tab-scroll" role="tablist" aria-label="Chat channels"');
    expect(html).toContain('class="chat-channel-tab"');
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
