import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SELF_INDEX_KIND,
  WORKSPACE_SELF_INDEX_PROTOCOL,
  broadcastWorkspaceSelfIndexEvent,
  buildUnsignedWorkspaceSelfIndexEvent,
  decryptWorkspaceSelfIndexEvent,
  flightDeckSelfIndexAppPubkeyHex,
  publishWorkspaceSelfIndex,
  queryWorkspaceSelfIndexCandidates,
} from '../src/nostr-workspace-self-index.js';

const userPubkeyHex = 'a'.repeat(64);
const appPubkeyHex = flightDeckSelfIndexAppPubkeyHex();

const workspace = {
  workspaceKey: 'pg:npub1user::tower:npub1tower::workspace:npub1workspace::app:flightdeck_pg',
  workspaceOwnerNpub: 'npub1owner',
  name: 'Wingers',
  description: 'Private workspace',
  directHttpsUrl: 'https://tower.example',
  towerServiceNpub: 'npub1tower',
  serviceNpub: 'npub1tower',
  workspaceServiceNpub: 'npub1workspace',
  workspaceId: 'workspace-1',
  appNpub: 'flightdeck_pg',
  pgBackendMode: true,
  pgDescriptorVerifiedAt: '2026-06-07T00:00:00.000Z',
  capabilities: ['pg_tasks'],
  pgDescriptor: {
    type: 'wingman_workspace_locator',
    version: 1,
    tower_base_url: 'https://tower.example',
    identity: {
      tower_service_npub: 'npub1tower',
      workspace_service_npub: 'npub1workspace',
      workspace_owner_npub: 'npub1owner',
      workspace_id: 'workspace-1',
      app_npub: 'flightdeck_pg',
    },
    label: 'Wingers',
    description: 'Private workspace',
    capabilities: ['pg_tasks'],
    links: {
      descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
      me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
    },
  },
};

