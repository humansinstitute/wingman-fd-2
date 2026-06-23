import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTowerPgScopeChannel: vi.fn(),
  createTowerPgWorkspaceScope: vi.fn(),
  updateTowerPgDoc: vi.fn(),
  hydrateTowerPgScopes: vi.fn(),
  mapPgChannelToLocal: vi.fn((channel = {}) => ({
    record_id: channel.id,
    title: channel.name,
    scope_id: channel.scope_id,
    metadata: channel.metadata || {},
    record_state: 'active',
  })),
  mapPgDocToLocal: vi.fn((doc = {}) => ({
    record_id: doc.id,
    pg_backend: true,
    scope_id: doc.scope_id,
    pg_channel_id: doc.channel_id,
    title: doc.title,
    version: doc.row_version,
  })),
  isTowerPgBackendMode: vi.fn(() => false),
  resolveTowerPgWorkspaceContext: vi.fn(() => ({
    workspaceId: 'workspace-1',
    baseUrl: 'https://tower.example',
    appNpub: 'flightdeck_pg',
  })),
}));

vi.mock('../src/api.js', () => ({
  createTowerPgScopeChannel: mocks.createTowerPgScopeChannel,
  createTowerPgWorkspaceScope: mocks.createTowerPgWorkspaceScope,
  updateTowerPgDoc: mocks.updateTowerPgDoc,
}));

vi.mock('../src/backend-mode.js', () => ({
  isTowerPgBackendMode: mocks.isTowerPgBackendMode,
}));

vi.mock('../src/pg-read-hydrator.js', () => ({
  hydrateTowerPgScopes: mocks.hydrateTowerPgScopes,
  mapPgChannelToLocal: mocks.mapPgChannelToLocal,
  mapPgDocToLocal: mocks.mapPgDocToLocal,
  resolveTowerPgWorkspaceContext: mocks.resolveTowerPgWorkspaceContext,
}));

