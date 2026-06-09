import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { commandPaletteMixin, createCommandPaletteState } from '../src/command-palette.js';
import { ALL_TASK_BOARD_ID } from '../src/task-board-state.js';

const indexPath = path.resolve(import.meta.dirname, '..', 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf-8');
const stylesPath = path.resolve(import.meta.dirname, '..', 'src', 'styles.css');
const stylesSource = fs.readFileSync(stylesPath, 'utf-8');
const originalWindow = globalThis.window;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
});

function stubWindow(windowMock) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowMock,
  });
}

function applyPalette(store) {
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(commandPaletteMixin));
  return store;
}

function createStore(overrides = {}) {
  return applyPalette({
    ...createCommandPaletteState(),
    isLoggedIn: true,
    selectedBoardId: null,
    selectedBoardScope: null,
    scopes: [],
    scopesMap: new Map(),
    selectedBoardLabel: 'Scope board',
    channels: [],
    documents: [],
    session: { npub: 'npub-me' },
    workspaceOwnerNpub: 'npub-owner',
    botNpub: 'npub-bot',
    defaultAgentNpub: 'npub-agent',
    commandPaletteIndex: [],
    navSection: 'status',
    getChannelLabel: (channel) => channel.title || channel.label || channel.record_id,
    getSenderName: (npub) => (npub === 'npub-agent' ? 'wm21' : npub),
    getScopeBreadcrumb: (scopeId) => `Business > ${scopeId}`,
    scopeLevelLabel: (level) => String(level || '').toUpperCase(),
    getTaskBoardLabel: (record) => `Scope ${record.scope_id}`,
    getFlightDeckReportTypeLabel: () => 'Report',
    getReportMetricLabel: () => 'Metric',
    refreshCommandPaletteIndex: vi.fn(async () => {}),
    refreshScopes: vi.fn(async () => {}),
    refreshTasks: vi.fn(async () => {}),
    refreshChannels: vi.fn(async () => {}),
    refreshDocuments: vi.fn(async () => {}),
    refreshDirectories: vi.fn(async () => {}),
    refreshFlows: vi.fn(async () => {}),
    refreshApprovals: vi.fn(async () => {}),
    refreshReports: vi.fn(async () => {}),
    persistSelectedBoardId: vi.fn(),
    validateSelectedBoardId: vi.fn(),
    normalizeTaskFilterTags: vi.fn(),
    clearSelectedTasks: vi.fn(),
    closeTaskDetail: vi.fn(async () => {}),
    closeDocEditor: vi.fn(),
    navigateTo: vi.fn(),
    openTaskDetail: vi.fn(),
    openDoc: vi.fn(),
    navigateToFolder: vi.fn(),
    selectChannel: vi.fn(async () => {}),
    openThread: vi.fn(),
    openFlowEditor: vi.fn(),
    openReportModalById: vi.fn(),
    syncRoute: vi.fn(),
    openNewChannelModal: vi.fn(),
    createBotDm: vi.fn(async () => {}),
    createDocument: vi.fn(async () => {}),
    addTask: vi.fn(async () => ({ record_id: 'task-new' })),
    buildTaskBoardAssignment: vi.fn((scopeId) => ({ scope_id: scopeId, group_ids: ['group-default'] })),
    handleInlineImagePaste: vi.fn(async () => {}),
    containsInlineImageUploadToken: vi.fn((value) => String(value || '').includes('[ Uploading image')),
    $nextTick: (fn) => fn(),
    ...overrides,
  });
}

