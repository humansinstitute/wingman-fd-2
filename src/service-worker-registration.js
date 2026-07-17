const RUNNING_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const IS_DEV = import.meta.env.DEV;
export const NOTIFICATION_CLICK_MESSAGE_TYPE = 'flightdeck:notification-click';

let registrationPromise = null;
let reloadOnControllerChange = false;
let controllerListenerRegistered = false;
let controllerReloadFallbackId = null;

function ensureControllerReloadListener() {
  if (controllerListenerRegistered || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  controllerListenerRegistered = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnControllerChange) return;
    reloadOnControllerChange = false;
    if (controllerReloadFallbackId) {
      window.clearTimeout(controllerReloadFallbackId);
      controllerReloadFallbackId = null;
    }
    window.location.reload();
  });
}

async function requestWaitingWorkerActivation(registration) {
  if (!registration?.waiting) return false;
  reloadOnControllerChange = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  if (typeof window !== 'undefined') {
    if (controllerReloadFallbackId) window.clearTimeout(controllerReloadFallbackId);
    controllerReloadFallbackId = window.setTimeout(() => {
      if (!reloadOnControllerChange) return;
      reloadOnControllerChange = false;
      controllerReloadFallbackId = null;
      window.location.reload();
    }, 1500);
  }
  return true;
}

async function waitForInstallingWorker(registration, timeoutMs = 3000) {
  const worker = registration?.installing;
  if (!worker) return false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('statechange', handleStateChange);
      resolve(value);
    };
    const handleStateChange = async () => {
      if (worker.state === 'installed' && registration.waiting) {
        finish(await requestWaitingWorkerActivation(registration));
        return;
      }
      if (worker.state === 'activated' || worker.state === 'redundant') {
        finish(false);
      }
    };

    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
    window.setTimeout(() => finish(false), timeoutMs);
  });
}

export async function registerBuildServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || IS_DEV) {
    return null;
  }
  if (registrationPromise) return registrationPromise;

  ensureControllerReloadListener();
  registrationPromise = navigator.serviceWorker.register(
    `/service-worker.js?build=${encodeURIComponent(RUNNING_BUILD_ID)}`,
    { updateViaCache: 'none' },
  ).catch(() => null);

  return registrationPromise;
}

export function installNotificationClickRouteHandler(getStore = () => window.Alpine?.store?.('chat')) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  const handler = (event) => {
    const message = event?.data;
    if (!message || message.type !== NOTIFICATION_CLICK_MESSAGE_TYPE) return;
    const rawUrl = String(message.url || '').trim();
    if (!rawUrl) return;
    let target;
    try {
      target = new URL(rawUrl, window.location.origin);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin) return;
    const nextUrl = `${target.pathname}${target.search}${target.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState({ source: 'notification-click' }, '', nextUrl);
    const store = getStore?.();
    Promise.resolve(store?.applyRouteFromLocation?.()).catch((error) => {
      console.warn('[flightdeck] notification click route failed', error);
    });
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

export async function forceRefreshToLatestBuild() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || IS_DEV) {
    window.location.reload();
    return;
  }

  ensureControllerReloadListener();
  const registration = await (registrationPromise || registerBuildServiceWorker());
  if (!registration) {
    window.location.reload();
    return;
  }

  await registration.update().catch(() => undefined);
  if (await requestWaitingWorkerActivation(registration)) return;
  if (await waitForInstallingWorker(registration)) return;
  window.location.reload();
}
