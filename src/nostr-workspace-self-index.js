import { SimplePool } from 'nostr-tools';
import { APP_NPUB, FLIGHT_DECK_PG_APP_NPUB } from './app-identity.js';
import {
  decodeNpub,
  personalDecryptFromNpub,
  personalEncryptForNpub,
  pubkeyToNpub,
  signNostrEvent,
} from './auth/nostr.js';
import { parsePgWorkspaceDescriptor } from './pg-workspace-descriptor.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';

export const WORKSPACE_SELF_INDEX_KIND = 33356;
export const WORKSPACE_SELF_INDEX_PROTOCOL = 'workspace-self-index';
export const WORKSPACE_SELF_INDEX_PAYLOAD_TYPE = 'flightdeck_workspace_self_index';
export const WORKSPACE_SELF_INDEX_NAMESPACE = 'flightdeck_pg';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://proxy.nostr-relay.app/8c5723f2601334234e1922d2e842d6bbf209283b07120b3f1d38660915f13793',
  'ws://127.0.0.1:4869',
];

function trimText(value) {
  return String(value ?? '').trim();
}

function envSelfIndexRelays() {
  return String(import.meta.env?.VITE_FLIGHT_DECK_SELF_INDEX_RELAYS || '')
    .split(',')
    .map((entry) => trimText(entry))
    .filter(Boolean);
}

export function workspaceSelfIndexRelayUrls(...relayLists) {
  const configuredRelays = envSelfIndexRelays();
  const relays = (configuredRelays.length > 0 ? configuredRelays : DEFAULT_RELAYS)
    .map((entry) => trimText(entry))
    .filter(Boolean);
  return [...new Set(relays)];
}

export function normalizeNostrPubkeyHex(value) {
  const text = trimText(value);
  if (/^[0-9a-f]{64}$/i.test(text)) return text.toLowerCase();
  if (text.startsWith('npub1')) return decodeNpub(text).toLowerCase();
  throw new Error('Nostr pubkey must be hex or npub.');
}

export function flightDeckSelfIndexAppPubkeyHex(appNpub = APP_NPUB) {
  return normalizeNostrPubkeyHex(appNpub || APP_NPUB);
}

