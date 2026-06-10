import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('settings admin gating template', () => {
  it('hides admin-only settings tabs and panes behind canAdminWorkspace', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'workspace\' }"');
    expect(html).toContain('x-show="false" x-cloak class="settings-tab" :class="{ active: $store.chat.settingsTab === \'schedules\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'scopes\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'sharing\' }"');
    expect(html).toContain('Groups &amp; Members');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'workspace\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="false">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'scopes\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'sharing\'">');
  });

  it('hides advanced settings tabs behind the workspace advanced checkbox', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('x-show="false" x-cloak class="settings-tab" :class="{ active: $store.chat.settingsTab === \'flows\' }"');
    expect(html).toContain('x-show="$store.chat.workspaceAdvancedOptionsEnabled" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'data\' }"');
    expect(html).toContain('>Sync</button>');
    expect(html).toContain('<div class="settings-tab-content" x-show="false">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.workspaceAdvancedOptionsEnabled && $store.chat.settingsTab === \'data\'">');
    expect(html).toContain('id="workspace-advanced-options-input"');
  });

  it('hides scope management controls behind canAdminWorkspace', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<div class="scope-create-bar" x-show="$store.chat.canAdminWorkspace">');
    expect(html).toContain('<div class="scope-card-actions" x-show="$store.chat.canAdminWorkspace && !$store.chat.isTowerPgMode">');
  });

  it('keeps preset connect panel expressions null-safe', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const panelStart = html.indexOf('class="preset-connect-panel"');
    const panelEnd = html.indexOf('<form class="auth-form"', panelStart);
    const panel = html.slice(panelStart, panelEnd);

    expect(panel).toContain('$store.chat.presetConnectHost?.url');
    expect(panel).toContain('$store.chat.presetConnectHost?.towerName');
    expect(panel).not.toMatch(/presetConnectHost\.(url|towerName|label)/);
  });
});
