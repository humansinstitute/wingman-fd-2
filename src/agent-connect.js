import { nip19 } from 'nostr-tools';
import { DEFAULT_SUPERBASED_URL, FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';
import { PG_WORKSPACE_DESCRIPTOR_TYPE, parsePgWorkspaceDescriptor } from './pg-workspace-descriptor.js';

function trimText(value) {
  return String(value ?? '').trim();
}

function trimUrl(value) {
  return trimText(value).replace(/\/+$/, '');
}

function withPath(base, path) {
  const root = trimUrl(base);
  return root ? `${root}${path}` : '';
}

function appPubkeyHexFromNpub(appNpub) {
  if (!appNpub) return null;
  try {
    const decoded = nip19.decode(trimText(appNpub));
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

function workspaceDescriptorInput(workspace = null) {
  if (workspace?.pgDescriptor) return workspace.pgDescriptor;
  return null;
}

function buildDescriptorFallback({ workspace = null, backendUrl = '', session = null } = {}) {
  const workspaceId = trimText(workspace?.workspaceId || workspace?.workspace_id);
  const towerBaseUrl = trimUrl(workspace?.directHttpsUrl || workspace?.towerBaseUrl || backendUrl);
  return {
    type: PG_WORKSPACE_DESCRIPTOR_TYPE,
    version: 1,
    tower_base_url: towerBaseUrl || null,
    identity: {
      tower_service_npub: trimText(workspace?.towerServiceNpub || workspace?.serviceNpub) || null,
      workspace_service_npub: trimText(workspace?.workspaceServiceNpub || workspace?.workspace_service_npub) || null,
      workspace_owner_npub: trimText(workspace?.workspaceOwnerNpub || workspace?.workspace_owner_npub || session?.npub) || null,
      workspace_id: workspaceId || null,
      app_npub: trimText(workspace?.appNpub || workspace?.app_npub || FLIGHT_DECK_PG_APP_NPUB) || null,
    },
    label: trimText(workspace?.name || workspace?.towerName) || null,
    description: trimText(workspace?.description || workspace?.towerDescription) || null,
    capabilities: Array.isArray(workspace?.capabilities) ? workspace.capabilities : [],
    links: {
      descriptor: workspaceId ? `/api/v4/flightdeck-pg/workspaces/${workspaceId}/descriptor` : null,
      me: workspaceId ? `/api/v4/flightdeck-pg/workspaces/${workspaceId}/me` : null,
      scopes: workspaceId ? `/api/v4/flightdeck-pg/workspaces/${workspaceId}/scopes` : null,
      events: workspaceId ? `/api/v4/flightdeck-pg/workspaces/${workspaceId}/events` : null,
    },
  };
}

function descriptorJsonFromNormalized(descriptor) {
  return {
    type: PG_WORKSPACE_DESCRIPTOR_TYPE,
    version: descriptor.version || 1,
    tower_base_url: descriptor.towerBaseUrl,
    identity: {
      tower_service_npub: descriptor.towerServiceNpub,
      workspace_service_npub: descriptor.workspaceServiceNpub,
      workspace_owner_npub: descriptor.workspaceOwnerNpub,
      workspace_id: descriptor.workspaceId,
      app_npub: descriptor.appNpub || FLIGHT_DECK_PG_APP_NPUB,
    },
    label: descriptor.label || null,
    description: descriptor.description || null,
    capabilities: descriptor.capabilities || [],
    links: {
      ...(descriptor.links || {}),
      descriptor: trimText(descriptor.links?.descriptor) || `/api/v4/flightdeck-pg/workspaces/${descriptor.workspaceId}/descriptor`,
      me: trimText(descriptor.links?.me) || `/api/v4/flightdeck-pg/workspaces/${descriptor.workspaceId}/me`,
      scopes: trimText(descriptor.links?.scopes) || `/api/v4/flightdeck-pg/workspaces/${descriptor.workspaceId}/scopes`,
      events: trimText(descriptor.links?.events) || `/api/v4/flightdeck-pg/workspaces/${descriptor.workspaceId}/events`,
    },
  };
}

function buildWorkspaceDescriptor({ workspace = null, backendUrl = '', session = null } = {}) {
  const input = workspaceDescriptorInput(workspace) || buildDescriptorFallback({ workspace, backendUrl, session });
  try {
    return descriptorJsonFromNormalized(parsePgWorkspaceDescriptor(input));
  } catch {
    return buildDescriptorFallback({ workspace, backendUrl, session });
  }
}

export function buildAgentConnectPackage({
  windowOrigin = '',
  backendUrl = '',
  session = null,
  workspace = null,
} = {}) {
  const origin = trimUrl(windowOrigin);
  const descriptor = buildWorkspaceDescriptor({ workspace, backendUrl, session });
  const currentBackendUrl = trimUrl(
    descriptor?.tower_base_url
    || workspace?.directHttpsUrl
    || backendUrl
    || DEFAULT_SUPERBASED_URL
  );
  const appNpub = trimText(descriptor?.identity?.app_npub || workspace?.appNpub || FLIGHT_DECK_PG_APP_NPUB);

  return {
    kind: 'coworker_agent_connect',
    version: 6,
    protocol: 'flightdeck_pg',
    generated_at: new Date().toISOString(),
    llms_url: withPath(origin, '/llms.txt'),
    robots_url: withPath(origin, '/robots.txt'),
    service: {
      direct_https_url: currentBackendUrl,
      openapi_url: withPath(currentBackendUrl, '/openapi.json'),
      docs_url: withPath(currentBackendUrl, '/docs'),
      health_url: withPath(currentBackendUrl, '/health'),
    },
    auth: {
      scheme: 'NIP-98',
      app_header: 'x-flightdeck-pg-app-npub',
      app_npub: appNpub || null,
      app_pubkey: appPubkeyHexFromNpub(appNpub),
    },
    workspace_descriptor: descriptor,
  };
}