import {
  getAvailableParents,
  readScopeAssignment,
  sameScopeAssignment,
  scopesManagerMixin,
} from '../src/scopes-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTowerPgWorkspaceScope.mockResolvedValue({ scope: { id: 'scope-1' } });
  mocks.createTowerPgScopeChannel.mockImplementation(async (_workspaceId, scopeId, body) => ({
    channel: {
      id: `channel-${String(body.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: body.name,
      scope_id: scopeId,
      metadata: body.metadata || {},
    },
  }));
  mocks.updateTowerPgDoc.mockResolvedValue({ doc: { id: 'doc-1' } });
  mocks.hydrateTowerPgScopes.mockResolvedValue([]);
  mocks.mapPgChannelToLocal.mockImplementation((channel = {}) => ({
    record_id: channel.id,
    title: channel.name,
    scope_id: channel.scope_id,
    metadata: channel.metadata || {},
    record_state: 'active',
  }));
  mocks.mapPgDocToLocal.mockImplementation((doc = {}) => ({
    record_id: doc.id,
    pg_backend: true,
    scope_id: doc.scope_id,
    pg_channel_id: doc.channel_id,
    title: doc.title,
    version: doc.row_version,
  }));
  mocks.isTowerPgBackendMode.mockReturnValue(false);
  mocks.resolveTowerPgWorkspaceContext.mockReturnValue({
    workspaceId: 'workspace-1',
    baseUrl: 'https://tower.example',
    appNpub: 'flightdeck_pg',
  });
});

function createScopeStore(overrides = {}) {
  const store = {
    scopePickerQuery: '',
    showScopePicker: false,
    showChannelScopePicker: false,
    showNewScopeForm: false,
    canAdminWorkspace: true,
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(scopesManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

describe('scopes-manager pure utilities', () => {
  it('reconciles the selected chat channel after scopes hydrate', async () => {
    const ensureSelectedChatChannelInScope = vi.fn();
    const store = createScopeStore({
      scopes: [],
      scopesLoaded: false,
      navSection: 'chat',
      normalizeScopeRowGroupRefs: (scope) => scope,
      ensureSelectedChatChannelInScope,
    });

    await store.applyScopes([{ record_id: 'scope-a', title: 'Scope A', level: 'l1' }]);

    expect(store.scopesLoaded).toBe(true);
    expect(ensureSelectedChatChannelInScope).toHaveBeenCalledWith({ syncRoute: false });
  });

  // --- getAvailableParents ---
  describe('getAvailableParents', () => {
    const scopes = [
      { record_id: 's1', level: 'product', title: 'Product A', record_state: 'active' },
      { record_id: 's2', level: 'product', title: 'Product B', record_state: 'deleted' },
      { record_id: 's3', level: 'project', title: 'Project X', record_state: 'active' },
      { record_id: 's4', level: 'project', title: 'Project Y', record_state: 'deleted' },
      { record_id: 's5', level: 'deliverable', title: 'Deliverable 1', record_state: 'active' },
    ];

    it('returns empty array for product level', () => {
      expect(getAvailableParents(scopes, 'product')).toEqual([]);
    });

    it('returns active products for project level', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s1');
    });

    it('excludes deleted products from project parents', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns active projects for deliverable level', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s3');
    });

    it('excludes deleted projects from deliverable parents', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns empty array for unknown level', () => {
      expect(getAvailableParents(scopes, 'unknown')).toEqual([]);
    });
  });

  // --- readScopeAssignment / sameScopeAssignment ---
  describe('scope assignment helpers', () => {
    it('normalizes missing scope fields to null', () => {
      expect(readScopeAssignment({})).toEqual({
        scope_id: null,
        scope_l1_id: null,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      });
    });

    it('reads scope assignment fields from a scoped record', () => {
      expect(readScopeAssignment({
        scope_id: 'scope-project',
        scope_l1_id: 'scope-product',
        scope_l2_id: 'scope-project',
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      })).toEqual({
        scope_id: 'scope-project',
        scope_l1_id: 'scope-product',
        scope_l2_id: 'scope-project',
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      });
    });

    it('detects equal scope assignments even across different record shapes', () => {
      expect(sameScopeAssignment(
        {
          scope_id: 'scope-project',
          scope_l1_id: 'scope-product',
          scope_l2_id: 'scope-project',
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
        },
        {
          record_id: 'doc-1',
          scope_id: 'scope-project',
          scope_l1_id: 'scope-product',
          scope_l2_id: 'scope-project',
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
        },
      )).toBe(true);
    });

    it('detects when scope assignments differ', () => {
      expect(sameScopeAssignment(
        { scope_id: 'scope-project', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project' },
        { scope_id: 'scope-deliverable', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project', scope_l3_id: 'scope-deliverable' },
      )).toBe(false);
    });
  });

  describe('scope picker state', () => {
    it('openScopePicker closes the channel scope picker', () => {
      const store = createScopeStore({
        scopePickerQuery: 'draft',
        showChannelScopePicker: true,
        showNewScopeForm: true,
      });

      store.openScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showScopePicker).toBe(true);
      expect(store.showChannelScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });

    it('openChannelScopePicker closes the task scope picker', () => {
      const store = createScopeStore({
        scopePickerQuery: 'draft',
        showScopePicker: true,
        showNewScopeForm: true,
      });

      store.openChannelScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showChannelScopePicker).toBe(true);
      expect(store.showScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });

    it('closeChannelScopePicker clears the shared query', () => {
      const store = createScopeStore({
        scopePickerQuery: 'ops',
        showChannelScopePicker: true,
        showNewScopeForm: true,
      });

      store.closeChannelScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showChannelScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });
  });

  describe('document scope assignment', () => {
    it('flushes pending document edits before moving the selected document scope', async () => {
      const timer = setTimeout(() => {}, 1000);
      const originalDoc = {
        record_id: 'doc-1',
        title: 'Draft',
        content: 'before',
        scope_id: 'scope-old',
        version: 1,
      };
      const savedDoc = {
        ...originalDoc,
        content: 'after',
        version: 2,
      };
      const saveSelectedDocItem = vi.fn(async function saveSelectedDocItem() {
        this.selectedDocument = savedDoc;
        this.documents = [savedDoc];
        return savedDoc;
      });
      const updateDocScope = vi.fn();
      const closeScopePicker = vi.fn();
      const store = createScopeStore({
        session: { npub: 'npub1user' },
        selectedDocType: 'document',
        selectedDocument: originalDoc,
        documents: [originalDoc],
        docsEditorOpen: true,
        docAutosaveState: 'pending',
        docAutosaveTimer: timer,
        saveSelectedDocItem,
        updateDocScope,
        closeScopePicker,
      });

      await store.selectScopeForDoc('scope-new');

      expect(store.docAutosaveTimer).toBeNull();
      expect(saveSelectedDocItem).toHaveBeenCalledWith({ autosave: true });
      expect(updateDocScope).toHaveBeenCalledWith(savedDoc, 'scope-new');
      expect(closeScopePicker).toHaveBeenCalled();
    });

    it('flushes pending document edits and closes the editor for docs context changes', async () => {
      const originalDoc = {
        record_id: 'doc-1',
        title: 'Draft',
        content: 'before',
        scope_id: 'scope-old',
        version: 1,
      };
      const savedDoc = {
        ...originalDoc,
        content: 'after',
        version: 2,
      };
      const saveSelectedDocItem = vi.fn(async function saveSelectedDocItem() {
        this.selectedDocument = savedDoc;
        this.documents = [savedDoc];
        return savedDoc;
      });
      const closeDocEditor = vi.fn();
      const syncRoute = vi.fn();
      const store = createScopeStore({
        selectedDocType: 'document',
        selectedDocument: originalDoc,
        documents: [originalDoc],
        docsEditorOpen: true,
        docAutosaveState: 'pending',
        saveSelectedDocItem,
        closeDocEditor,
        syncRoute,
      });

      const result = await store.resetOpenDocumentForContextChange(originalDoc);

      expect(result).toBe(savedDoc);
      expect(saveSelectedDocItem).toHaveBeenCalledWith({ autosave: true });
      expect(closeDocEditor).toHaveBeenCalledWith({ syncRoute: false });
      expect(syncRoute).toHaveBeenCalled();
    });
  });

  describe('Tower PG scope state', () => {
    it('forces new scopes to the top-level PG model', () => {
      mocks.isTowerPgBackendMode.mockReturnValue(true);
      const store = createScopeStore({
        scopeAssignableGroups: [{ groupId: 'group-1' }],
        scopesMap: new Map(),
        resolveGroupId(groupId) {
          return groupId || null;
        },
      });

      store.startNewScope('l4', 'legacy-parent');

      expect(store.newScopeLevel).toBe('l1');
      expect(store.newScopeParentId).toBe(null);
      expect(store.showNewScopeForm).toBe(true);
      expect(store.newScopeAssignedGroupIds).toEqual(['group-1']);
    });

    it('creates scopes through the Tower PG API instead of encrypted pending writes', async () => {
      mocks.isTowerPgBackendMode.mockReturnValue(true);
      const refreshScopes = vi.fn(async () => []);
      const flushAndBackgroundSync = vi.fn(async () => {});
      const store = createScopeStore({
        session: { npub: 'npub1pete' },
        newScopeTitle: 'Marketing',
        newScopeDescription: 'Top-level marketing work area',
        newScopeAssignedGroupIds: ['group-1'],
        resolveGroupId(groupId) {
          return groupId || null;
        },
        refreshScopes,
        flushAndBackgroundSync,
      });

      await store.addScope();

      expect(mocks.createTowerPgWorkspaceScope).toHaveBeenCalledWith('workspace-1', {
        name: 'Marketing',
        description: 'Top-level marketing work area',
        kind: 'project',
        owner_group_id: 'group-1',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(refreshScopes).toHaveBeenCalledTimes(1);
      expect(flushAndBackgroundSync).not.toHaveBeenCalled();
      expect(store.showNewScopeForm).toBe(false);
      expect(store.newScopeLevel).toBe('l1');
      expect(store.newScopeParentId).toBe(null);
    });

    it('creates Product template channels with rendered base prompts after creating a PG scope', async () => {
      mocks.isTowerPgBackendMode.mockReturnValue(true);
      const refreshScopes = vi.fn(async () => []);
      const store = createScopeStore({
        session: { npub: 'npub1pete' },
        channels: [],
        newScopeTitle: 'Product Score',
        newScopeDescription: '',
        newScopeAssignedGroupIds: ['group-1'],
        newScopeTemplateId: 'product',
        newScopeTemplateValues: {
          workingdir: '/Users/mini/code/product-score',
        },
        resolveGroupId(groupId) {
          return groupId || null;
        },
        refreshScopes,
      });

      await store.addScope();

      expect(mocks.createTowerPgWorkspaceScope).toHaveBeenCalledWith('workspace-1', {
        name: 'Product Score',
        description: 'Product scope for Product Score. Code/work directory: /Users/mini/code/product-score.',
        kind: 'project',
        owner_group_id: 'group-1',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledTimes(4);
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledWith('workspace-1', 'scope-1', expect.objectContaining({
        name: 'Features',
        metadata: {
          basePrompt: expect.stringContaining('feature work on the Product Score project'),
        },
        grants: [{
          principal_type: 'group',
          principal_id: 'group-1',
          access_level: 'manage',
        }],
      }), {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledWith('workspace-1', 'scope-1', expect.objectContaining({
        name: 'Implementation',
        metadata: {
          basePrompt: expect.stringContaining('Working directory: /Users/mini/code/product-score'),
        },
      }), {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(store.channels.map((channel) => channel.title)).toEqual([
        'Features',
        'Implementation',
        'Bugs',
        'Refactoring',
      ]);
      expect(store.newScopeTemplateId).toBe('');
      expect(store.newScopeTemplateValues).toEqual({});
      expect(refreshScopes).toHaveBeenCalledTimes(1);
    });

    it('creates a PG scope wizard with channels, default access, and per-channel access', async () => {
      mocks.isTowerPgBackendMode.mockReturnValue(true);
      const refreshScopes = vi.fn(async () => []);
      const store = createScopeStore({
        session: { npub: 'npub1pete' },
        channels: [],
        newScopeTitle: 'Projects',
        newScopeDescription: 'Project work',
        newScopeDefaultAccessRows: [
          { principal_type: 'group', principal_id: 'group-workspace', capacity: 'viewer' },
          { principal_type: 'actor', principal_id: 'actor-pete', capacity: 'manager' },
        ],
        newScopeChannelDrafts: [
          {
            id: 'draft-implementation',
            name: 'Implementation',
            description: 'Build work',
            basePrompt: 'Implementation context',
            accessRows: [
              { principal_type: 'group', principal_id: 'group-workspace', capacity: 'viewer' },
              { principal_type: 'actor', principal_id: 'actor-pete', capacity: 'manager' },
              { principal_type: 'actor', principal_id: 'actor-rick', capacity: 'contributor' },
            ],
          },
          {
            id: 'draft-agents',
            name: 'Agents',
            description: '',
            basePrompt: 'Agent work',
            accessRows: [
              { principal_type: 'group', principal_id: 'group-agents', capacity: 'agent' },
            ],
          },
        ],
        resolveGroupId(groupId) {
          return groupId || null;
        },
        refreshScopes,
      });

      await store.addScope();

      expect(mocks.createTowerPgWorkspaceScope).toHaveBeenCalledWith('workspace-1', {
        name: 'Projects',
        description: 'Project work',
        kind: 'project',
        owner_group_id: 'group-workspace',
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledTimes(2);
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledWith('workspace-1', 'scope-1', {
        name: 'Implementation',
        description: 'Build work',
        metadata: {
          basePrompt: 'Implementation context',
        },
        kind: 'channel',
        grants: [
          { principal_type: 'group', principal_id: 'group-workspace', access_level: 'view' },
          { principal_type: 'actor', principal_id: 'actor-pete', access_level: 'manage' },
          { principal_type: 'actor', principal_id: 'actor-rick', access_level: 'contribute' },
        ],
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(mocks.createTowerPgScopeChannel).toHaveBeenCalledWith('workspace-1', 'scope-1', {
        name: 'Agents',
        description: undefined,
        metadata: {
          basePrompt: 'Agent work',
        },
        kind: 'channel',
        grants: [
          {
            principal_type: 'group',
            principal_id: 'group-agents',
            permissions: expect.arrayContaining(['channel.read', 'task.create', 'doc.write']),
          },
        ],
      }, {
        baseUrl: 'https://tower.example',
        appNpub: 'flightdeck_pg',
      });
      expect(store.channels.map((channel) => channel.title)).toEqual(['Implementation', 'Agents']);
      expect(refreshScopes).toHaveBeenCalledTimes(1);
      expect(store.showNewScopeForm).toBe(false);
    });

    it('keeps the PG scope owner group as a single group selection', () => {
      mocks.isTowerPgBackendMode.mockReturnValue(true);
      const store = createScopeStore({
        newScopeAssignedGroupIds: ['group-1'],
        resolveGroupId(groupId) {
          return groupId || null;
        },
      });

      store.addNewScopeGroup('group-2');

      expect(store.newScopeAssignedGroupIds).toEqual(['group-2']);
      expect(store.newScopeGroupQuery).toBe('');
    });
  });

  describe('scope edit state', () => {
    it('detects when editing scope groups differ from the stored scope groups', () => {
      const store = createScopeStore({
        editingScope: {
          record_id: 'scope-1',
          group_ids: ['group-a'],
        },
        editingScopeAssignedGroupIds: ['group-a', 'group-b'],
        getScopeShareGroupIds(scope) {
          return scope.group_ids || [];
        },
        resolveGroupId(groupId) {
          return groupId || null;
        },
      });

      expect(store.editingScopeHasGroupChanges).toBe(true);
    });

    it('reapplies current scope group crypto without opening the edit modal', async () => {
      const reencryptScopedRecordsForScope = vi.fn(async () => ({
        total: 2,
        message: 'Re-encrypted 2 scoped records (1 tasks, 1 docs, 0 folders, 0 flows, 0 approvals, 0 channels, 0 reports).',
      }));
      const flushAndBackgroundSync = vi.fn(async () => {});
      const scope = { record_id: 'scope-1', title: 'Websites', group_ids: ['group-a', 'group-b'] };
      const store = createScopeStore({
        scopePolicyRepairBusy: false,
        scopePolicyRepairSummary: 'Old summary',
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        reencryptScopedRecordsForScope,
        flushAndBackgroundSync,
      });

      await store.reapplyScopeGroupCrypto(scope.record_id);

      expect(reencryptScopedRecordsForScope).toHaveBeenCalledWith(scope, scope);
      expect(flushAndBackgroundSync).toHaveBeenCalledTimes(1);
      expect(store.scopePolicyRepairBusy).toBe(false);
      expect(store.scopePolicyRepairSummary).toBe('Websites: Re-encrypted 2 scoped records (1 tasks, 1 docs, 0 folders, 0 flows, 0 approvals, 0 channels, 0 reports).');
    });

    it('same-scope reapply uses legacy fallback instead of treating current groups as the previous scope policy', async () => {
      const scope = { record_id: 'scope-1', title: 'Websites', group_ids: ['group-new'] };
      const repairScopedDocumentRecord = vi.fn(async () => true);
      const store = createScopeStore({
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        documents: [{ record_id: 'doc-1', scope_id: 'scope-1', record_state: 'active' }],
        directories: [],
        tasks: [],
        flows: [],
        approvals: [],
        channels: [],
        reports: [],
        repairScopedDocumentRecord,
        repairScopedDirectoryRecord: vi.fn(async () => false),
        repairScopedTaskRecord: vi.fn(async () => false),
        repairScopedFlowRecord: vi.fn(async () => false),
        repairScopedApprovalRecord: vi.fn(async () => false),
        repairScopedChannelRecord: vi.fn(async () => false),
        repairScopedReportRecord: vi.fn(async () => false),
        getScopeShareGroupIds(currentScope) {
          return currentScope.group_ids || [];
        },
      });

      const summary = await store.reencryptScopedRecordsForScope(scope, scope);

      expect(repairScopedDocumentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ record_id: 'doc-1' }),
        [],
        scope,
      );
      expect(summary.documents).toBe(1);
      expect(store.showScopeRepairModal).toBe(true);
      expect(store.scopeRepairSession.phase).toBe('done');
      expect(store.scopeRepairSession.rewrittenRecords).toBe(1);
      expect(store.scopeRepairProgress.find((family) => family.id === 'documents')).toMatchObject({
        status: 'done',
        total: 1,
        rewritten: 1,
      });
    });

    it('resolves unscoped doc scope from the nearest scoped parent folder', () => {
      const scope = { record_id: 'scope-1', title: 'Websites', group_ids: ['group-a'] };
      const parent = { record_id: 'dir-parent', scope_id: 'scope-1', parent_directory_id: null };
      const child = { record_id: 'dir-child', scope_id: null, parent_directory_id: 'dir-parent' };
      const store = createScopeStore({
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        directories: [parent, child],
      });

      expect(store.resolveLegacyDocScopeId(
        { record_id: 'doc-1', parent_directory_id: 'dir-child', scope_id: null },
        null,
        new Map([[parent.record_id, parent], [child.record_id, child]]),
      )).toBe('scope-1');
    });

    it('builds legacy doc assignment with scope groups as the write policy', () => {
      const scope = { record_id: 'scope-1', title: 'Websites', level: 'l1', group_ids: ['group-a'] };
      const store = createScopeStore({
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        groups: [{ group_id: 'group-a', name: 'Team' }],
        resolveGroupId(groupId) {
          return groupId || null;
        },
      });

      const patch = store.buildLegacyDocScopeAssignment({
        record_id: 'doc-1',
        shares: [{ type: 'group', key: 'group:group-b', group_id: 'group-b', access: 'read' }],
        group_ids: ['group-b'],
      }, 'scope-1');

      expect(patch).toMatchObject({
        scope_id: 'scope-1',
        scope_policy_group_ids: ['group-a'],
      });
      expect(patch.group_ids).toEqual(['group-a', 'group-b']);
    });
  });
});
