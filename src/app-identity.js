const BUILD_FLIGHT_DECK_PG_APP_NPUB = typeof __FLIGHT_DECK_PG_APP_NPUB__ !== 'undefined'
  ? String(__FLIGHT_DECK_PG_APP_NPUB__ || '').trim()
  : '';

function requireNpub(value, label) {
  const text = String(value || '').trim();
  if (!text.startsWith('npub1')) {
    throw new Error(`${label} must be set to the Flight Deck app npub`);
  }
  return text;
}

export {
  FLIGHT_DECK_BACKEND_MODE,
  FLIGHT_DECK_PG_WORKSPACES_ONLY,
} from './backend-mode.js';

export const APP_VARIANT = 'wm-fd-2';
export const APP_BASELINE = 'pg-classic';
export const FLIGHT_DECK_PG_APP_NPUB = requireNpub(
  BUILD_FLIGHT_DECK_PG_APP_NPUB,
  'FLIGHT_DECK_PG_APP_NPUB',
);
export const APP_NPUB = FLIGHT_DECK_PG_APP_NPUB;
export const APP_NAME = String(import.meta.env.VITE_FLIGHT_DECK_APP_NAME || 'Flight Deck').trim();
export const DEFAULT_SUPERBASED_URL = String(import.meta.env.VITE_DEFAULT_SUPERBASED_URL || '').trim();

export function recordFamilyNamespace() {
  return APP_NPUB;
}
