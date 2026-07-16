import { describe, expect, it } from 'vitest';

import { slugify, findWorkspaceById, findWorkspaceBySlug, normalizeWorkspaceEntry } from '../src/workspaces.js';
import { buildSectionUrl, parseRouteLocation } from '../src/route-helpers.js';

describe('slugify', () => {
  it('converts a workspace name to a URL-safe slug', () => {
    expect(slugify('Be Free')).toBe('be-free');
  });

  it('handles accented characters', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('collapses multiple non-alpha chars', () => {
    expect(slugify('My  !!  Workspace')).toBe('my-workspace');
  });

  it('returns "workspace" for empty/blank input', () => {
    expect(slugify('')).toBe('workspace');
    expect(slugify('   ')).toBe('workspace');
    expect(slugify(null)).toBe('workspace');
    expect(slugify(undefined)).toBe('workspace');
  });

  it('handles purely numeric names', () => {
    expect(slugify('123')).toBe('123');
  });
});

describe('normalizeWorkspaceEntry slug field', () => {
  it('derives slug from name when no slug provided', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
      name: 'Be Free',
    });
    expect(ws.slug).toBe('be-free');
  });

  it('preserves explicit slug when provided', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
      name: 'Be Free',
      slug: 'my-custom-slug',
    });
    expect(ws.slug).toBe('my-custom-slug');
  });

  it('falls back to "workspace" when name is empty and no slug', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
    });
    expect(ws.slug).toBe('workspace');
  });
});

describe('findWorkspaceBySlug', () => {
  const workspaces = [
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1a', name: 'Be Free' }),
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1b', name: 'Other Stuff' }),
  ];

  it('finds a workspace by its slug', () => {
    const found = findWorkspaceBySlug(workspaces, 'be-free');
    expect(found).not.toBeNull();
    expect(found.workspaceOwnerNpub).toBe('npub1a');
  });

  it('finds the second workspace', () => {
    const found = findWorkspaceBySlug(workspaces, 'other-stuff');
    expect(found).not.toBeNull();
    expect(found.workspaceOwnerNpub).toBe('npub1b');
  });

  it('returns null for unknown slug', () => {
    expect(findWorkspaceBySlug(workspaces, 'nope')).toBeNull();
  });

  it('returns null for empty/null slug', () => {
    expect(findWorkspaceBySlug(workspaces, '')).toBeNull();
    expect(findWorkspaceBySlug(workspaces, null)).toBeNull();
  });

  it('returns null for non-array workspaces', () => {
    expect(findWorkspaceBySlug(null, 'be-free')).toBeNull();
  });
});

describe('findWorkspaceById', () => {
  const workspaces = [
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1a', name: 'Be Free', workspace_id: 'workspace-a' }),
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1b', name: 'Other Stuff', workspaceId: 'workspace-b' }),
  ];

  it('finds a workspace by Tower PG workspace id', () => {
    const found = findWorkspaceById(workspaces, 'workspace-b');
    expect(found).not.toBeNull();
    expect(found.workspaceOwnerNpub).toBe('npub1b');
  });

  it('returns null for missing workspace ids', () => {
    expect(findWorkspaceById(workspaces, 'missing')).toBeNull();
    expect(findWorkspaceById(workspaces, '')).toBeNull();
  });
});

