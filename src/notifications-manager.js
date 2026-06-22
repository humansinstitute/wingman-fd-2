import {
  getTowerPgNotificationSettings,
  revokeTowerPgPushSubscription,
  updateTowerPgNotificationPreferences,
  upsertTowerPgPushSubscription,
} from './api.js';
import { registerBuildServiceWorker } from './service-worker-registration.js';

const NOTIFICATION_CATEGORIES = [
  { key: 'channel_threads', label: 'Channel threads' },
  { key: 'mentions', label: 'Mentions' },
  { key: 'dms', label: 'DMs' },
  { key: 'comment_tags', label: 'Comment tags' },
  { key: 'task_assignments', label: 'Task assignments' },
];

const DEFAULT_PREFERENCES = Object.freeze({
  channel_threads: false,
  mentions: true,
  dms: true,
  comment_tags: true,
  task_assignments: true,
});

function trimText(value) {
  return String(value ?? '').trim();
}

function normalizePreferences(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map(({ key }) => [key, Boolean(source[key] ?? DEFAULT_PREFERENCES[key])]),
  );
}

function normalizeSubscriptionRow(row = {}, { currentEndpoint = '' } = {}) {
  const subscription = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  const id = trimText(subscription.id || subscription.subscription_id || subscription.record_id || subscription.endpoint);
  const endpoint = trimText(subscription.endpoint);
  const cleanCurrentEndpoint = trimText(currentEndpoint);
  return {
    id,
    endpoint,
    label: trimText(subscription.device_label || subscription.label || subscription.name) || 'This browser',
    platform: trimText(subscription.platform || subscription.browser || subscription.user_agent_summary),
    status: trimText(subscription.status) || (subscription.revoked_at ? 'revoked' : 'active'),
    lastSeenAt: trimText(subscription.last_seen_at || subscription.updated_at || subscription.created_at),
    lastSuccessAt: trimText(subscription.last_successful_delivery_at || subscription.last_success_at),
    isCurrent: Boolean(subscription.is_current || subscription.current || (cleanCurrentEndpoint && endpoint === cleanCurrentEndpoint)),
  };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = trimText(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function browserPlatformLabel() {
  if (typeof navigator === 'undefined') return 'Unknown browser';
  const uaData = navigator.userAgentData;
  if (uaData?.platform) return trimText(uaData.platform);
  const userAgent = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS PWA';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Browser';
}

function defaultDeviceLabel() {
  const platform = browserPlatformLabel();
  if (typeof navigator === 'undefined') return platform;
  const brands = navigator.userAgentData?.brands;
  const brand = Array.isArray(brands) && brands[0]?.brand ? brands[0].brand : '';
  return [platform, brand].filter(Boolean).join(' / ') || platform;
}

function serializePushSubscription(subscription) {
  const json = subscription?.toJSON?.() || {};
  return {
    endpoint: trimText(subscription?.endpoint || json.endpoint),
    expiration_time: subscription?.expirationTime || json.expirationTime || null,
    keys: {
      p256dh: trimText(json.keys?.p256dh) || bytesToBase64Url(subscription.getKey('p256dh')),
      auth: trimText(json.keys?.auth) || bytesToBase64Url(subscription.getKey('auth')),
    },
  };
}

function notificationSupportStatus() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission || 'default';
}

function notificationPermissionLabel(status) {
  switch (status || notificationSupportStatus()) {
    case 'granted': return 'Allowed';
    case 'denied': return 'Blocked';
    case 'default': return 'Not set';
    default: return 'Unsupported';
  }
}

function getNotificationContext(store) {
  const workspace = store.currentWorkspace || {};
  const workspaceId = trimText(workspace.workspaceId);
  return {
    workspaceId,
    baseUrl: trimText(workspace.directHttpsUrl || store.currentWorkspaceBackendUrl || store.backendUrl),
    appNpub: trimText(workspace.appNpub),
    workspaceName: trimText(store.currentWorkspaceName || workspace.name),
    workspaceKey: trimText(store.currentWorkspaceKey || workspace.workspaceKey),
    actorId: trimText(store.currentPgActorId),
    actorNpub: trimText(store.session?.npub || workspace.pgSessionNpub || workspace.pgMe?.actor?.npub),
  };
}

function buildSubscriptionBody(store, subscription) {
  const context = getNotificationContext(store);
  return {
    subscription: serializePushSubscription(subscription),
    device: {
      label: defaultDeviceLabel(),
      platform: browserPlatformLabel(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      app_build_id: trimText(store.appBuildId),
      app_display_mode: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches ? 'standalone' : 'browser',
    },
    workspace_context: {
      workspace_id: context.workspaceId,
      workspace_name: context.workspaceName,
      workspace_key: context.workspaceKey,
      actor_id: context.actorId,
      actor_npub: context.actorNpub,
    },
  };
}

export const notificationsManagerMixin = {
  notificationCategories: NOTIFICATION_CATEGORIES,
  notificationPreferences: { ...DEFAULT_PREFERENCES },
  notificationDevices: [],
  notificationPermission: notificationSupportStatus(),
  notificationVapidPublicKey: '',
  notificationBusy: false,
  notificationSaving: false,
  notificationSubscribing: false,
  notificationRevokingId: '',
  notificationCurrentEndpoint: '',
  notificationError: '',
  notificationNotice: '',
  notificationInitializedWorkspaceId: '',

  get notificationsSupported() {
    return notificationSupportStatus() !== 'unsupported';
  },

  get notificationPermissionLabel() {
    return notificationPermissionLabel(this.notificationPermission);
  },

  get notificationCurrentDevice() {
    return this.notificationDevices.find((device) => device.isCurrent) || null;
  },

  get notificationActiveDevices() {
    return (this.notificationDevices || []).filter((device) => device.status !== 'revoked');
  },

  get notificationCanSubscribe() {
    const context = getNotificationContext(this);
    return Boolean(this.notificationsSupported && context.workspaceId && context.baseUrl && this.notificationVapidPublicKey);
  },

  async openNotificationsSettings() {
    this.navigateTo('settings');
    this.openSettingsTab?.('notifications');
    await this.refreshNotificationSettings();
  },

  async refreshNotificationSettings() {
    const context = getNotificationContext(this);
    this.notificationPermission = notificationSupportStatus();
    this.notificationError = '';
    this.notificationNotice = '';
    if (!context.workspaceId || !context.baseUrl) {
      this.notificationError = 'Flight Deck PG workspace is not connected.';
      return;
    }
    this.notificationBusy = true;
    try {
      const result = await getTowerPgNotificationSettings(context.workspaceId, {
        baseUrl: context.baseUrl,
        appNpub: context.appNpub || undefined,
      });
      this.applyNotificationSettings(result);
      this.notificationInitializedWorkspaceId = context.workspaceId;
    } catch (error) {
      this.notificationError = error?.message || 'Notification settings are not available from Tower yet.';
    } finally {
      this.notificationBusy = false;
    }
  },

  applyNotificationSettings(result = {}) {
    const preferences = result.preferences || result.notification_preferences || result.workspace_preferences || {};
    const subscriptions = result.subscriptions || result.devices || result.push_subscriptions || [];
    this.notificationPreferences = normalizePreferences(preferences);
    this.notificationDevices = Array.isArray(subscriptions)
      ? subscriptions
        .map((row) => normalizeSubscriptionRow(row, { currentEndpoint: this.notificationCurrentEndpoint }))
        .filter((row) => row.id || row.endpoint)
      : [];
    this.notificationVapidPublicKey = trimText(result.vapid_public_key || result.vapidPublicKey || result.application_server_key);
  },

  async setNotificationPreference(category, enabled) {
    const key = trimText(category);
    if (!NOTIFICATION_CATEGORIES.some((item) => item.key === key)) return;
    const context = getNotificationContext(this);
    if (!context.workspaceId || !context.baseUrl) {
      this.notificationError = 'Flight Deck PG workspace is not connected.';
      return;
    }
    const nextPreferences = {
      ...normalizePreferences(this.notificationPreferences),
      [key]: Boolean(enabled),
    };
    this.notificationPreferences = nextPreferences;
    this.notificationSaving = true;
    this.notificationError = '';
    this.notificationNotice = '';
    try {
      const result = await updateTowerPgNotificationPreferences(context.workspaceId, nextPreferences, {
        baseUrl: context.baseUrl,
        appNpub: context.appNpub || undefined,
      });
      this.applyNotificationSettings({
        ...result,
        preferences: result.preferences || nextPreferences,
        subscriptions: result.subscriptions || this.notificationDevices,
        vapid_public_key: result.vapid_public_key || this.notificationVapidPublicKey,
      });
      this.notificationNotice = 'Notification preferences saved.';
    } catch (error) {
      this.notificationError = error?.message || 'Could not save notification preferences.';
    } finally {
      this.notificationSaving = false;
    }
  },

  async enablePushNotifications() {
    const context = getNotificationContext(this);
    this.notificationError = '';
    this.notificationNotice = '';
    if (!this.notificationsSupported) {
      this.notificationError = 'This browser does not support Web Push notifications.';
      return;
    }
    if (!context.workspaceId || !context.baseUrl) {
      this.notificationError = 'Flight Deck PG workspace is not connected.';
      return;
    }
    if (!this.notificationVapidPublicKey) {
      await this.refreshNotificationSettings();
    }
    if (!this.notificationVapidPublicKey) {
      this.notificationError = 'Tower has not published a Web Push application server key yet.';
      return;
    }
    this.notificationSubscribing = true;
    try {
      const permission = await Notification.requestPermission();
      this.notificationPermission = permission;
      if (permission !== 'granted') {
        this.notificationError = permission === 'denied'
          ? 'Browser notifications are blocked for Flight Deck.'
          : 'Notification permission was not granted.';
        return;
      }
      const registration = await registerBuildServiceWorker();
      if (!registration) throw new Error('Service worker registration is not available.');
      await registration.update().catch(() => undefined);
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(this.notificationVapidPublicKey),
      });
      this.notificationCurrentEndpoint = trimText(subscription.endpoint);
      const result = await upsertTowerPgPushSubscription(context.workspaceId, buildSubscriptionBody(this, subscription), {
        baseUrl: context.baseUrl,
        appNpub: context.appNpub || undefined,
      });
      this.applyNotificationSettings({
        ...result,
        preferences: result.preferences || this.notificationPreferences,
        subscriptions: result.subscriptions || result.devices || this.notificationDevices,
        vapid_public_key: result.vapid_public_key || this.notificationVapidPublicKey,
      });
      this.notificationNotice = 'This browser is registered for Flight Deck notifications.';
    } catch (error) {
      this.notificationError = error?.message || 'Could not enable notifications.';
    } finally {
      this.notificationSubscribing = false;
    }
  },

  async revokeNotificationDevice(device) {
    const context = getNotificationContext(this);
    const row = normalizeSubscriptionRow(device);
    if (!context.workspaceId || !context.baseUrl || (!row.id && !row.endpoint)) return;
    this.notificationError = '';
    this.notificationNotice = '';
    this.notificationRevokingId = row.id || row.endpoint;
    try {
      await revokeTowerPgPushSubscription(context.workspaceId, row.id, {
        endpoint: row.endpoint,
        baseUrl: context.baseUrl,
        appNpub: context.appNpub || undefined,
      });
      if (row.isCurrent && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        const subscription = await registration?.pushManager?.getSubscription?.();
        await subscription?.unsubscribe?.().catch(() => undefined);
        this.notificationCurrentEndpoint = '';
      }
      this.notificationDevices = this.notificationDevices.filter((item) => item.id !== row.id && item.endpoint !== row.endpoint);
      this.notificationNotice = 'Notification device revoked.';
    } catch (error) {
      this.notificationError = error?.message || 'Could not revoke notification device.';
    } finally {
      this.notificationRevokingId = '';
    }
  },
};
