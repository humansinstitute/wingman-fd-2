import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupRefs, payload) =>
    groupRefs.map((group_id) => ({ group_id, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { APP_NPUB } from '../src/app-identity.js';
import { inboundWapp, outboundWapp, recordFamilyHash } from '../src/translators/wapps.js';

describe('wapp translator', () => {
  it('materializes inbound WApp records into local rows', async () => {
    const row = await inboundWapp({
      record_id: 'wapp-record-1',
      owner_npub: 'npub_owner',
      version: 2,
      created_at: '2026-05-14T00:00:00.000Z',
      updated_at: '2026-05-14T00:01:00.000Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'wapp',
          schema_version: 1,
          record_id: 'wapp-record-1',
          data: {
            title: 'Budget Builder',
            description: 'Prepare a scope budget.',
            owner_npub: 'npub_owner',
            wapp_id: 'wapp-budget',
            app_id: 'app-budget',
            launch_url: 'https://apps.example.test/budget',
            source_wingman_url: null,
            workspace_owner_npub: 'npub_workspace',
            scope_id: 'scope-project',
            scope_l1_id: 'scope-product',
            scope_l2_id: 'scope-project',
            scope_l3_id: null,
            scope_l4_id: null,
            scope_l5_id: null,
            status: 'active',
            schedule: {
              timezone: 'UTC',
              starts_at: '2026-05-14T00:00:00.000Z',
              ends_at: null,
              windows: [{ days: [1, 5], start_time: '06:00', end_time: '12:00' }],
            },
            record_state: 'active',
          },
        }),
      },
      group_payloads: [
        { group_id: 'group-1', group_npub: 'npub_group_1', ciphertext: '{}' },
      ],
    });

    expect(row).toMatchObject({
      record_id: 'wapp-record-1',
      owner_npub: 'npub_owner',
      title: 'Budget Builder',
      wapp_id: 'wapp-budget',
      app_id: 'app-budget',
      launch_url: 'https://apps.example.test/budget',
      workspace_owner_npub: 'npub_workspace',
      scope_id: 'scope-project',
      scope_l1_id: 'scope-product',
      scope_l2_id: 'scope-project',
      status: 'active',
      schedule: {
        timezone: 'UTC',
        starts_at: '2026-05-14T00:00:00.000Z',
        ends_at: null,
        windows: [{ days: [1, 5], start_time: '06:00', end_time: '12:00' }],
      },
      sync_status: 'synced',
      record_state: 'active',
      version: 2,
    });
    expect(row.group_ids).toEqual(['group-1']);
  });

  it('builds outbound WApp envelopes for schema validation', async () => {
    const envelope = await outboundWapp({
      record_id: 'wapp-record-1',
      owner_npub: 'npub_owner',
      title: 'Budget Builder',
      description: 'Prepare a scope budget.',
      wapp_id: 'wapp-budget',
      app_id: 'app-budget',
      launch_url: 'https://apps.example.test/budget',
      source_wingman_url: null,
      workspace_owner_npub: 'npub_workspace',
      scope_id: 'scope-project',
      scope_l1_id: 'scope-product',
      scope_l2_id: 'scope-project',
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      status: 'archived',
      schedule: {
        timezone: 'UTC',
        windows: [{ days: [5], start_time: '18:00', end_time: '22:00' }],
      },
      group_ids: ['group-1'],
    });

    expect(envelope.record_family_hash).toBe(recordFamilyHash('wapp'));
    expect(envelope.owner_npub).toBe('npub_workspace');
    expect(envelope.group_payloads).toHaveLength(1);
    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.collection_space).toBe('wapp');
    expect(payload.data.owner_npub).toBe('npub_owner');
    expect(payload.data.title).toBe('Budget Builder');
    expect(payload.data.launch_url).toBe('https://apps.example.test/budget');
    expect(payload.data.status).toBe('archived');
    expect(payload.data.schedule).toEqual({
      timezone: 'UTC',
      starts_at: null,
      ends_at: null,
      windows: [{ days: [5], start_time: '18:00', end_time: '22:00' }],
    });
  });

  it('rejects non-http launch URLs', async () => {
    await expect(outboundWapp({
      record_id: 'wapp-record-1',
      owner_npub: 'npub_owner',
      title: 'Bad App',
      wapp_id: 'bad',
      app_id: 'bad',
      launch_url: 'javascript:alert(1)',
      workspace_owner_npub: 'npub_workspace',
    })).rejects.toThrow(/launch_url/);
  });

  it('preserves deleted WApp tombstones', async () => {
    const row = await inboundWapp({
      record_id: 'wapp-record-1',
      owner_npub: 'npub_owner',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'wapp',
          schema_version: 1,
          record_id: 'wapp-record-1',
          data: {
            title: 'Budget Builder',
            owner_npub: 'npub_owner',
            wapp_id: 'wapp-budget',
            app_id: 'app-budget',
            launch_url: 'https://apps.example.test/budget',
            workspace_owner_npub: 'npub_workspace',
            record_state: 'deleted',
          },
        }),
      },
      group_payloads: [],
    });

    expect(row.record_state).toBe('deleted');
  });
});