describe('parseRouteLocation', () => {
  const base = 'http://localhost:5173';

  it('parses root / as flight deck with no slug', () => {
    const route = parseRouteLocation(`${base}/`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBeNull();
  });

  it('parses bare /<page> as backward compat (no slug)', () => {
    const route = parseRouteLocation(`${base}/tasks`);
    expect(route.section).toBe('tasks');
    expect(route.workspaceSlug).toBeNull();
  });

  it('parses /<slug>/<page> correctly', () => {
    const route = parseRouteLocation(`${base}/be-free/tasks`);
    expect(route.section).toBe('tasks');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('maps flight-deck page to status section', () => {
    const route = parseRouteLocation(`${base}/be-free/flight-deck`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('parses workroom detail page routes as a dedicated workroom page', () => {
    const route = parseRouteLocation(`${base}/be-free/workroom/room-123?scopeid=scope-1`);
    expect(route.section).toBe('workroom');
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.params.workroomid).toBe('room-123');
    expect(route.params.scopeid).toBe('scope-1');
  });

  it('parses plural workroom detail routes for backward-compatible links', () => {
    const route = parseRouteLocation(`${base}/be-free/workrooms/room-456`);
    expect(route.section).toBe('workroom');
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.params.workroomid).toBe('room-456');
  });

  it('parses bare workroom detail routes for backward-compatible links', () => {
    const route = parseRouteLocation(`${base}/workrooms/room-456`);
    expect(route.section).toBe('workroom');
    expect(route.workspaceSlug).toBeNull();
    expect(route.params.workroomid).toBe('room-456');
  });

  it('maps notifications page to status section', () => {
    const route = parseRouteLocation(`${base}/be-free/notifications`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('parses /<slug> alone as workspace root with flight deck default', () => {
    const route = parseRouteLocation(`${base}/be-free`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('status');
  });

  it('extracts query params alongside slug', () => {
    const route = parseRouteLocation(`${base}/be-free/tasks?scopeid=abc&taskid=xyz&sort=modified_desc`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('tasks');
    expect(route.params.scopeid).toBe('abc');
    expect(route.params.taskid).toBe('xyz');
    expect(route.params.sort).toBe('modified_desc');
  });

  it('normalizes disabled opportunity route to status while keeping query params', () => {
    const route = parseRouteLocation(`${base}/be-free/opportunities?opportunityid=opp-1`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('status');
    expect(route.params.opportunityid).toBe('opp-1');
  });

  it('extracts workspace identity hints alongside slug', () => {
    const route = parseRouteLocation(
      `${base}/be-free/chat?workspacekey=${encodeURIComponent('service:npub1ai::workspace:npub1ws')}&workspaceid=workspace-1&channelid=chan-1`,
    );
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('chat');
    expect(route.params.workspacekey).toBe('service:npub1ai::workspace:npub1ws');
    expect(route.params.workspaceid).toBe('workspace-1');
    expect(route.params.channelid).toBe('chan-1');
  });

  it('normalizes disabled report route to status while keeping query params', () => {
    const route = parseRouteLocation(`${base}/be-free/reports?scopeid=abc&reportid=report-1`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('status');
    expect(route.params.scopeid).toBe('abc');
    expect(route.params.reportid).toBe('report-1');
  });

  it('parses enabled known page sections', () => {
    const pages = ['chat', 'tasks', 'docs', 'files', 'settings'];
    for (const page of pages) {
      const route = parseRouteLocation(`${base}/my-ws/${page}`);
      expect(route.workspaceSlug).toBe('my-ws');
      expect(route.section).toBe(page);
    }
  });

  it('normalizes disabled page sections to status', () => {
    const pages = ['reports', 'opportunities', 'people'];
    for (const page of pages) {
      const route = parseRouteLocation(`${base}/my-ws/${page}`);
      expect(route.workspaceSlug).toBe('my-ws');
      expect(route.section).toBe('status');
    }
  });

  it('treats removed Autopilot page as an unknown route', () => {
    const route = parseRouteLocation(`${base}/my-ws/autopilot`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('parses bare /notifications as status section (backward compat)', () => {
    const route = parseRouteLocation(`${base}/notifications`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBeNull();
  });

  it('treats unknown single segment as workspace slug', () => {
    const route = parseRouteLocation(`${base}/my-company`);
    expect(route.workspaceSlug).toBe('my-company');
    expect(route.section).toBe('status');
  });

  it('does not parse the removed Live page as a known section', () => {
    const route = parseRouteLocation(`${base}/my-ws/live`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('does not parse the removed Calendar page as a known section', () => {
    const route = parseRouteLocation(`${base}/my-ws/calendar`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('does not parse the moved Schedules page as a known section', () => {
    const route = parseRouteLocation(`${base}/my-ws/schedules`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('does not parse the moved Scopes page as a known section', () => {
    const route = parseRouteLocation(`${base}/my-ws/scopes`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('does not parse the moved Flows page as a known section', () => {
    const route = parseRouteLocation(`${base}/my-ws/flows`);
    expect(route.workspaceSlug).toBe('my-ws');
    expect(route.section).toBe('status');
  });

  it('handles trailing slashes', () => {
    const route = parseRouteLocation(`${base}/be-free/docs/`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('docs');
  });
});

describe('buildSectionUrl', () => {
  it('builds canonical workroom page routes without query-param workroom ids', () => {
    const url = buildSectionUrl({
      workspaceSlug: 'be-free',
      section: 'workroom',
      scopeid: 'scope-1',
      params: { workroomid: 'room-123' },
    });

    expect(url).toBe('/be-free/workroom/room-123?scopeid=scope-1');
  });
});
