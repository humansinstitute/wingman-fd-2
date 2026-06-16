/**
 * Connection, settings, and agent-connect methods extracted from app.js.
 *
 * The connectSettingsManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  setBaseUrl,
  createWorkspace,
  createTowerPgAdminWorkspace,
  getWorkspaces,
  getTowerPgService,
  getTowerPgWorkspaceDescriptor,
  getTowerPgWorkspaceMe,
  listTowerPgWorkspaces,
} from './api.js';
import {
  normalizeWorkspaceEntry,
  workspaceFromToken,
} from './workspaces.js';
import { isTowerPgBackendMode } from './backend-mode.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';
import { parseSuperBasedToken, buildSuperBasedConnectionToken } from './superbased-token.js';
import { buildAgentConnectPackage } from './agent-connect.js';
import { APP_NPUB, DEFAULT_SUPERBASED_URL, FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';
import {
  parsePgWorkspaceDescriptor,
  pgWorkspaceEntryFromDescriptor,
  pgWorkspaceSessionNpubFromMe,
} from './pg-workspace-descriptor.js';
import {
  personalEncryptForNpub,
} from './auth/nostr.js';
import {
  buildWrappedMemberKeys,
  createGroupIdentity,
} from './crypto/group-keys.js';

function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function trimText(value) {
  return String(value || '').trim();
}

function buildDefaultKnownHosts() {
  const defaultUrl = trimUrl(DEFAULT_SUPERBASED_URL);
  if (!defaultUrl) return [];
  return [{
    url: defaultUrl,
    label: defaultUrl,
    serviceNpub: '',
    towerName: '',
    towerDescription: '',
  }];
}

function looksLikeJsonObject(value) {
  return String(value || '').trim().startsWith('{');
}

function pgWorkspaceIdFromEntry(entry = {}) {
  return trimText(
    entry.workspaceId
    || entry.workspace_id
    || entry.identity?.workspace_id
  );
}

function pgWorkspaceLabel(entry = {}) {
  return trimText(entry.label || entry.name) || 'Untitled workspace';
}

function pgErrorMessage(error, fallback = 'Flight Deck PG connection failed') {
  return error?.message || String(error || fallback);
}

const PG_SELF_INDEX_STATE_KEYS = [
  'pgSelfIndexStatus',
  'pgSelfIndexError',
  'pgSelfIndexPublishedAt',
  'pgSelfIndexFailedAt',
  'pgSelfIndexDiscoveredAt',
  'pgSelfIndexVerifiedAt',
  'pgSelfIndexStaleAt',
  'pgSelfIndexEventId',
  'pgSelfIndexLastBroadcastAt',
  'pgSelfIndexSignedEvent',
  'pgSelfIndexRelays',
];

function findExistingPgWorkspace(workspaces = [], candidate = {}) {
  return (Array.isArray(workspaces) ? workspaces : []).find((workspace) => {
    if (workspace?.workspaceKey && candidate.workspaceKey && workspace.workspaceKey === candidate.workspaceKey) return true;
    return Boolean(
      workspace?.pgBackendMode
      && candidate.pgBackendMode
      && workspace.pgSessionNpub === candidate.pgSessionNpub
      && workspace.towerServiceNpub === candidate.towerServiceNpub
      && workspace.workspaceServiceNpub === candidate.workspaceServiceNpub
      && workspace.appNpub === candidate.appNpub
    );
  }) || null;
}

function preservePgSelfIndexState(candidate = {}, existing = null) {
  if (!existing) return candidate;
  const next = { ...candidate };
  for (const key of PG_SELF_INDEX_STATE_KEYS) {
    const value = next[key];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    if ((value == null || value === '' || isEmptyArray) && existing[key] != null && existing[key] !== '') {
      next[key] = existing[key];
    }
  }
  return next;
}

async function fetchTowerDiscovery(url, fallbackLabel = '') {
  const cleanUrl = trimUrl(url);
  if (!cleanUrl) throw new Error('URL is required');
  const healthRes = await fetch(`${cleanUrl}/health`);
  if (!healthRes.ok) throw new Error(`Server returned ${healthRes.status}`);
  const health = await healthRes.json();
  if (health.status !== 'ok') throw new Error('Server health check failed');
  const towerName = trimText(health.tower_name);
  const towerDescription = trimText(health.tower_description);
  return {
    url: cleanUrl,
    serviceNpub: trimText(health.service_npub),
    towerName,
    towerDescription,
    label: towerName || trimText(fallbackLabel) || cleanUrl,
  };
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const connectSettingsManagerMixin = {

  get isTowerPgMode() {
    return isTowerPgBackendMode();
  },

  // --- settings ---

  handleHarnessInput(value) {
    this.wingmanHarnessInput = value;
    this.wingmanHarnessDirty = true;
    this.wingmanHarnessError = null;
  },

  handleHarnessAgentInput(value) {
    this.wingmanHarnessAgentQuery = value;
    this.wingmanHarnessDirty = true;
    this.wingmanHarnessError = null;
    if (this.wingmanHarnessAgentQuery.startsWith('npub1') && this.wingmanHarnessAgentQuery.length >= 20) {
      this.resolveChatProfile(this.wingmanHarnessAgentQuery);
    }
  },

  async selectHarnessAgent(npub) {
    const nextNpub = String(npub || '').trim();
    this.workspaceHarnessAgentNpub = nextNpub;
    this.wingmanHarnessAgentQuery = '';
    this.wingmanHarnessDirty = true;
    this.wingmanHarnessError = null;
    if (nextNpub) {
      await this.rememberPeople([nextNpub], 'autopilot-agent');
    }
  },

  clearHarnessAgent() {
    this.workspaceHarnessAgentNpub = '';
    this.wingmanHarnessAgentQuery = '';
    this.wingmanHarnessDirty = true;
    this.wingmanHarnessError = null;
  },

  handleDefaultAgentInput(value) {
    this.defaultAgentQuery = value;
    if (this.defaultAgentQuery.startsWith('npub1') && this.defaultAgentQuery.length >= 20) {
      this.resolveChatProfile(this.defaultAgentQuery);
    }
  },

  async saveSettings() {
    setBaseUrl(this.backendUrl);
    await this.persistWorkspaceSettings();
    this.ensureBackgroundSync();
  },

  async selectDefaultAgent(npub) {
    const nextNpub = String(npub || '').trim();
    this.defaultAgentNpub = nextNpub;
    this.defaultAgentQuery = '';
    if (nextNpub) {
      await this.rememberPeople([nextNpub], 'default-agent');
    }
    await this.persistWorkspaceSettings();
  },

  async clearDefaultAgent() {
    this.defaultAgentNpub = '';
    this.defaultAgentQuery = '';
    await this.persistWorkspaceSettings();
  },

  // --- connection settings ---

  async saveConnectionSettings() {
    this.superbasedError = null;
    const token = String(this.superbasedTokenInput || '').trim();
    if (isTowerPgBackendMode()) {
      if (!token) {
        this.superbasedError = 'Flight Deck PG requires a workspace descriptor. Connect through a Tower PG host or paste a descriptor.';
        return;
      }
      if (!looksLikeJsonObject(token)) {
        this.superbasedError = 'This Flight Deck build only accepts Tower PG workspace descriptors, not legacy connection tokens.';
        return;
      }
      try {
        await this.connectWithPgDescriptor(token, { closeModal: false });
      } catch (error) {
        this.superbasedError = pgErrorMessage(error);
      }
      return;
    }
    if (token) {
      const config = parseSuperBasedToken(token);
      if (!config.isValid || !config.directHttpsUrl) {
        this.superbasedError = 'Connection key must include a direct HTTPS URL';
        return;
      }
      this.superbasedTokenInput = token;
      this.backendUrl = normalizeBackendUrl(config.directHttpsUrl);
      this.addKnownHost({
        url: config.directHttpsUrl,
        label: config.towerName || config.directHttpsUrl,
        serviceNpub: config.serviceNpub,
        towerName: config.towerName,
        towerDescription: config.towerDescription,
      });
      const workspace = workspaceFromToken(token, { name: 'Imported workspace' });
      if (workspace) {
        this.mergeKnownWorkspaces([workspace]);
        this.selectedWorkspaceKey = workspace.workspaceKey || '';
        this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
        this.ownerNpub = workspace.workspaceOwnerNpub;
      } else {
        this.ownerNpub = config.workspaceOwnerNpub || this.session?.npub || this.ownerNpub;
      }
    } else if (this.session?.npub) {
      this.ownerNpub = this.session.npub;
    }
    if (!this.backendUrl) {
      this.superbasedError = 'Connection key or backend URL required';
      return;
    }
    localStorage.setItem('use_cvm_sync', this.useCvmSync ? 'true' : 'false');
    await this.saveSettings();
    this.showAvatarMenu = false;
    if (this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub) {
      await this.selectWorkspace(this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub);
    }
  },

  async connectToPreset(presetUrl) {
    if (isTowerPgBackendMode()) {
      return this.connectToPgHost(presetUrl, this.presetConnectHost?.label || '');
    }
    this.presetConnecting = true;
    this.superbasedError = null;
    try {
      const discovery = await fetchTowerDiscovery(presetUrl, this.presetConnectHost?.label || '');
      if (!discovery.serviceNpub) throw new Error('Invalid health response');
      this.addKnownHost(discovery);
      const token = buildSuperBasedConnectionToken({
        directHttpsUrl: discovery.url,
        serviceNpub: discovery.serviceNpub,
        towerName: discovery.towerName,
        towerDescription: discovery.towerDescription,
        appNpub: APP_NPUB,
      });
      this.superbasedTokenInput = token;
      this.backendUrl = normalizeBackendUrl(discovery.url);
      await this.saveConnectionSettings();
      await this.loadRemoteWorkspaces();
      if (this.knownWorkspaces.length === 0 && this.session?.npub) {
        await this.tryRecoverWorkspace();
      }
      if (this.knownWorkspaces.length === 0) {
        this.updateWorkspaceBootstrapPrompt();
      }
    } catch (error) {
      this.superbasedError = `Failed to connect: ${error?.message || error}`;
    } finally {
      this.presetConnecting = false;
    }
  },

  toggleCvmSync() {
    this.useCvmSync = !this.useCvmSync;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('use_cvm_sync', this.useCvmSync ? 'true' : 'false');
    }
  },

  // --- Connect modal (two-step) ---

  openConnectModal() {
    this.showWorkspaceBootstrapModal = false;
    this.showConnectModal = true;
    this.connectStep = 1;
    this.connectHostUrl = '';
    this.connectHostLabel = '';
    this.connectHostServiceNpub = '';
    this.connectHostTowerName = '';
    this.connectHostTowerDescription = '';
    this.connectHostError = null;
    this.connectHostBusy = false;
    this.connectManualUrl = '';
    this.connectWorkspaces = [];
    this.connectWorkspacesBusy = false;
    this.connectWorkspacesError = null;
    this.connectNewWorkspaceName = '';
    this.connectNewWorkspaceDescription = '';
    this.connectCreatingWorkspace = false;
    this.connectTokenInput = '';
    this.connectShowTokenFallback = false;
    this.showWorkspaceSwitcherMenu = false;
    this.mobileNavOpen = false;
    this.refreshKnownHostsMetadata().catch(() => {});
  },

  closeConnectModal() {
    if (this.connectHostBusy || this.connectWorkspacesBusy || this.connectCreatingWorkspace) return;
    this.showConnectModal = false;
  },

  async connectToHost(hostUrl, hostLabel) {
    if (isTowerPgBackendMode()) {
      return this.connectToPgHost(hostUrl, hostLabel);
    }
    this.connectHostError = null;
    this.connectHostBusy = true;
    try {
      const discovery = await fetchTowerDiscovery(hostUrl, hostLabel);
      this.connectHostUrl = discovery.url;
      this.connectHostLabel = discovery.label;
      this.connectHostServiceNpub = discovery.serviceNpub;
      this.connectHostTowerName = discovery.towerName;
      this.connectHostTowerDescription = discovery.towerDescription;
      this.addKnownHost(discovery);
      this.backendUrl = normalizeBackendUrl(discovery.url);
      setBaseUrl(this.backendUrl);
      const token = buildSuperBasedConnectionToken({
        directHttpsUrl: discovery.url,
        serviceNpub: discovery.serviceNpub,
        towerName: discovery.towerName,
        towerDescription: discovery.towerDescription,
        appNpub: APP_NPUB,
      });
      this.superbasedTokenInput = token;
      await this.saveSettings();
      this.connectStep = 2;
      await this.loadConnectWorkspaces();
    } catch (error) {
      this.connectHostError = `Failed to connect: ${error?.message || error}`;
    } finally {
      this.connectHostBusy = false;
    }
  },

  async connectManualHost() {
    await this.connectToHost(this.connectManualUrl, '');
  },

  async connectToPgHost(hostUrl, hostLabel) {
    if (!this.session?.npub) {
      this.connectHostError = 'Sign in first';
      return;
    }
    this.connectHostError = null;
    this.connectHostBusy = true;
    try {
      const cleanUrl = trimUrl(hostUrl);
      if (!cleanUrl) throw new Error('URL is required');
      this.backendUrl = normalizeBackendUrl(cleanUrl);
      setBaseUrl(this.backendUrl);
      const result = await getTowerPgService({ baseUrl: this.backendUrl, appNpub: FLIGHT_DECK_PG_APP_NPUB });
      const service = result.service || {};
      const towerName = trimText(service.name);
      const towerDescription = trimText(service.description);
      this.connectHostUrl = this.backendUrl;
      this.connectHostLabel = towerName || trimText(hostLabel) || this.backendUrl;
      this.connectHostServiceNpub = trimText(service.service_npub);
      this.connectHostTowerName = towerName;
      this.connectHostTowerDescription = towerDescription;
      this.addKnownHost({
        url: this.backendUrl,
        label: this.connectHostLabel,
        serviceNpub: this.connectHostServiceNpub,
        towerName,
        towerDescription,
      });
      await this.saveSettings();
      this.connectStep = 2;
      await this.loadConnectWorkspaces();
    } catch (error) {
      this.connectHostError = `Failed to connect: ${pgErrorMessage(error)}`;
    } finally {
      this.connectHostBusy = false;
    }
  },

  async connectByo() {
    const input = String(this.connectManualUrl || '').trim();
    if (!input) return;
    // If it looks like a URL, treat as host URL
    if (/^https?:\/\//i.test(input)) {
      return this.connectToHost(input, '');
    }
    if (isTowerPgBackendMode() && looksLikeJsonObject(input)) {
      try {
        await this.connectWithPgDescriptor(input);
      } catch (error) {
        this.connectHostError = pgErrorMessage(error);
      }
      return;
    }
    if (isTowerPgBackendMode()) {
      this.connectHostError = 'Enter a Tower URL (https://...) or paste a Flight Deck PG descriptor';
      return;
    }
    // Otherwise try to parse as a connection token
    const parsed = parseSuperBasedToken(input);
    if (parsed.isValid && parsed.directHttpsUrl) {
      this.superbasedTokenInput = input;
      await this.saveConnectionSettings();
      this.showConnectModal = false;
      return;
    }
    this.connectHostError = 'Enter a URL (https://...) or paste a connection token';
  },

  async loadConnectWorkspaces() {
    if (!this.session?.npub) { this.connectWorkspacesError = 'Sign in first'; return; }
    this.connectWorkspacesBusy = true;
    this.connectWorkspacesError = null;
    try {
      if (isTowerPgBackendMode()) {
        const result = await listTowerPgWorkspaces({
          baseUrl: this.connectHostUrl || this.backendUrl,
          appNpub: FLIGHT_DECK_PG_APP_NPUB,
        });
        this.connectWorkspaces = (result.workspaces || []).map((entry) => ({
          ...entry,
          directHttpsUrl: normalizeBackendUrl(entry.tower_base_url || this.connectHostUrl || this.backendUrl),
          serviceNpub: entry.identity?.tower_service_npub || this.connectHostServiceNpub,
          workspaceId: entry.identity?.workspace_id,
          workspaceOwnerNpub: entry.identity?.workspace_owner_npub,
          workspaceServiceNpub: entry.identity?.workspace_service_npub,
          appNpub: entry.identity?.app_npub || FLIGHT_DECK_PG_APP_NPUB,
          name: entry.label,
          description: entry.description,
          pgBackendMode: true,
        }));
        return;
      }
      const result = await getWorkspaces(this.session.npub);
      this.connectWorkspaces = (result.workspaces || []).map((entry) => ({
        ...entry,
        directHttpsUrl: entry.direct_https_url || entry.directHttpsUrl || this.connectHostUrl,
        serviceNpub: this.connectHostServiceNpub,
        appNpub: APP_NPUB,
      }));
    } catch (error) {
      this.connectWorkspacesError = `Failed to load workspaces: ${error?.message || error}`;
      this.connectWorkspaces = [];
    } finally {
      this.connectWorkspacesBusy = false;
    }
  },

  async connectSelectWorkspace(workspaceEntry) {
    if (isTowerPgBackendMode()) {
      return this.connectSelectPgWorkspace(workspaceEntry);
    }
    const workspace = normalizeWorkspaceEntry({
      ...workspaceEntry,
      directHttpsUrl: this.connectHostUrl,
      serviceNpub: this.connectHostServiceNpub,
      appNpub: APP_NPUB,
      connectionToken: buildSuperBasedConnectionToken({
        directHttpsUrl: this.connectHostUrl,
        serviceNpub: this.connectHostServiceNpub,
        towerName: this.connectHostTowerName,
        towerDescription: this.connectHostTowerDescription,
        workspaceOwnerNpub: workspaceEntry.workspace_owner_npub || workspaceEntry.workspaceOwnerNpub,
        appNpub: APP_NPUB,
      }),
    });
    if (!workspace) return;
    this.mergeKnownWorkspaces([workspace]);
    this.selectedWorkspaceKey = workspace.workspaceKey || '';
    this.showConnectModal = false;
    await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub);
  },

  async verifyPgDescriptor(descriptorInput, { baseUrl = null } = {}) {
    if (!this.session?.npub) throw new Error('Sign in first');
    const candidate = parsePgWorkspaceDescriptor(descriptorInput);
    const towerBaseUrl = normalizeBackendUrl(baseUrl || candidate.towerBaseUrl);
    const descriptor = await getTowerPgWorkspaceDescriptor(candidate.workspaceId, {
      baseUrl: towerBaseUrl,
      appNpub: candidate.appNpub || FLIGHT_DECK_PG_APP_NPUB,
      path: candidate.links.descriptor || null,
    });
    const verified = parsePgWorkspaceDescriptor({
      ...descriptor,
      tower_base_url: descriptor.tower_base_url || towerBaseUrl,
    });
    if (candidate.towerServiceNpub && verified.towerServiceNpub && candidate.towerServiceNpub !== verified.towerServiceNpub) {
      throw new Error('Workspace descriptor Tower identity mismatch');
    }
    if (candidate.workspaceServiceNpub && verified.workspaceServiceNpub !== candidate.workspaceServiceNpub) {
      throw new Error('Workspace descriptor workspace identity mismatch');
    }
    if (candidate.appNpub && verified.appNpub !== candidate.appNpub) {
      throw new Error('Workspace descriptor app identity mismatch');
    }
    const me = await getTowerPgWorkspaceMe(verified.workspaceId, {
      baseUrl: towerBaseUrl,
      appNpub: verified.appNpub || FLIGHT_DECK_PG_APP_NPUB,
      path: verified.links.me || null,
    });
    return { descriptor: verified, me };
  },

  async rememberVerifiedPgWorkspace(descriptor, me = null, options = {}) {
    const sessionNpub = pgWorkspaceSessionNpubFromMe(me, this.session?.npub || '');
    if (!sessionNpub) throw new Error('Verified workspace descriptor is missing actor identity');
    if (this.session?.npub && sessionNpub !== this.session.npub) {
      throw new Error('Workspace descriptor was verified by a different signer');
    }
    let workspace = normalizeWorkspaceEntry(pgWorkspaceEntryFromDescriptor(descriptor, {
      me,
      sessionNpub,
      verifiedAt: new Date().toISOString(),
    }));
    if (!workspace) throw new Error('Verified workspace descriptor could not be stored');
    workspace = preservePgSelfIndexState(workspace, findExistingPgWorkspace(this.knownWorkspaces, workspace));
    const workspaceBackendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl);
    if (options.select !== false || !this.backendUrl) {
      this.backendUrl = workspaceBackendUrl;
      if (this.backendUrl) setBaseUrl(this.backendUrl);
    }
    this.addKnownHost({
      url: workspaceBackendUrl,
      label: workspace.towerName || workspace.directHttpsUrl || workspaceBackendUrl,
      serviceNpub: workspace.towerServiceNpub || workspace.serviceNpub,
      towerName: workspace.towerName,
      towerDescription: workspace.towerDescription,
    });
    this.mergeKnownWorkspaces([workspace]);
    if (options.select !== false) {
      this.selectedWorkspaceKey = workspace.workspaceKey || '';
      this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
      this.ownerNpub = workspace.workspaceOwnerNpub;
      this.superbasedTokenInput = '';
    }
    await this.saveSettings();
    if (options.publishSelfIndex !== false && typeof this.publishPgWorkspaceSelfIndex === 'function') {
      const shouldPublishSelfIndex = typeof this.shouldQueuePgWorkspaceSelfIndexPublish === 'function'
        ? this.shouldQueuePgWorkspaceSelfIndexPublish(workspace)
        : true;
      if (shouldPublishSelfIndex && typeof this.markPgWorkspaceSelfIndexPending === 'function') {
        workspace = await this.markPgWorkspaceSelfIndexPending(workspace) || workspace;
      }
      if (shouldPublishSelfIndex && typeof this.schedulePgWorkspaceSelfIndexPublish === 'function') {
        this.schedulePgWorkspaceSelfIndexPublish(workspace);
      } else if (shouldPublishSelfIndex) {
        Promise.resolve()
          .then(() => this.publishPgWorkspaceSelfIndex(workspace))
          .catch(() => {});
      }
    }
    return workspace;
  },

  async connectWithPgDescriptor(descriptorInput, { closeModal = true } = {}) {
    const { descriptor, me } = await this.verifyPgDescriptor(descriptorInput);
    const workspace = await this.rememberVerifiedPgWorkspace(descriptor, me);
    if (closeModal) this.showConnectModal = false;
    await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub, { pgVerified: true });
    return workspace;
  },

  async connectSelectPgWorkspace(workspaceEntry) {
    const workspaceId = pgWorkspaceIdFromEntry(workspaceEntry);
    if (!workspaceId) return;
    this.connectWorkspacesError = null;
    this.connectWorkspacesBusy = true;
    try {
      const baseUrl = normalizeBackendUrl(workspaceEntry.directHttpsUrl || this.connectHostUrl || this.backendUrl);
      const descriptorPath = workspaceEntry.links?.descriptor || null;
      const descriptor = await getTowerPgWorkspaceDescriptor(workspaceId, {
        baseUrl,
        appNpub: workspaceEntry.appNpub || FLIGHT_DECK_PG_APP_NPUB,
        path: descriptorPath,
      });
      const { descriptor: verified, me } = await this.verifyPgDescriptor({
        ...descriptor,
        tower_base_url: descriptor.tower_base_url || baseUrl,
      }, { baseUrl });
      const workspace = await this.rememberVerifiedPgWorkspace(verified, me);
      this.showConnectModal = false;
      await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub, { pgVerified: true });
    } catch (error) {
      this.connectWorkspacesError = `Failed to connect to ${pgWorkspaceLabel(workspaceEntry)}: ${pgErrorMessage(error)}`;
    } finally {
      this.connectWorkspacesBusy = false;
    }
  },

  async connectCreateWorkspace() {
    if (isTowerPgBackendMode()) {
      const memberNpub = this.session?.npub;
      if (!memberNpub) { this.connectWorkspacesError = 'Sign in first'; return; }
      const name = String(this.connectNewWorkspaceName || '').trim();
      if (!name) { this.connectWorkspacesError = 'Workspace name is required'; return; }
      const baseUrl = normalizeBackendUrl(this.connectHostUrl || this.backendUrl);
      if (!baseUrl) {
        this.connectWorkspacesError = 'Connect to a Tower PG host before creating a workspace.';
        return;
      }
      this.connectCreatingWorkspace = true;
      this.connectWorkspacesError = null;
      try {
        const result = await createTowerPgAdminWorkspace({
          workspace_name: name,
          workspace_description: String(this.connectNewWorkspaceDescription || '').trim(),
          app_npub: FLIGHT_DECK_PG_APP_NPUB,
        }, { baseUrl, appNpub: FLIGHT_DECK_PG_APP_NPUB });
        if (!result?.descriptor) throw new Error('Tower did not return a workspace descriptor');
        const workspace = await this.connectWithPgDescriptor(JSON.stringify(result.descriptor));
        this.connectNewWorkspaceName = '';
        this.connectNewWorkspaceDescription = '';
        return workspace;
      } catch (error) {
        this.connectWorkspacesError = pgErrorMessage(error, 'Failed to create Flight Deck PG workspace');
      } finally {
        this.connectCreatingWorkspace = false;
      }
      return;
    }
    const memberNpub = this.session?.npub;
    if (!memberNpub) { this.connectWorkspacesError = 'Sign in first'; return; }
    const name = String(this.connectNewWorkspaceName || '').trim();
    if (!name) { this.connectWorkspacesError = 'Workspace name is required'; return; }
    this.connectCreatingWorkspace = true;
    this.connectWorkspacesError = null;
    try {
      const workspaceIdentity = createGroupIdentity();
      const defaultGroupIdentity = createGroupIdentity();
      const adminGroupIdentity = createGroupIdentity();
      const privateGroupIdentity = createGroupIdentity();
      const wrappedWorkspaceNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
      const defaultGroupMemberKeys = await buildWrappedMemberKeys(defaultGroupIdentity, [memberNpub], memberNpub);
      const adminGroupMemberKeys = await buildWrappedMemberKeys(adminGroupIdentity, [memberNpub], memberNpub);
      const privateGroupMemberKeys = await buildWrappedMemberKeys(privateGroupIdentity, [memberNpub], memberNpub);
      const response = await createWorkspace({
        workspace_owner_npub: workspaceIdentity.npub, name,
        description: String(this.connectNewWorkspaceDescription || '').trim(),
        wrapped_workspace_nsec: wrappedWorkspaceNsec, wrapped_by_npub: memberNpub,
        default_group_npub: defaultGroupIdentity.npub, default_group_name: `${name} Shared`,
        default_group_member_keys: defaultGroupMemberKeys,
        admin_group_npub: adminGroupIdentity.npub, admin_group_name: 'Workspace Admins',
        admin_group_member_keys: adminGroupMemberKeys,
        private_group_npub: privateGroupIdentity.npub, private_group_name: 'Private',
        private_group_member_keys: privateGroupMemberKeys,
      });
      const workspace = normalizeWorkspaceEntry({
        ...response, serviceNpub: this.connectHostServiceNpub, appNpub: APP_NPUB,
        connectionToken: buildSuperBasedConnectionToken({
          directHttpsUrl: this.connectHostUrl,
          serviceNpub: this.connectHostServiceNpub,
          towerName: this.connectHostTowerName,
          towerDescription: this.connectHostTowerDescription,
          workspaceOwnerNpub: response.workspace_owner_npub, appNpub: APP_NPUB,
        }),
      });
      this.mergeKnownWorkspaces([workspace]);
      this.showConnectModal = false;
      await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub);
    } catch (error) {
      this.connectWorkspacesError = error?.message || 'Failed to create workspace';
    } finally {
      this.connectCreatingWorkspace = false;
    }
  },

  async connectWithToken() {
    const token = String(this.connectTokenInput || '').trim();
    if (!token) return;
    if (isTowerPgBackendMode()) {
      if (!looksLikeJsonObject(token)) {
        this.connectWorkspacesError = 'This Flight Deck build only accepts Tower PG workspace descriptors, not legacy connection tokens.';
        return;
      }
      try {
        await this.connectWithPgDescriptor(token);
      } catch (error) {
        this.connectWorkspacesError = pgErrorMessage(error);
      }
      return;
    }
    this.superbasedTokenInput = token;
    await this.saveConnectionSettings();
    this.showConnectModal = false;
  },

  connectGoBack() {
    this.connectStep = 1;
    this.connectWorkspaces = [];
    this.connectWorkspacesError = null;
    this.connectNewWorkspaceName = '';
    this.connectNewWorkspaceDescription = '';
  },

  // --- known hosts ---

  addKnownHost({ url, label, serviceNpub, towerName, towerDescription }) {
    const cleanUrl = trimUrl(url);
    if (!cleanUrl) return;
    const existing = this.knownHosts.findIndex((h) => h.url === cleanUrl);
    const entry = {
      url: cleanUrl,
      label: trimText(towerName) || trimText(label) || cleanUrl,
      serviceNpub: trimText(serviceNpub),
      towerName: trimText(towerName),
      towerDescription: trimText(towerDescription),
    };
    if (existing >= 0) { this.knownHosts[existing] = entry; } else { this.knownHosts.push(entry); }
  },

  get mergedHostsList() {
    const merged = [];
    const indexByUrl = new Map();
    for (const host of [...buildDefaultKnownHosts(), ...this.knownHosts]) {
      const cleanUrl = trimUrl(host.url);
      if (!cleanUrl) continue;
      const nextHost = {
        ...host,
        url: cleanUrl,
        label: trimText(host.towerName) || trimText(host.label) || cleanUrl,
        serviceNpub: trimText(host.serviceNpub),
        towerName: trimText(host.towerName),
        towerDescription: trimText(host.towerDescription),
      };
      if (indexByUrl.has(cleanUrl)) {
        merged[indexByUrl.get(cleanUrl)] = {
          ...merged[indexByUrl.get(cleanUrl)],
          ...nextHost,
        };
        continue;
      }
      indexByUrl.set(cleanUrl, merged.length);
      merged.push(nextHost);
    }
    return merged;
  },

  get presetConnectHost() {
    const defaultUrl = trimUrl(DEFAULT_SUPERBASED_URL);
    if (defaultUrl) {
      return this.mergedHostsList.find((host) => trimUrl(host.url) === defaultUrl) || null;
    }
    return this.mergedHostsList[0] || null;
  },

  async refreshKnownHostsMetadata() {
    const hosts = this.mergedHostsList;
    let changed = false;

    for (const host of hosts) {
      try {
        const discovery = await fetchTowerDiscovery(host.url, host.label || host.url);
        const existing = this.knownHosts.find((entry) => trimUrl(entry.url) === discovery.url) || null;
        const nextEntry = {
          url: discovery.url,
          label: discovery.label,
          serviceNpub: discovery.serviceNpub,
          towerName: discovery.towerName,
          towerDescription: discovery.towerDescription,
        };
        if (
          !existing
          || existing.label !== nextEntry.label
          || existing.serviceNpub !== nextEntry.serviceNpub
          || existing.towerName !== nextEntry.towerName
          || existing.towerDescription !== nextEntry.towerDescription
        ) {
          this.addKnownHost(nextEntry);
          changed = true;
        }
      } catch {
        // Keep the last known metadata when discovery is unavailable.
      }
    }

    if (changed) {
      await this.persistWorkspaceSettings();
    }
  },

  // --- agent connect ---

  async copyId() {
    if (!this.session?.npub) return;
    try {
      await navigator.clipboard.writeText(this.session.npub);
    } catch {
      this.error = 'Failed to copy ID';
    }
    this.showAvatarMenu = false;
  },

  showAgentConnect() {
    this.showAvatarMenu = false;
    this.agentConfigCopied = false;
    this.agentConnectJson = JSON.stringify(buildAgentConnectPackage({
      windowOrigin: typeof window === 'undefined' ? '' : window.location.origin,
      backendUrl: this.backendUrl || DEFAULT_SUPERBASED_URL,
      session: this.session,
      token: this.superbasedTokenInput,
      towerName: this.currentWorkspace?.towerName || this.superbasedConnectionConfig?.towerName || '',
      towerDescription: this.currentWorkspace?.towerDescription || this.superbasedConnectionConfig?.towerDescription || '',
    }), null, 2);
    this.showAgentConnectModal = true;
  },

  closeAgentConnect() {
    this.showAgentConnectModal = false;
  },

  async copyAgentConfig() {
    if (!this.agentConnectJson) return;
    try {
      await navigator.clipboard.writeText(this.agentConnectJson);
      this.agentConfigCopied = true;
      setTimeout(() => {
        this.agentConfigCopied = false;
      }, 2000);
    } catch {
      this.error = 'Failed to copy agent package';
    }
  },
};