describe('Nostr kind 33356 workspace self-index', () => {
  it('builds an opaque replaceable event without cleartext workspace leaks', async () => {
    const event = await buildUnsignedWorkspaceSelfIndexEvent({
      workspace,
      userNpub: '',
      userPubkeyHex,
      appPubkeyHex,
      content: 'encrypted',
      createdAt: 1780710000,
    });
    const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1];

    expect(event.kind).toBe(WORKSPACE_SELF_INDEX_KIND);
    expect(event.tags).toContainEqual(['protocol', WORKSPACE_SELF_INDEX_PROTOCOL]);
    expect(event.tags).toContainEqual(['app_pub', appPubkeyHex]);
    expect(dTag).toMatch(/^fd-self:[0-9a-f]{64}$/);

    const second = await buildUnsignedWorkspaceSelfIndexEvent({
      workspace,
      userNpub: '',
      userPubkeyHex,
      appPubkeyHex,
      content: 'encrypted-2',
      createdAt: 1780710001,
    });
    expect(second.tags.find((tag) => tag[0] === 'd')?.[1]).toBe(dTag);

    const cleartextTags = JSON.stringify(event.tags);
    expect(cleartextTags).not.toContain('Wingers');
    expect(cleartextTags).not.toContain('tower.example');
    expect(cleartextTags).not.toContain('workspace-1');
  });

  it('publishes an encrypted credential-free workspace locator', async () => {
    let signedTemplate = null;
    let relaysSeen = [];
    const result = await publishWorkspaceSelfIndex({
      workspace: {
        ...workspace,
        connectionToken: 'must-not-appear',
      },
      userPubkeyHex,
      relayUrls: ['wss://relay.test'],
      appPubkeyHex,
      encryptForNpub: async (_npub, plaintext) => `enc:${plaintext}`,
      signEvent: async (event) => {
        signedTemplate = event;
        return { ...event, id: 'event-1', sig: 'sig' };
      },
      poolFactory: () => ({
        publish(relays) {
          relaysSeen = relays;
          return relays.map(() => Promise.resolve('ok'));
        },
        destroy() {},
      }),
      now: new Date('2026-06-07T00:00:00.000Z'),
    });

    expect(result.event.kind).toBe(33356);
    const peteRelays = [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://proxy.nostr-relay.app/8c5723f2601334234e1922d2e842d6bbf209283b07120b3f1d38660915f13793',
      'ws://127.0.0.1:4869',
    ];
    expect(result.acceptedRelays).toEqual(peteRelays);
    expect(relaysSeen).toEqual(peteRelays);
    expect(relaysSeen).not.toContain('wss://relay.test');
    const encrypted = signedTemplate.content;
    expect(encrypted.startsWith('enc:')).toBe(true);
    const payload = JSON.parse(encrypted.slice(4));
    expect(payload.workspace).toMatchObject({
      type: 'wingman_workspace_locator',
      tower_base_url: 'https://tower.example',
      workspace_id: 'workspace-1',
      workspace_service_npub: 'npub1workspace',
    });
    expect(JSON.stringify(payload)).not.toContain('must-not-appear');
  });

  it('rebroadcasts a previously signed self-index event without rebuilding content', async () => {
    const signedEvent = {
      kind: 33356,
      pubkey: userPubkeyHex,
      created_at: 1780710000,
      tags: [
        ['d', 'fd-self:opaque'],
        ['p', userPubkeyHex],
        ['app_pub', appPubkeyHex],
        ['protocol', 'workspace-self-index'],
      ],
      content: 'encrypted',
      id: 'event-existing',
      sig: 'sig-existing',
    };
    let eventSeen = null;
    const result = await broadcastWorkspaceSelfIndexEvent({
      event: signedEvent,
      workspace,
      relayUrls: ['wss://relay.test'],
      poolFactory: () => ({
        publish(_relays, event) {
          eventSeen = event;
          return [Promise.resolve('ok')];
        },
        destroy() {},
      }),
      now: new Date('2026-06-09T00:00:00.000Z'),
    });

    expect(eventSeen).toBe(signedEvent);
    expect(result.event).toBe(signedEvent);
    expect(result.publishedAt).toBe('2026-06-09T00:00:00.000Z');
  });

  it('decrypts, ignores tombstones, and deduplicates candidates by workspace identity', async () => {
    const activePayload = {
      type: 'flightdeck_workspace_self_index',
      version: 1,
      state: { deleted: false },
      workspace: workspace.pgDescriptor,
    };
    const deletedPayload = {
      ...activePayload,
      state: { deleted: true },
    };
    const baseEvent = {
      kind: 33356,
      pubkey: userPubkeyHex,
      tags: [
        ['p', userPubkeyHex],
        ['app_pub', appPubkeyHex],
        ['protocol', 'workspace-self-index'],
      ],
    };
    const events = [
      { ...baseEvent, id: 'older', created_at: 1, content: `enc:${JSON.stringify(activePayload)}` },
      { ...baseEvent, id: 'newer', created_at: 2, content: `enc:${JSON.stringify(activePayload)}` },
      { ...baseEvent, id: 'deleted', created_at: 3, content: `enc:${JSON.stringify(deletedPayload)}` },
    ];

    let filterSeen = null;
    const result = await queryWorkspaceSelfIndexCandidates({
      userPubkeyHex,
      appPubkeyHex,
      decryptFromNpub: async (_npub, ciphertext) => ciphertext.slice(4),
      poolFactory: () => ({
        querySync: async (_relays, filter) => {
          filterSeen = filter;
          return events;
        },
        destroy() {},
      }),
    });

    expect(filterSeen).toMatchObject({
      kinds: [33356],
      authors: [userPubkeyHex],
      '#p': [userPubkeyHex],
      '#app_pub': [appPubkeyHex],
    });
    expect(filterSeen).not.toHaveProperty('#protocol');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].event.id).toBe('newer');
    expect(result.candidates[0].locator.workspace_id).toBe('workspace-1');

    const tombstone = await decryptWorkspaceSelfIndexEvent({
      event: events[2],
      userPubkeyHex,
      appPubkeyHex,
      decryptFromNpub: async (_npub, ciphertext) => ciphertext.slice(4),
    });
    expect(tombstone.deleted).toBe(true);
  });
});
