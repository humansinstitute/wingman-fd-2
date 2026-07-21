import { describe, expect, it, vi } from 'vitest';

import { refreshNotificationChatRoute } from '../src/service-worker-registration.js';

describe('notification click route refresh', () => {
  it('immediately hydrates the notified Tower PG chat channel', async () => {
    const store = {
      pgBackendMode: true,
      currentWorkspace: { pgBackendMode: true },
    };
    const hydrateTowerPgChannelMessages = vi.fn(async () => []);

    const refreshed = await refreshNotificationChatRoute(
      store,
      'https://flightdeck.example/pete/chat?workspaceid=workspace-1&channelid=channel-1&threadid=thread-1',
      { hydrateTowerPgChannelMessages },
    );

    expect(refreshed).toBe(true);
    expect(hydrateTowerPgChannelMessages).toHaveBeenCalledOnce();
    expect(hydrateTowerPgChannelMessages).toHaveBeenCalledWith(store, 'channel-1');
  });

  it('does not run a remote hydration outside Tower PG chat routes', async () => {
    const hydrateTowerPgChannelMessages = vi.fn(async () => []);

    await expect(refreshNotificationChatRoute(
      { pgBackendMode: false },
      'https://flightdeck.example/pete/chat?channelid=channel-1',
      { hydrateTowerPgChannelMessages },
    )).resolves.toBe(false);
    await expect(refreshNotificationChatRoute(
      { pgBackendMode: true },
      'https://flightdeck.example/pete/tasks?channelid=channel-1&taskid=task-1',
      { hydrateTowerPgChannelMessages },
    )).resolves.toBe(false);

    expect(hydrateTowerPgChannelMessages).not.toHaveBeenCalled();
  });
});
