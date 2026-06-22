import { describe, expect, it } from 'vitest';

import {
  avatarConnectionLabel,
  avatarConnectionTitle,
  resolveAvatarConnectionStatus,
} from '../src/components/avatar-status.js';

describe('avatar status component state', () => {
  it('returns Tower PG connected status for online connected PG workspaces', () => {
    const store = {
      isTowerPgMode: true,
      currentWorkspace: { pgBackendMode: true },
      backendUrl: 'https://tower.example',
      session: { npub: 'npub1user' },
    };

    expect(resolveAvatarConnectionStatus(store, { navigator: { onLine: true } })).toBe('tower-pg-connected');
    expect(avatarConnectionLabel({ ...store, avatarConnectionStatus: 'tower-pg-connected' })).toBe('Tower Connected (PG)');
  });

  it('returns syncing status while PG connection work is active', () => {
    expect(resolveAvatarConnectionStatus({
      isTowerPgMode: true,
      currentWorkspace: { pgBackendMode: true },
      backendUrl: 'https://tower.example',
      session: { npub: 'npub1user' },
      connectWorkspacesBusy: true,
    }, { navigator: { onLine: true } })).toBe('syncing');
  });

  it('returns local-only status for offline PG workspaces', () => {
    expect(resolveAvatarConnectionStatus({
      isTowerPgMode: true,
      currentWorkspace: { pgBackendMode: true },
      backendUrl: 'https://tower.example',
      session: { npub: 'npub1user' },
    }, { navigator: { onLine: false } })).toBe('local-only');
  });

  it('returns error status for failed PG background updates', () => {
    const store = {
      isTowerPgMode: true,
      currentWorkspace: { pgBackendMode: true },
      backendUrl: 'https://tower.example',
      session: { npub: 'npub1user' },
      syncStatus: 'error',
    };

    expect(resolveAvatarConnectionStatus(store, { navigator: { onLine: true } })).toBe('error');
    expect(avatarConnectionLabel({ ...store, avatarConnectionStatus: 'error' })).toBe('Update Error');
  });

  it('keeps encrypted-record sync labels unchanged outside PG mode', () => {
    const store = { isTowerPgMode: false, syncStatus: 'unsynced' };

    expect(resolveAvatarConnectionStatus(store)).toBe('unsynced');
    expect(avatarConnectionLabel(store)).toBe('Pending');
    expect(avatarConnectionTitle(store)).toBe('Local changes pending');
  });
});
