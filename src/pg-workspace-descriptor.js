import { FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';

export const PG_WORKSPACE_DESCRIPTOR_TYPE = 'wingman_workspace_locator';

function trimText(value) {
  return String(value ?? '').trim();
}

function trimUrl(value) {
  return trimText(value).replace(/\/+$/, '');
}

function normalizeTowerBaseUrl(value) {
  return normalizeBackendUrl(trimUrl(value));
}

function parseJsonDescriptor(input) {
  if (input && typeof input === 'object') return input;
  const text = trimText(input);
  if (!text) throw new Error('Workspace descriptor is required');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Workspace descriptor must be valid JSON');
  }
}

function unwrapDescriptor(raw) {
  if (raw?.type === PG_WORKSPACE_DESCRIPTOR_TYPE) return raw;
  if (raw?.descriptor?.type === PG_WORKSPACE_DESCRIPTOR_TYPE) return raw.descriptor;
  if (raw?.response?.type === PG_WORKSPACE_DESCRIPTOR_TYPE) return raw.response;
  if (raw?.example?.response?.type === PG_WORKSPACE_DESCRIPTOR_TYPE) return raw.example.response;
  return raw;
}

function containsCredentialLikeField(value, path = []) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const keyPath = [...path, key];
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes('password')
      || normalizedKey.includes('credential')
      || normalizedKey.includes('private_key')
      || normalizedKey === 'nsec'
      || normalizedKey === 'secret'
      || normalizedKey === 'bearer'
      || normalizedKey === 'token'
      || normalizedKey.endsWith('_token')
      || normalizedKey.includes('access_token')
    ) {
      return keyPath.join('.');
    }
    const nested = containsCredentialLikeField(child, keyPath);
    if (nested) return nested;
  }
  return null;
}

export function parsePgWorkspaceDescriptor(input) {
  const descriptor = unwrapDescriptor(parseJsonDescriptor(input));
  if (!descriptor || descriptor.type !== PG_WORKSPACE_DESCRIPTOR_TYPE) {
    throw new Error('Workspace descriptor must have type wingman_workspace_locator');
  }

  const credentialField = containsCredentialLikeField(descriptor);
  if (credentialField) {
    throw new Error(`Workspace descriptor must not include credential field ${credentialField}`);
  }

  const identity = descriptor.identity && typeof descriptor.identity === 'object'
    ? descriptor.identity
    : descriptor;
  const towerBaseUrl = normalizeTowerBaseUrl(
    descriptor.tower_base_url
    || descriptor.towerBaseUrl
    || descriptor.base_url
    || descriptor.baseUrl
    || descriptor.direct_https_url
    || descriptor.directHttpsUrl
  );
  const towerServiceNpub = trimText(identity.tower_service_npub || identity.towerServiceNpub || descriptor.tower_service_npub);
  const workspaceServiceNpub = trimText(identity.workspace_service_npub || identity.workspaceServiceNpub || descriptor.workspace_service_npub);
  const workspaceOwnerNpub = trimText(identity.workspace_owner_npub || identity.workspaceOwnerNpub || descriptor.workspace_owner_npub);
  const workspaceId = trimText(identity.workspace_id || identity.workspaceId || descriptor.workspace_id);
  const appNpub = trimText(identity.app_npub || identity.appNpub || descriptor.app_npub || FLIGHT_DECK_PG_APP_NPUB);

  if (!towerBaseUrl) throw new Error('Workspace descriptor must include tower_base_url');
  if (!workspaceId) throw new Error('Workspace descriptor must include identity.workspace_id');
  if (!workspaceOwnerNpub) throw new Error('Workspace descriptor must include identity.workspace_owner_npub');
  if (!workspaceServiceNpub) throw new Error('Workspace descriptor must include identity.workspace_service_npub');

  const links = descriptor.links && typeof descriptor.links === 'object' ? descriptor.links : {};
  const capabilities = Array.isArray(descriptor.capabilities)
    ? descriptor.capabilities.map((entry) => trimText(entry)).filter(Boolean)
    : [];
  const label = trimText(descriptor.label || descriptor.name) || 'Flight Deck workspace';
  const description = trimText(descriptor.description);
  const metadata = descriptor.metadata && typeof descriptor.metadata === 'object' && !Array.isArray(descriptor.metadata)
    ? descriptor.metadata
    : {};

  return {
    type: PG_WORKSPACE_DESCRIPTOR_TYPE,
    version: Number(descriptor.version || 1) || 1,
    towerBaseUrl,
    towerServiceNpub,
    workspaceServiceNpub,
    workspaceOwnerNpub,
    workspaceId,
    appNpub,
    label,
    description,
    metadata,
    capabilities,
    links: {
      ...links,
      descriptor: trimText(links.descriptor),
      me: trimText(links.me),
    },
    createdAt: trimText(descriptor.created_at || descriptor.createdAt),
    raw: descriptor,
  };
}

export function pgWorkspaceIdentityKey(descriptor) {
  const normalized = descriptor?.towerServiceNpub
    ? descriptor
    : parsePgWorkspaceDescriptor(descriptor);
  const session = trimText(normalized.pgSessionNpub || normalized.sessionNpub);
  const tower = trimText(normalized.towerServiceNpub);
  const workspace = trimText(normalized.workspaceServiceNpub);
  const app = trimText(normalized.appNpub || FLIGHT_DECK_PG_APP_NPUB);
  if (!tower || !workspace || !app) return '';
  const identity = `tower:${tower}::workspace:${workspace}::app:${app}`;
  return session ? `pg:${session}::${identity}` : `pg:${identity}`;
}

export function pgWorkspaceSessionNpubFromMe(me, fallback = '') {
  return trimText(
    me?.actor?.npub
    || me?.user?.npub
    || me?.membership?.npub
    || fallback
  );
}

export function pgWorkspaceEntryFromDescriptor(input, options = {}) {
  const descriptor = input?.towerServiceNpub
    ? input
    : parsePgWorkspaceDescriptor(input);
  const pgSessionNpub = trimText(options.sessionNpub)
    || pgWorkspaceSessionNpubFromMe(options.me);
  const workspaceKey = pgWorkspaceIdentityKey({
    ...descriptor,
    pgSessionNpub,
  });
  return {
    workspaceKey,
    workspaceOwnerNpub: descriptor.workspaceOwnerNpub,
    name: descriptor.label,
    slug: options.slug || '',
    description: descriptor.description,
    avatarUrl: null,
    metadata: descriptor.metadata,
    directHttpsUrl: descriptor.towerBaseUrl,
    serviceNpub: descriptor.towerServiceNpub,
    towerServiceNpub: descriptor.towerServiceNpub,
    workspaceServiceNpub: descriptor.workspaceServiceNpub,
    workspaceId: descriptor.workspaceId,
    appNpub: descriptor.appNpub,
    pgSessionNpub,
    pgBackendMode: true,
    pgDescriptor: descriptor.raw || input,
    pgDescriptorVerifiedAt: options.verifiedAt || null,
    pgMe: options.me || null,
    capabilities: descriptor.capabilities,
    connectionToken: '',
  };
}
