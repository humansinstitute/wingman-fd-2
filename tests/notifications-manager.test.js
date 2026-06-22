import { describe, expect, it } from 'vitest';

import { buildSubscriptionBody, notificationsManagerMixin } from '../src/notifications-manager.js';

function makeNotificationStore(overrides = {}) {
  return Object.assign(Object.create(notificationsManagerMixin), {
    notificationCurrentEndpoint: '',
    notificationDevices: [],
    notificationPreferences: {},
    notificationVapidPublicKey: '',
    ...overrides,
  });
}

describe('notificationsManagerMixin', () => {
  it('builds Tower PG push subscription bodies with top-level Web Push fields', () => {
    const store = makeNotificationStore({
      appBuildId: 'build-1256',
      currentWorkspace: {
        workspaceId: 'workspace-1',
        directHttpsUrl: 'https://tower.example',
      },
      currentWorkspaceName: 'Tower workspace',
      currentWorkspaceKey: 'workspace-key',
      currentPgActorId: 'actor-1',
      session: { npub: 'npub1actor' },
    });
    const subscription = {
      endpoint: 'https://push.example/subscription',
      expirationTime: null,
      toJSON() {
        return {
          endpoint: this.endpoint,
          keys: {
            p256dh: 'p256dh-key',
            auth: 'auth-key',
          },
        };
      },
    };

    const body = buildSubscriptionBody(store, subscription);

    expect(body).toMatchObject({
      endpoint: 'https://push.example/subscription',
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-key',
      },
      app_version: 'build-1256',
      workspace_context: {
        workspace_id: 'workspace-1',
        workspace_name: 'Tower workspace',
        workspace_key: 'workspace-key',
        actor_id: 'actor-1',
        actor_npub: 'npub1actor',
      },
    });
    expect(body.subscription).toBeUndefined();
    expect(body.device).toBeUndefined();
  });

  it('marks the current browser by endpoint when Tower does not flag it', () => {
    const store = makeNotificationStore({ notificationCurrentEndpoint: 'https://push.example/current' });

    store.applyNotificationSettings({
      preferences: { mentions: true },
      vapid_public_key: 'public-key',
      subscriptions: [
        {
          id: 'older-device',
          endpoint: 'https://push.example/old',
          device_label: 'Old phone',
        },
        {
          id: 'current-device',
          endpoint: 'https://push.example/current',
          device_label: 'This phone',
        },
      ],
    });

    expect(store.notificationCurrentDevice).toMatchObject({
      id: 'current-device',
      label: 'This phone',
      isCurrent: true,
    });
  });

  it('normalizes missing preference keys to the V1 defaults', () => {
    const store = makeNotificationStore();

    store.applyNotificationSettings({
      preferences: { channel_threads: true, dms: false },
    });

    expect(store.notificationPreferences).toEqual({
      channel_threads: true,
      mentions: true,
      dms: false,
      comment_tags: true,
      task_assignments: true,
    });
  });

  it('normalizes Tower PG notification preference fields to UI keys', () => {
    const store = makeNotificationStore();

    store.applyNotificationSettings({
      preferences: {
        chat_threads_enabled: true,
        mentions_enabled: false,
        dms_enabled: true,
        comment_tags_enabled: false,
        task_assignments_enabled: true,
      },
    });

    expect(store.notificationPreferences).toEqual({
      channel_threads: true,
      mentions: false,
      dms: true,
      comment_tags: false,
      task_assignments: true,
    });
  });
});
