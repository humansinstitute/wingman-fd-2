import { describe, expect, it } from 'vitest';
import { generateLocalIdentity } from '../src/auth/nostr.js';
import {
  ONBOARDING_ANNOUNCEMENT_KIND,
  ONBOARDING_PROTOCOL,
  buildOnboardingAnnouncementPayload,
  buildUnsignedOnboardingAnnouncementEvent,
  decryptOnboardingAnnouncementEvent,
  flightDeckOnboardingAppPubkeyHex,
  publishOnboardingAnnouncement,
  queryOnboardingAnnouncementCandidates,
  validateOnboardingAnnouncementPayload,
} from '../src/nostr-onboarding-announcements.js';

const issuer = generateLocalIdentity();
const recipient = generateLocalIdentity();
const app = generateLocalIdentity();
const appPubkeyHex = flightDeckOnboardingAppPubkeyHex(app.npub);

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOwnerNpub: 'npub1owner',
  workspaceServiceNpub: 'npub1workspace',
  directHttpsUrl: 'https://tower.example',
  towerServiceNpub: 'npub1tower',
  serviceNpub: 'npub1tower',
  name: 'Wingers',
  relayUrls: ['wss://relay.test'],
  pgBackendMode: true,
};

const agentConnect = {
  kind: 'coworker_agent_connect',
  version: 5,
  generated_at: '2026-06-07T00:00:00.000Z',
  llms_url: 'https://fd.example/llms.txt',
  service: {
    direct_https_url: 'https://tower.example',
    service_npub: 'npub1tower',
    relay_urls: ['wss://relay.test'],
  },
  workspace: {
    owner_npub: 'npub1owner',
  },
  app: {
    app_npub: app.npub,
    app_pubkey: app.pubkey,
  },
  connection_token: 'encrypted-payload-only-token',
  notes: [],
};

async function validPayload(overrides = {}) {
  return buildOnboardingAnnouncementPayload({
    recipientNpub: recipient.npub,
    issuedByNpub: issuer.npub,
    workspace,
    agentConnect,
    appNpub: app.npub,
    appPubkeyHex,
    now: new Date('2026-06-07T00:00:00.000Z'),
    ...overrides,
  });
}

