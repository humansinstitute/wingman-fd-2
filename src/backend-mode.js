export const BACKEND_MODE_ENCRYPTED_RECORDS = 'encrypted-records';
export const BACKEND_MODE_TOWER_PG = 'tower-pg';

export const BACKEND_MODES = Object.freeze([
  BACKEND_MODE_ENCRYPTED_RECORDS,
  BACKEND_MODE_TOWER_PG,
]);

const BACKEND_MODE_ALIASES = Object.freeze({
  'encrypted-records': BACKEND_MODE_ENCRYPTED_RECORDS,
  'encrypted-record': BACKEND_MODE_ENCRYPTED_RECORDS,
  encrypted: BACKEND_MODE_ENCRYPTED_RECORDS,
  records: BACKEND_MODE_ENCRYPTED_RECORDS,
  legacy: BACKEND_MODE_ENCRYPTED_RECORDS,
  superbased: BACKEND_MODE_ENCRYPTED_RECORDS,
  'superbased-records': BACKEND_MODE_ENCRYPTED_RECORDS,
  'tower-pg': BACKEND_MODE_TOWER_PG,
  'tower-postgres': BACKEND_MODE_TOWER_PG,
  postgres: BACKEND_MODE_TOWER_PG,
  pg: BACKEND_MODE_TOWER_PG,
});

function normalizeModeValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function resolveBackendMode(value, options = {}) {
  const defaultMode = BACKEND_MODE_ALIASES[normalizeModeValue(options.defaultMode)]
    || BACKEND_MODE_ENCRYPTED_RECORDS;
  const mode = normalizeModeValue(value);
  if (!mode) return defaultMode;
  return BACKEND_MODE_ALIASES[mode] || defaultMode;
}

export function resolveConfiguredBackendMode(env = import.meta.env) {
  return resolveBackendMode(
    env?.VITE_FLIGHT_DECK_BACKEND_MODE ?? env?.VITE_FLIGHTDECK_BACKEND_MODE
  );
}

export function isTowerPgBackendMode(mode = FLIGHT_DECK_BACKEND_MODE) {
  return resolveBackendMode(mode) === BACKEND_MODE_TOWER_PG;
}

export function isEncryptedRecordsBackendMode(mode = FLIGHT_DECK_BACKEND_MODE) {
  return resolveBackendMode(mode) === BACKEND_MODE_ENCRYPTED_RECORDS;
}

export const FLIGHT_DECK_BACKEND_MODE = resolveConfiguredBackendMode();
