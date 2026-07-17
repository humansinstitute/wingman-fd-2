import { forceRefreshToLatestBuild } from './service-worker-registration.js';

const RUNNING_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_REFRESH_STORAGE_PREFIX = 'flightdeck:auto-refresh-attempted:';
const IS_DEV = import.meta.env.DEV;

let updateBanner = null;
let dismissed = false;
let intervalId = null;

export function getRunningBuildId() {
  return RUNNING_BUILD_ID;
}

function autoRefreshStorageKey(buildId) {
  return `${AUTO_REFRESH_STORAGE_PREFIX}${buildId}`;
}

function shouldAutoRefreshBuild(buildId) {
  if (!buildId || typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage?.getItem(autoRefreshStorageKey(buildId)) === '1') return false;
    window.sessionStorage?.setItem(autoRefreshStorageKey(buildId), '1');
    return true;
  } catch {
    return true;
  }
}

async function checkForUpdate() {
  if (dismissed || IS_DEV) return;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.buildId && data.buildId !== RUNNING_BUILD_ID) {
      if (shouldAutoRefreshBuild(data.buildId)) {
        try {
          await forceRefreshToLatestBuild();
          return;
        } catch {}
      }
      showUpdateBanner(data.buildId);
    }
  } catch {}
}

function showUpdateBanner(newBuildId) {
  if (updateBanner) return;
  updateBanner = document.createElement('div');
  updateBanner.className = 'update-banner';
  updateBanner.innerHTML = `
    <span>New version available (${newBuildId})</span>
    <button class="update-banner-btn" data-action="reload">Update now</button>
    <button class="update-banner-btn dismiss" data-action="dismiss">&times;</button>
  `;
  updateBanner.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reload') {
      forceRefreshToLatestBuild().catch(() => {
        location.reload();
      });
    } else if (action === 'dismiss') {
      dismissed = true;
      updateBanner.remove();
      updateBanner = null;
    }
  });
  document.body.prepend(updateBanner);
}

export function startVersionCheck() {
  if (intervalId) return;
  checkForUpdate();
  intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
}