describe('command palette launchers', () => {
  it('opens from the Flight Deck logo instead of routing the logo directly', () => {
    expect(indexSource).toContain("@click=\"if ($store.chat.isLoggedIn) $store.chat.openCommandPalette()\"");
    expect(indexSource).not.toContain('mobile-radar');
  });

  it('renders quick launch items as compact favorites with icon shortcut labels', () => {
    expect(indexSource).toContain('command-palette-results-quick');
    expect(indexSource).toContain('command-palette-group-quick');
    expect(indexSource).toContain('command-palette-result-icon-svg');
    expect(indexSource).toContain('getCommandPaletteIconSvg(item.icon || item.group)');
    expect(indexSource).toContain('command-palette-result-icon-key');
    expect(indexSource).not.toContain('command-palette-result-key');
    expect(stylesSource).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(stylesSource).toContain('.command-palette-group-quick .command-palette-result-icon-key');
    expect(stylesSource).not.toContain('min-height: 9.25rem;');
  });

  it('renders a compact visual shortcut overlay near the top right', () => {
    expect(indexSource).toContain('showCommandPaletteShortcutOverlay && !$store.chat.showCommandPalette');
    expect(indexSource).toContain('commandPaletteShortcutOverlayItems');
    expect(indexSource).toContain('Command palette shortcuts');
    expect(stylesSource).toContain('.command-shortcut-overlay');
    expect(stylesSource).toContain('top: 0.85rem;');
    expect(stylesSource).toContain('right: 0.85rem;');
  });

  it('uses SVG icons for command palette items', () => {
    const store = createStore();

    expect(store.getCommandPaletteIconSvg('bot')).toContain('<svg');
    expect(store.getCommandPaletteIconSvg('bot')).toContain('<rect');
    expect(store.getCommandPaletteIconSvg('missing')).toContain('<path d="M9 18l6-6-6-6">');
  });

  it('renders a two-line New Work description field with image paste handling', () => {
    expect(indexSource).toContain('x-model="$store.chat.commandPaletteNewWorkDescription"');
    expect(indexSource).toContain('rows="2"');
    expect(indexSource).toContain('@paste="$store.chat.handleCommandPaletteNewWorkDescriptionPaste($event)"');
  });

  it('registers Command/Super+J to open the palette in capture phase', () => {
    let handler = null;
    const windowMock = {
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    };
    stubWindow(windowMock);
    const openCommandPalette = vi.fn();
    const store = createStore();
    store.openCommandPalette = openCommandPalette;

    store.initCommandPaletteShortcuts();
    handler({
      key: 'j',
      code: 'KeyJ',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });

    expect(windowMock.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('keeps Command/Super+K as a best-effort shortcut', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('supports Ctrl+Shift+K as a fallback shortcut', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'TEXTAREA' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('supports Ctrl+J inside editable fields', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'j',
      code: 'KeyJ',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('does not open for plain K in editable fields', () => {
    let handler = null;
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault: vi.fn(),
    });

    expect(store.openCommandPalette).not.toHaveBeenCalled();
  });

  it('shows the visual shortcut overlay after holding Super for about two seconds', () => {
    const handlers = {};
    let scheduledTimer = null;
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        handlers[eventName] = callback;
      }),
      setTimeout: vi.fn((callback, delay) => {
        scheduledTimer = { callback, delay };
        return 7;
      }),
      clearTimeout: vi.fn((timer) => clearTimeout(timer)),
    });
    const store = createStore();

    store.initCommandPaletteShortcuts();
    handlers.keydown({
      key: 'Meta',
      code: 'MetaLeft',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });

    expect(scheduledTimer.delay).toBe(2000);
    expect(store.showCommandPaletteShortcutOverlay).toBe(false);
    scheduledTimer.callback();
    expect(store.showCommandPaletteShortcutOverlay).toBe(true);
  });

  it('cancels the visual shortcut overlay when Super is released before the hold delay', () => {
    const handlers = {};
    let scheduledTimer = null;
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        handlers[eventName] = callback;
      }),
      setTimeout: vi.fn((callback, delay) => {
        scheduledTimer = { callback, delay };
        return 7;
      }),
      clearTimeout: vi.fn((timer) => clearTimeout(timer)),
    });
    const store = createStore();

    store.initCommandPaletteShortcuts();
    handlers.keydown({
      key: 'Meta',
      code: 'MetaLeft',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });
    handlers.keyup({
      key: 'Meta',
      code: 'MetaLeft',
    });
    scheduledTimer.callback();

    expect(store.showCommandPaletteShortcutOverlay).toBe(false);
  });

  it('dismisses the visual shortcut overlay on blur', () => {
    const handlers = {};
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        handlers[eventName] = callback;
      }),
    });
    const store = createStore({ showCommandPaletteShortcutOverlay: true });

    store.initCommandPaletteShortcuts();
    handlers.blur();

    expect(store.showCommandPaletteShortcutOverlay).toBe(false);
  });

  it('hides the visual shortcut overlay when the palette opens from Super+K', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore({ showCommandPaletteShortcutOverlay: true });
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.showCommandPaletteShortcutOverlay).toBe(false);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('executes quick launch items with number keys while the palette is open', async () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore({ showCommandPalette: true });
    store.executeCommandPaletteItem = vi.fn(async () => {});

    store.initCommandPaletteShortcuts();
    handler({
      key: '2',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.executeCommandPaletteItem).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Chat',
      shortcutKey: '2',
    }));
  });
});

