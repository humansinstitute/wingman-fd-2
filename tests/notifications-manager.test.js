import { describe, expect, it } from 'vitest';

import { notificationsManagerMixin } from '../src/notifications-manager.js';

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
});
