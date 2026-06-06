const DEFAULT_APP_NPUB = 'npub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5';
const DEFAULT_FLIGHT_DECK_PG_APP_NPUB = 'flightdeck_pg';

export {
  FLIGHT_DECK_BACKEND_MODE,
  FLIGHT_DECK_PG_WORKSPACES_ONLY,
} from './backend-mode.js';

export const APP_VARIANT = 'wm-fd-2';
export const APP_BASELINE = 'pg-classic';
export const APP_NPUB = String(import.meta.env.VITE_COWORKER_APP_NPUB || DEFAULT_APP_NPUB).trim();
export const FLIGHT_DECK_PG_APP_NPUB = String(
  import.meta.env.VITE_FLIGHT_DECK_PG_APP_NPUB
  || import.meta.env.VITE_FLIGHTDECK_PG_APP_NPUB
  || DEFAULT_FLIGHT_DECK_PG_APP_NPUB
).trim();
export const APP_NAME = String(import.meta.env.VITE_COWORKER_APP_NAME || 'Flight Deck').trim();
export const DEFAULT_SUPERBASED_URL = String(import.meta.env.VITE_DEFAULT_SUPERBASED_URL || '').trim();

export function recordFamilyNamespace() {
  return APP_NPUB;
}