describe('command palette defaults and search', () => {
  it('keeps the four quick launch favorites first before typing', () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    const titles = store.commandPaletteFlatResults.map((item) => item.title);

    expect(titles.slice(0, 4)).toEqual(["What's on", 'Chat', 'New Work', 'Quick Doc']);
    expect(store.commandPaletteFlatResults.slice(0, 4).map((item) => item.shortcutKey)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps visual shortcut overlay labels aligned with quick launch actions', () => {
    const store = createStore();

    expect(store.commandPaletteShortcutOverlayItems).toEqual([
      { id: 'palette', keys: ['Super', 'K'], label: 'Palette' },
      { id: 'quick:whats-on', keys: ['Palette', '1'], label: 'Flight Deck all scopes' },
      { id: 'quick:chat-primary-agent', keys: ['Palette', '2'], label: 'Chat to your Agent' },
      { id: 'quick:new-work', keys: ['Palette', '3'], label: 'Quick Task / New Work' },
      { id: 'quick:quick-doc', keys: ['Palette', '4'], label: 'Quick Doc' },
    ]);
  });

  it('shows the six most recent indexed records below quick launch before typing', () => {
    const store = createStore();
    store.commandPaletteIndex = Array.from({ length: 7 }, (_, index) => ({
      id: `task:${index}`,
      group: 'task',
      groupLabel: 'Tasks',
      title: `Task ${index}`,
      action: 'open-task',
      recordId: `task-${index}`,
      updatedTs: Date.parse(`2026-05-0${index + 1}T00:00:00Z`),
    }));

    expect(store.commandPaletteFlatResults.map((item) => item.title)).toEqual([
      "What's on",
      'Chat',
      'New Work',
      'Quick Doc',
      'Task 6',
      'Task 5',
      'Task 4',
      'Task 3',
      'Task 2',
      'Task 1',
    ]);
    expect(store.commandPaletteGroups.map((group) => group.label)).toEqual(['Shortcuts', 'Recent']);
  });

  it('groups searched enabled records and omits disabled surface results', () => {
    const store = createStore();
    store.commandPaletteIndex = store.buildCommandPaletteIndex({
      scopes: [{ record_id: 'scope-a', title: 'Apollo scope', level: 'l2', updated_at: '2026-05-05T00:00:00Z' }],
      directories: [{ record_id: 'dir-a', title: 'Apollo folder', updated_at: '2026-05-05T00:00:00Z' }],
      documents: [{ record_id: 'doc-a', title: 'Apollo plan', content: 'orbit', updated_at: '2026-05-05T00:00:00Z' }],
      tasks: [{ record_id: 'task-a', title: 'Apollo task', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      channels: [{ record_id: 'chan-a', title: 'Apollo chat', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      messages: [
        { record_id: 'msg-root', channel_id: 'chan-a', body: 'Apollo thread', updated_at: '2026-05-05T00:00:00Z' },
        { record_id: 'msg-reply', channel_id: 'chan-a', parent_message_id: 'msg-root', body: 'Reply', updated_at: '2026-05-05T00:00:00Z' },
      ],
      flows: [{ record_id: 'flow-a', title: 'Apollo flow', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      approvals: [{ record_id: 'approval-a', title: 'Apollo approval', status: 'pending', updated_at: '2026-05-05T00:00:00Z' }],
      reports: [{ record_id: 'report-a', title: 'Apollo metric', updated_at: '2026-05-05T00:00:00Z' }],
    });
    store.commandPaletteQuery = 'apollo';

    const groupLabels = store.commandPaletteGroups.map((group) => group.label);

    expect(groupLabels).toEqual([
      'Scopes',
      'Docs',
      'Tasks',
      'Chat channels',
      'Chat threads',
    ]);
    expect(groupLabels).not.toEqual(expect.arrayContaining(['Flows', 'Approvals', 'Flight Deck']));
  });
});

describe('command palette actions', () => {
  it('selects a scope and stays on the current Flight Deck surface', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'select-scope',
      recordId: 'scope-a',
      scopeId: 'scope-a',
      title: 'Apollo',
    });

    expect(store.refreshScopes).toHaveBeenCalledTimes(1);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.persistSelectedBoardId).toHaveBeenCalledWith('scope-a');
    expect(store.navigateTo).toHaveBeenCalledWith('status', { syncRoute: false });
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('selects a scope from tasks and stays on the task board', async () => {
    const store = createStore({
      navSection: 'tasks',
      showTaskDetail: true,
    });

    await store.runCommandPaletteAction({
      action: 'select-scope',
      recordId: 'scope-a',
      scopeId: 'scope-a',
      title: 'Marketing',
    });

    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.clearSelectedTasks).toHaveBeenCalledTimes(1);
    expect(store.closeTaskDetail).toHaveBeenCalledWith({ syncRoute: false });
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('selects a scope from docs and stays on scoped docs', async () => {
    const store = createStore({
      navSection: 'docs',
      currentFolderId: 'folder-old',
    });

    await store.runCommandPaletteAction({
      action: 'select-scope',
      recordId: 'scope-a',
      scopeId: 'scope-a',
      title: 'Marketing',
    });

    expect(store.refreshDirectories).toHaveBeenCalledTimes(1);
    expect(store.refreshDocuments).toHaveBeenCalledTimes(1);
    expect(store.closeDocEditor).toHaveBeenCalledWith({ syncRoute: false });
    expect(store.currentFolderId).toBeNull();
    expect(store.navigateTo).toHaveBeenCalledWith('docs', { syncRoute: false });
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('opens or creates a DM with the configured primary agent', async () => {
    const store = createStore({
      channels: [{
        record_id: 'chan-agent',
        participant_npubs: ['npub-me', 'npub-agent'],
      }],
    });

    await store.runCommandPaletteAction({ action: 'primary-agent-chat' });

    expect(store.refreshChannels).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).toHaveBeenCalledWith('chat', { syncRoute: false });
    expect(store.selectChannel).toHaveBeenCalledWith('chan-agent');
    expect(store.createBotDm).not.toHaveBeenCalled();
  });

  it('creates a quick doc in the resolved default scope', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    await store.runCommandPaletteAction({ action: 'quick-doc' });

    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.refreshDirectories).toHaveBeenCalledTimes(1);
    expect(store.refreshDocuments).toHaveBeenCalledTimes(1);
    expect(store.createDocument).toHaveBeenCalledWith('Untitled document', { scopeId: 'scope-a' });
  });

  it('opens a New Work modal and creates a scoped task through the existing task path', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    store.commandPaletteNewWorkTitle = 'Draft launch checklist';
    store.commandPaletteNewWorkDescription = 'Use the notes from today.';
    await store.createCommandPaletteNewWork();

    expect(store.showCommandPaletteNewWorkModal).toBe(false);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.newTaskTitle).toBe('Draft launch checklist');
    expect(store.addTask).toHaveBeenCalledWith({ description: 'Use the notes from today.' });
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.openTaskDetail).toHaveBeenCalledWith('task-new');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('pastes images into the New Work description with the selected board groups', async () => {
    const pasteEvent = { type: 'paste' };
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo', group_ids: ['group-scope'] }]]),
      buildTaskBoardAssignment: vi.fn(() => ({ scope_id: 'scope-a', group_ids: ['group-board'] })),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    await store.handleCommandPaletteNewWorkDescriptionPaste(pasteEvent);

    expect(store.handleInlineImagePaste).toHaveBeenCalledWith(pasteEvent, {
      modelKey: 'commandPaletteNewWorkDescription',
      ownerNpub: 'npub-owner',
      accessGroupIds: ['group-board'],
      fileLabel: 'task',
    });
  });

  it('uses the configured default New Work board while keeping the modal board selectable', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      commandPaletteNewWorkDefaultScopeId: 'scope-b',
      scopesMap: new Map([
        ['scope-a', { record_id: 'scope-a', title: 'Apollo' }],
        ['scope-b', { record_id: 'scope-b', title: 'Pete Scratch' }],
      ]),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    expect(store.commandPaletteNewWorkScopeId).toBe('scope-b');

    store.commandPaletteNewWorkScopeId = 'scope-a';
    store.commandPaletteNewWorkTitle = 'Override board';
    await store.createCommandPaletteNewWork();

    expect(store.selectedBoardId).toBe('scope-a');
  });

  it('routes all-scope task board shortcuts through the all board', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'all-tasks',
      scopeId: ALL_TASK_BOARD_ID,
    });

    expect(store.selectedBoardId).toBe(ALL_TASK_BOARD_ID);
    expect(store.refreshScopes).not.toHaveBeenCalled();
    expect(store.navigateTo).toHaveBeenCalledWith('tasks');
  });

  it('opens scoped records after applying their scope context', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'open-task',
      recordId: 'task-a',
      scopeId: 'scope-a',
    });

    expect(store.refreshScopes).toHaveBeenCalledTimes(1);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.refreshTasks).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.openTaskDetail).toHaveBeenCalledWith('task-a');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });
});
