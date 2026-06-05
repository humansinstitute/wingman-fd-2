import { describe, expect, it } from 'vitest';

import {
  parsePgWorkspaceDescriptor,
  pgWorkspaceEntryFromDescriptor,
  pgWorkspaceIdentityKey,
} from '../src/pg-workspace-descriptor.js';
import { mergeWorkspaceEntries, normalizeWorkspaceEntry } from '../src/workspaces.js';

function descriptor(overrides = {}) {
  const identityOverrides = overrides.identity || {};
  return {
    type: 'wingman_workspace_locator',
    version: 1,
    identity: {
      tower_service_npub: 'npub1tower',
      workspace_service_npub: 'npub1workspace_service',
      workspace_owner_npub: 'npub1owner',
      workspace_id: 'workspace-1',
      app_npub: 'flightdeck_pg',
      ...identityOverrides,
    },
    tower_base_url: 'https://tower.example.com/',
    label: 'Wingmen',
    description: 'PG workspace',
    capabilities: ['pg_scopes', 'pg_channels'],
    links: {
      descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
      me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'identity')),
  };
}

describe('PG workspace descriptors', () => {
  it('parses a Tower PG workspace locator without credentials', () => {
    const parsed = parsePgWorkspaceDescriptor(JSON.stringify(descriptor()));

    expect(parsed).toMatchObject({
      type: 'wingman_workspace_locator',
      towerBaseUrl: 'https://tower.example.com',
      towerServiceNpub: 'npub1tower',
      workspaceServiceNpub: 'npub1workspace_service',
      workspaceOwnerNpub: 'npub1owner',
      workspaceId: 'workspace-1',
      appNpub: 'flightdeck_pg',
      label: 'Wingmen',
      capabilities: ['pg_scopes', 'pg_channels'],
    });
  });

  it('rejects descriptors that carry auth material', () => {
    expect(() => parsePgWorkspaceDescriptor({
      ...descriptor(),
      token: 'secret',
    })).toThrow(/credential field token/);
  });

  it('materializes a PG descriptor into the existing workspace entry shape', () => {
    const entry = normalizeWorkspaceEntry(pgWorkspaceEntryFromDescriptor(descriptor(), {
      verifiedAt: '2026-06-05T00:00:00.000Z',
      me: { actor: { npub: 'npub1pete' } },
    }));

    expect(entry).toMatchObject({
      workspaceKey: 'pg:npub1pete::tower:npub1tower::workspace:npub1workspace_service::app:flightdeck_pg',
      workspaceOwnerNpub: 'npub1owner',
      name: 'Wingmen',
      directHttpsUrl: 'https://tower.example.com',
      serviceNpub: 'npub1tower',
      towerServiceNpub: 'npub1tower',
      workspaceServiceNpub: 'npub1workspace_service',
      workspaceId: 'workspace-1',
      appNpub: 'flightdeck_pg',
      pgSessionNpub: 'npub1pete',
      pgBackendMode: true,
      pgDescriptorVerifiedAt: '2026-06-05T00:00:00.000Z',
      capabilities: ['pg_scopes', 'pg_channels'],
    });
    expect(entry.connectionToken).toBe('');
    expect(entry.pgMe).toMatchObject({ actor: { npub: 'npub1pete' } });
  });

  it('keeps separate PG workspaces from the same Tower owner and app', () => {
    const first = pgWorkspaceEntryFromDescriptor(descriptor());
    const second = pgWorkspaceEntryFromDescriptor(descriptor({
      identity: {
        workspace_service_npub: 'npub1workspace_service_2',
        workspace_id: 'workspace-2',
      },
      label: 'Wingmen 2',
    }));

    const merged = mergeWorkspaceEntries([], [first, second]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.workspaceKey).sort()).toEqual([
      'pg:tower:npub1tower::workspace:npub1workspace_service::app:flightdeck_pg',
      'pg:tower:npub1tower::workspace:npub1workspace_service_2::app:flightdeck_pg',
    ]);
  });

  it('merges legacy and session-scoped PG cache entries for the same verified signer', () => {
    const legacy = {
      ...pgWorkspaceEntryFromDescriptor(descriptor()),
      workspaceKey: 'pg:npub1tower::workspace:npub1workspace_service::app:flightdeck_pg',
      pgMe: { actor: { npub: 'npub1pete' } },
    };
    const scoped = pgWorkspaceEntryFromDescriptor(descriptor(), {
      me: { actor: { npub: 'npub1pete' } },
    });

    const merged = mergeWorkspaceEntries([legacy], [scoped]);

    expect(merged).toHaveLength(1);
    expect(merged[0].workspaceKey).toBe('pg:npub1pete::tower:npub1tower::workspace:npub1workspace_service::app:flightdeck_pg');
  });

  it('uses the PG identity as the durable selection key', () => {
    expect(pgWorkspaceIdentityKey({
      ...parsePgWorkspaceDescriptor(descriptor()),
      pgSessionNpub: 'npub1pete',
    })).toBe(
      'pg:npub1pete::tower:npub1tower::workspace:npub1workspace_service::app:flightdeck_pg',
    );
  });
});
