import { describe, expect, it } from 'vitest';
import { FLIGHT_DECK_PG_APP_NPUB } from '../src/app-identity.js';
import { buildAgentConnectPackage } from '../src/agent-connect.js';

const workspace = {
  workspaceId: 'workspace-1',
  workspaceOwnerNpub: 'npub1owner',
  workspaceServiceNpub: 'npub1workspace',
  directHttpsUrl: 'https://tower.example',
  towerServiceNpub: 'npub1tower',
  serviceNpub: 'npub1tower',
  name: 'Wingers',
  pgBackendMode: true,
  capabilities: ['pg_scopes', 'pg_tasks'],
  pgDescriptor: {
    type: 'wingman_workspace_locator',
    version: 1,
    tower_base_url: 'https://tower.example',
    identity: {
      tower_service_npub: 'npub1tower',
      workspace_service_npub: 'npub1workspace',
      workspace_owner_npub: 'npub1owner',
      workspace_id: 'workspace-1',
      app_npub: FLIGHT_DECK_PG_APP_NPUB,
    },
    label: 'Wingers',
    capabilities: ['pg_scopes', 'pg_tasks'],
    links: {
      descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
      me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
      scopes: '/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
      events: '/api/v4/flightdeck-pg/workspaces/workspace-1/events',
    },
  },
};

describe('buildAgentConnectPackage', () => {
  it('builds a minimal Postgres agent package with live service urls', () => {
    const pkg = buildAgentConnectPackage({
      windowOrigin: 'https://open-cap-rose.wm21.otherstuff.ai',
      backendUrl: 'https://tower.example',
      session: {
        npub: 'npub1user',
        pubkey: 'a'.repeat(64),
      },
      workspace,
    });

    expect(pkg).toMatchObject({
      kind: 'coworker_agent_connect',
      version: 6,
      protocol: 'flightdeck_pg',
      llms_url: 'https://open-cap-rose.wm21.otherstuff.ai/llms.txt',
      service: {
        direct_https_url: 'https://tower.example',
        openapi_url: 'https://tower.example/openapi.json',
        docs_url: 'https://tower.example/docs',
        health_url: 'https://tower.example/health',
      },
      auth: {
        scheme: 'NIP-98',
        app_header: 'x-flightdeck-pg-app-npub',
        app_npub: FLIGHT_DECK_PG_APP_NPUB,
      },
      workspace_descriptor: {
        type: 'wingman_workspace_locator',
        tower_base_url: 'https://tower.example',
        identity: {
          tower_service_npub: 'npub1tower',
          workspace_service_npub: 'npub1workspace',
          workspace_owner_npub: 'npub1owner',
          workspace_id: 'workspace-1',
          app_npub: FLIGHT_DECK_PG_APP_NPUB,
        },
      },
    });
    expect(pkg.workspace_descriptor.links).toMatchObject({
      descriptor: '/api/v4/flightdeck-pg/workspaces/workspace-1/descriptor',
      me: '/api/v4/flightdeck-pg/workspaces/workspace-1/me',
      scopes: '/api/v4/flightdeck-pg/workspaces/workspace-1/scopes',
      events: '/api/v4/flightdeck-pg/workspaces/workspace-1/events',
    });
    expect(pkg.connection_token).toBeUndefined();
    expect(pkg.record_link_model).toBeUndefined();
    expect(pkg.workspace).toBeUndefined();
    expect(pkg.notes).toBeUndefined();
  });

  it('falls back to PG workspace fields without creating a legacy token', () => {
    const pkg = buildAgentConnectPackage({
      backendUrl: 'https://tower.example',
      session: { npub: 'npub1owner' },
      workspace: {
        workspaceId: 'workspace-2',
        workspaceOwnerNpub: 'npub1owner',
        workspaceServiceNpub: 'npub1workspace2',
        directHttpsUrl: 'https://tower.example/',
        towerServiceNpub: 'npub1tower',
        appNpub: FLIGHT_DECK_PG_APP_NPUB,
        name: 'Second workspace',
        capabilities: ['pg_docs'],
      },
    });

    expect(pkg.workspace_descriptor).toMatchObject({
      type: 'wingman_workspace_locator',
      tower_base_url: 'https://tower.example',
      label: 'Second workspace',
      identity: {
        workspace_id: 'workspace-2',
        workspace_owner_npub: 'npub1owner',
        workspace_service_npub: 'npub1workspace2',
      },
    });
    expect(pkg.workspace_descriptor.capabilities).toEqual(['pg_docs']);
    expect(pkg.connection_token).toBeUndefined();
  });
});
