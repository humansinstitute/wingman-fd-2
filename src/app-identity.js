const DEFAULT_APP_NPUB = 'npub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5';
const BUILD_FLIGHT_DECK_PG_APP_NPUB = typeof __FLIGHT_DECK_PG_APP_NPUB__ !== 'undefined'
  ? String(__FLIGHT_DECK_PG_APP_NPUB__ || '').trim()
  : '';
const DEFAULT_FLIGHT_DECK_PG_APP_NPUB = BUILD_FLIGHT_DECK_PG_APP_NPUB || DEFAULT_APP_NPUB;

function normalizeNpub(value, fallback = '') {
  const text = String(value || '').trim();
  return text.startsWith('npub1') ? text : fallback;
}

export {
  FLIGHT_DECK_BACKEND_MODE,
  FLIGHT_DECK_PG_WORKSPACES_ONLY,
} from './backend-mode.js';

export const APP_VARIANT = 'wm-fd-2';
export const APP_BASELINE = 'pg-classic';
export const APP_NPUB = normalizeNpub(import.meta.env.VITE_COWORKER_APP_NPUB, DEFAULT_APP_NPUB);
export const FLIGHT_DECK_PG_APP_NPUB = normalizeNpub(
  import.meta.env.VITE_FLIGHT_DECK_PG_APP_NPUB
  || import.meta.env.VITE_FLIGHTDECK_PG_APP_NPUB
  || DEFAULT_FLIGHT_DECK_PG_APP_NPUB,
  DEFAULT_FLIGHT_DECK_PG_APP_NPUB,
);
export const APP_NAME = String(import.meta.env.VITE_COWORKER_APP_NAME || 'Flight Deck').trim();
export const DEFAULT_SUPERBASED_URL = String(import.meta.env.VITE_DEFAULT_SUPERBASED_URL || '').trim();

export function recordFamilyNamespace() {
  return APP_NPUB;
}