async function sha256Hex(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function workspaceSelfIndexDTag({
  userPubkeyHex,
  appPubkeyHex,
  towerServiceNpub,
  workspaceId,
}) {
  const input = [
    'v1',
    trimText(userPubkeyHex).toLowerCase(),
    trimText(appPubkeyHex).toLowerCase(),
    trimText(towerServiceNpub),
    trimText(workspaceId),
  ].join(':');
  return `fd-self:${await sha256Hex(input)}`;
}

function descriptorInputFromWorkspace(workspace = {}) {
  if (workspace.type === 'wingman_workspace_locator') {
    return workspace;
  }
  if (workspace.pgDescriptor) {
    return {
      ...workspace.pgDescriptor,
      tower_base_url: workspace.pgDescriptor.tower_base_url || workspace.directHttpsUrl,
    };
  }
  return {
    type: 'wingman_workspace_locator',
    version: 1,
    tower_base_url: workspace.directHttpsUrl,
    identity: {
      tower_service_npub: workspace.towerServiceNpub || workspace.serviceNpub,
      workspace_service_npub: workspace.workspaceServiceNpub,
      workspace_owner_npub: workspace.workspaceOwnerNpub,
      workspace_id: workspace.workspaceId,
      app_npub: workspace.appNpub || FLIGHT_DECK_PG_APP_NPUB,
    },
    label: workspace.name,
    description: workspace.description,
    capabilities: Array.isArray(workspace.capabilities) ? workspace.capabilities : [],
    links: workspace.links || workspace.pgDescriptor?.links || {},
  };
}

export function buildWorkspaceSelfIndexLocator(workspace = {}) {
  const descriptor = parsePgWorkspaceDescriptor(descriptorInputFromWorkspace(workspace));
  return {
    type: 'wingman_workspace_locator',
    version: descriptor.version || 1,
    tower_base_url: normalizeBackendUrl(descriptor.towerBaseUrl),
    tower_service_npub: descriptor.towerServiceNpub,
    workspace_id: descriptor.workspaceId,
    workspace_service_npub: descriptor.workspaceServiceNpub,
    workspace_owner_npub: descriptor.workspaceOwnerNpub,
    app_npub: descriptor.appNpub || FLIGHT_DECK_PG_APP_NPUB,
    label: descriptor.label,
    description: descriptor.description || '',
    capabilities: Array.isArray(descriptor.capabilities) ? descriptor.capabilities : [],
    links: {
      descriptor: trimText(descriptor.links?.descriptor),
      me: trimText(descriptor.links?.me),
      scopes: trimText(descriptor.links?.scopes),
      events: trimText(descriptor.links?.events),
    },
  };
}

export async function buildWorkspaceSelfIndexPayload({
  workspace,
  userNpub,
  appNpub = APP_NPUB,
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(appNpub),
  now = new Date(),
}) {
  const issuedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const locator = buildWorkspaceSelfIndexLocator(workspace);
  return {
    type: WORKSPACE_SELF_INDEX_PAYLOAD_TYPE,
    version: 1,
    issued_at: issuedAt,
    updated_at: issuedAt,
    user_npub: userNpub,
    app: {
      app_npub: appNpub,
      app_pubkey: appPubkeyHex,
      namespace: WORKSPACE_SELF_INDEX_NAMESPACE,
    },
    workspace: locator,
    verification: {
      last_verified_at: workspace.pgDescriptorVerifiedAt || issuedAt,
      verified_by: 'flightdeck',
      tower_service_npub: locator.tower_service_npub,
    },
    state: {
      deleted: false,
    },
  };
}

export async function buildUnsignedWorkspaceSelfIndexEvent({
  workspace,
  userNpub,
  userPubkeyHex,
  content,
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(),
  createdAt = Math.floor(Date.now() / 1000),
}) {
  const locator = buildWorkspaceSelfIndexLocator(workspace);
  const dTag = await workspaceSelfIndexDTag({
    userPubkeyHex,
    appPubkeyHex,
    towerServiceNpub: locator.tower_service_npub,
    workspaceId: locator.workspace_id,
  });
  return {
    kind: WORKSPACE_SELF_INDEX_KIND,
    pubkey: userPubkeyHex,
    created_at: createdAt,
    tags: [
      ['d', dTag],
      ['p', userPubkeyHex],
      ['app_pub', appPubkeyHex],
      ['protocol', WORKSPACE_SELF_INDEX_PROTOCOL],
      ['v', '1'],
    ],
    content,
  };
}

function tagValue(event, name) {
  return (event?.tags || []).find((tag) => tag?.[0] === name)?.[1] || '';
}

function assertNoCleartextLeaks(event) {
  const text = JSON.stringify(event.tags || []);
  if (/https?:\/\//i.test(text)) throw new Error('Workspace self-index tags must not contain URLs.');
}

export async function publishWorkspaceSelfIndex({
  workspace,
  userNpub,
  userPubkeyHex,
  relayUrls = [],
  appNpub = APP_NPUB,
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(appNpub),
  encryptForNpub = personalEncryptForNpub,
  signEvent = signNostrEvent,
  poolFactory = () => new SimplePool(),
  now = new Date(),
} = {}) {
  const pubkeyHex = normalizeNostrPubkeyHex(userPubkeyHex || decodeNpub(userNpub));
  const npub = userNpub || await pubkeyToNpub(pubkeyHex);
  const payload = await buildWorkspaceSelfIndexPayload({
    workspace,
    userNpub: npub,
    appNpub,
    appPubkeyHex,
    now,
  });
  const plaintext = JSON.stringify(payload);
  const encrypted = await encryptForNpub(npub, plaintext);
  const unsigned = await buildUnsignedWorkspaceSelfIndexEvent({
    workspace,
    userNpub: npub,
    userPubkeyHex: pubkeyHex,
    appPubkeyHex,
    content: encrypted,
    createdAt: Math.floor(new Date(now).getTime() / 1000),
  });
  assertNoCleartextLeaks(unsigned);
  const signed = await signEvent(unsigned);
  return broadcastWorkspaceSelfIndexEvent({
    event: signed,
    relayUrls,
    workspace,
    poolFactory,
    now,
    payload,
  });
}

export async function broadcastWorkspaceSelfIndexEvent({
  event,
  relayUrls = [],
  workspace = {},
  poolFactory = () => new SimplePool(),
  now = new Date(),
  payload = null,
} = {}) {
  if (!event || Number(event.kind) !== WORKSPACE_SELF_INDEX_KIND) {
    throw new Error('A signed kind 33356 workspace self-index event is required.');
  }
  assertNoCleartextLeaks(event);
  const relays = workspaceSelfIndexRelayUrls(relayUrls, workspace.relayUrls || []);
  const pool = poolFactory();
  try {
    const results = await Promise.allSettled(pool.publish(relays, event, { maxWait: 2500 }));
    const acceptedRelays = [];
    const failedRelays = [];
    results.forEach((result, index) => {
      const relay = relays[index];
      if (result.status === 'fulfilled') acceptedRelays.push(relay);
      else failedRelays.push({ relay, error: result.reason?.message || String(result.reason || 'publish failed') });
    });
    if (acceptedRelays.length === 0) throw new Error('No relay accepted the workspace self-index event.');
    return {
      event,
      payload,
      acceptedRelays,
      failedRelays,
      publishedAt: new Date(now).toISOString(),
    };
  } finally {
    if (typeof pool.destroy === 'function') pool.destroy();
    else if (typeof pool.close === 'function') pool.close(relays);
  }
}

export async function queryWorkspaceSelfIndexEvents({
  userPubkeyHex,
  relayUrls = [],
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(),
  poolFactory = () => new SimplePool(),
  maxWait = 2500,
} = {}) {
  const pubkeyHex = normalizeNostrPubkeyHex(userPubkeyHex);
  const relays = workspaceSelfIndexRelayUrls(relayUrls);
  const filter = {
    kinds: [WORKSPACE_SELF_INDEX_KIND],
    authors: [pubkeyHex],
    '#p': [pubkeyHex],
    '#app_pub': [appPubkeyHex],
    limit: 100,
  };
  const pool = poolFactory();
  try {
    return await pool.querySync(relays, filter, { maxWait });
  } finally {
    if (typeof pool.destroy === 'function') pool.destroy();
    else if (typeof pool.close === 'function') pool.close(relays);
  }
}

export function workspaceSelfIndexIdentityKey(locator = {}, appPubkeyHex = '') {
  return [
    trimText(appPubkeyHex || locator.app_pubkey || locator.app_npub),
    trimText(locator.tower_service_npub || locator.towerServiceNpub),
    trimText(locator.workspace_id || locator.workspaceId),
    trimText(locator.workspace_service_npub || locator.workspaceServiceNpub),
  ].join('::');
}

export async function decryptWorkspaceSelfIndexEvent({
  event,
  userNpub,
  userPubkeyHex,
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(),
  decryptFromNpub = personalDecryptFromNpub,
} = {}) {
  const pubkeyHex = normalizeNostrPubkeyHex(userPubkeyHex || decodeNpub(userNpub));
  if (event.kind !== WORKSPACE_SELF_INDEX_KIND) throw new Error('Unsupported workspace self-index kind.');
  if (event.pubkey && event.pubkey !== pubkeyHex) throw new Error('Workspace self-index author mismatch.');
  if (tagValue(event, 'p') !== pubkeyHex) throw new Error('Workspace self-index recipient mismatch.');
  if (tagValue(event, 'app_pub') !== appPubkeyHex) throw new Error('Workspace self-index app mismatch.');
  if (tagValue(event, 'protocol') !== WORKSPACE_SELF_INDEX_PROTOCOL) throw new Error('Workspace self-index protocol mismatch.');

  const senderNpub = userNpub || await pubkeyToNpub(pubkeyHex);
  const plaintext = await decryptFromNpub(senderNpub, event.content || '');
  const payload = JSON.parse(plaintext);
  if (payload?.type !== WORKSPACE_SELF_INDEX_PAYLOAD_TYPE || Number(payload.version || 0) !== 1) {
    throw new Error('Invalid workspace self-index payload.');
  }
  if (payload.state?.deleted) {
    return { event, payload, locator: payload.workspace, deleted: true };
  }
  const locator = buildWorkspaceSelfIndexLocator(payload.workspace);
  return {
    event,
    payload,
    locator,
    deleted: false,
    identityKey: workspaceSelfIndexIdentityKey(locator, appPubkeyHex),
  };
}

export async function queryWorkspaceSelfIndexCandidates({
  userNpub,
  userPubkeyHex,
  relayUrls = [],
  appPubkeyHex = flightDeckSelfIndexAppPubkeyHex(),
  poolFactory,
  decryptFromNpub,
} = {}) {
  const events = await queryWorkspaceSelfIndexEvents({
    userPubkeyHex,
    relayUrls,
    appPubkeyHex,
    poolFactory,
  });
  const candidates = [];
  const rejected = [];
  for (const event of events || []) {
    try {
      const candidate = await decryptWorkspaceSelfIndexEvent({
        event,
        userNpub,
        userPubkeyHex,
        appPubkeyHex,
        decryptFromNpub,
      });
      if (candidate.deleted) continue;
      candidates.push(candidate);
    } catch (error) {
      rejected.push({ eventId: event?.id || '', error: error?.message || String(error) });
    }
  }
  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates.sort((a, b) => Number(b.event?.created_at || 0) - Number(a.event?.created_at || 0))) {
    if (!candidate.identityKey || seen.has(candidate.identityKey)) continue;
    seen.add(candidate.identityKey);
    deduped.push(candidate);
  }
  return { candidates: deduped, rejected, events };
}