describe('Nostr kind 33357 onboarding announcements', () => {
  it('builds a valid event with only p/app_pub/protocol cleartext tags', async () => {
    let signedTemplate = null;
    const result = await publishOnboardingAnnouncement({
      recipientNpub: recipient.npub,
      issuerNpub: issuer.npub,
      issuerPubkeyHex: issuer.pubkey,
      workspace,
      agentConnect,
      relayUrls: ['wss://relay.test'],
      appNpub: app.npub,
      appPubkeyHex,
      encryptForNpub: async (npub, plaintext) => `enc:${npub}:${plaintext}`,
      signEvent: async (event) => {
        signedTemplate = event;
        return { ...event, id: 'event-1', sig: 'sig' };
      },
      poolFactory: () => ({
        publish(relays) {
          return relays.map(() => Promise.resolve('ok'));
        },
        destroy() {},
      }),
      now: new Date('2026-06-07T00:00:00.000Z'),
    });

    expect(result.event.kind).toBe(ONBOARDING_ANNOUNCEMENT_KIND);
    expect(signedTemplate.tags).toEqual([
      ['p', recipient.pubkey],
      ['app_pub', appPubkeyHex],
      ['protocol', ONBOARDING_PROTOCOL],
    ]);
    expect(signedTemplate.content.startsWith(`enc:${recipient.npub}:`)).toBe(true);
    const tagsText = JSON.stringify(signedTemplate.tags);
    expect(tagsText).not.toContain('tower.example');
    expect(tagsText).not.toContain('Wingers');
    expect(tagsText).not.toContain('connection_token');
    expect(tagsText).not.toContain('scope');
    expect(tagsText).not.toContain('channel');
    expect(tagsText).not.toContain('group');

    const payload = JSON.parse(signedTemplate.content.split(':').slice(2).join(':'));
    expect(payload).toMatchObject({
      type: 'flightdeck_onboarding',
      version: 1,
      protocol: 'onboarding',
      recipient_npub: recipient.npub,
      app: {
        app_npub: app.npub,
        app_pubkey: appPubkeyHex,
      },
      workspace: {
        owner_npub: 'npub1owner',
        workspace_service_npub: 'npub1workspace',
        workspace_id: 'workspace-1',
      },
      agent_connect: {
        kind: 'coworker_agent_connect',
        connection_token: 'encrypted-payload-only-token',
      },
      grant: {
        reason: 'added_to_workspace_or_group',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('channel_id');
    expect(JSON.stringify(payload)).not.toContain('scope_id');
    expect(JSON.stringify(payload)).not.toContain('group_id');
    expect(JSON.stringify(payload)).not.toContain('task_id');
    expect(JSON.stringify(payload)).not.toContain('doc_id');
  });

  it('rejects invalid encrypted payload fields', async () => {
    const payload = await validPayload();
    expect(validateOnboardingAnnouncementPayload(payload, {
      recipientNpub: recipient.npub,
      appPubkeyHex,
      now: new Date('2026-06-08T00:00:00.000Z'),
    })).toBe(payload);

    expect(() => validateOnboardingAnnouncementPayload({
      ...payload,
      recipient_npub: issuer.npub,
    }, { recipientNpub: recipient.npub, appPubkeyHex })).toThrow(/recipient mismatch/);

    expect(() => validateOnboardingAnnouncementPayload({
      ...payload,
      app: { ...payload.app, app_pubkey: 'f'.repeat(64) },
    }, { recipientNpub: recipient.npub, appPubkeyHex })).toThrow(/app_pubkey mismatch/);

    expect(() => validateOnboardingAnnouncementPayload({
      ...payload,
      agent_connect: { ...payload.agent_connect, connection_token: '' },
    }, { recipientNpub: recipient.npub, appPubkeyHex })).toThrow(/connection_token/);

    expect(() => validateOnboardingAnnouncementPayload({
      ...payload,
      expires_at: '2026-06-01T00:00:00.000Z',
    }, {
      recipientNpub: recipient.npub,
      appPubkeyHex,
      now: new Date('2026-06-08T00:00:00.000Z'),
    })).toThrow(/stale/);
  });

  it('decrypts candidates and filters relay queries by p, app_pub, and protocol', async () => {
    const payload = await validPayload();
    const event = await buildUnsignedOnboardingAnnouncementEvent({
      recipientNpub: recipient.npub,
      issuerPubkeyHex: issuer.pubkey,
      appPubkeyHex,
      content: `enc:${JSON.stringify(payload)}`,
      createdAt: 1780710000,
    });

    const decoded = await decryptOnboardingAnnouncementEvent({
      event,
      userNpub: recipient.npub,
      userPubkeyHex: recipient.pubkey,
      appPubkeyHex,
      decryptFromNpub: async (senderNpub, ciphertext) => {
        expect(senderNpub).toBe(issuer.npub);
        return ciphertext.slice(4);
      },
      now: new Date('2026-06-08T00:00:00.000Z'),
    });
    expect(decoded.locator).toMatchObject({
      type: 'wingman_workspace_locator',
      tower_base_url: 'https://tower.example',
      identity: {
        workspace_id: 'workspace-1',
        workspace_service_npub: 'npub1workspace',
      },
    });

    let filterSeen = null;
    const result = await queryOnboardingAnnouncementCandidates({
      userNpub: recipient.npub,
      userPubkeyHex: recipient.pubkey,
      appPubkeyHex,
      decryptFromNpub: async (_sender, ciphertext) => ciphertext.slice(4),
      poolFactory: () => ({
        querySync: async (_relays, filter) => {
          filterSeen = filter;
          return [{ ...event, id: 'event-1' }];
        },
        destroy() {},
      }),
      now: new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(filterSeen).toMatchObject({
      kinds: [33357],
      '#p': [recipient.pubkey],
      '#app_pub': [appPubkeyHex],
      '#protocol': ['onboarding'],
    });
    expect(result.candidates).toHaveLength(1);
  });

  it('rejects relay publication when no relay accepts the announcement', async () => {
    await expect(publishOnboardingAnnouncement({
      recipientNpub: recipient.npub,
      issuerNpub: issuer.npub,
      issuerPubkeyHex: issuer.pubkey,
      workspace,
      agentConnect,
      relayUrls: ['wss://relay.test'],
      appNpub: app.npub,
      appPubkeyHex,
      encryptForNpub: async (_npub, plaintext) => `enc:${plaintext}`,
      signEvent: async (event) => ({ ...event, id: 'event-1', sig: 'sig' }),
      poolFactory: () => ({
        publish(relays) {
          return relays.map(() => Promise.reject(new Error('relay rejected')));
        },
        destroy() {},
      }),
    })).rejects.toThrow(/No relay accepted/);
  });
});
