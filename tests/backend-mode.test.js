import { describe, expect, it } from 'vitest';
import {
  BACKEND_MODE_ENCRYPTED_RECORDS,
  BACKEND_MODE_TOWER_PG,
  FLIGHT_DECK_BACKEND_MODE,
  isEncryptedRecordsBackendMode,
  isTowerPgBackendMode,
  resolveBackendMode,
  resolveConfiguredBackendMode,
} from '../src/backend-mode.js';
import {
  APP_BASELINE,
  APP_VARIANT,
  FLIGHT_DECK_BACKEND_MODE as APP_IDENTITY_BACKEND_MODE,
} from '../src/app-identity.js';

describe('backend mode resolution', () => {
  it('defaults to encrypted records when no mode is configured', () => {
    expect(resolveBackendMode()).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveConfiguredBackendMode({})).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(FLIGHT_DECK_BACKEND_MODE).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
  });

  it('requires an explicit PG mode configuration to select Tower PG', () => {
    expect(resolveBackendMode('tower-pg')).toBe(BACKEND_MODE_TOWER_PG);
    expect(resolveConfiguredBackendMode({ VITE_FLIGHT_DECK_BACKEND_MODE: 'tower-pg' }))
      .toBe(BACKEND_MODE_TOWER_PG);
    expect(resolveConfiguredBackendMode({ VITE_FLIGHTDECK_BACKEND_MODE: 'pg' }))
      .toBe(BACKEND_MODE_TOWER_PG);
  });

  it('normalizes casing, whitespace, and aliases', () => {
    expect(resolveBackendMode(' TOWER-POSTGRES ')).toBe(BACKEND_MODE_TOWER_PG);
    expect(resolveBackendMode('superbased')).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveBackendMode(' encrypted-record ')).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
  });

  it('falls back to encrypted records for unknown values', () => {
    expect(resolveBackendMode('')).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveBackendMode('something-else')).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveConfiguredBackendMode({ VITE_FLIGHT_DECK_BACKEND_MODE: 'invalid' }))
      .toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
  });

  it('exposes boolean helpers at the backend boundary', () => {
    expect(isTowerPgBackendMode('tower-pg')).toBe(true);
    expect(isTowerPgBackendMode('encrypted-records')).toBe(false);
    expect(isEncryptedRecordsBackendMode('encrypted-records')).toBe(true);
    expect(isEncryptedRecordsBackendMode('tower-pg')).toBe(false);
  });

  it('keeps the app identity marked as the PG classic migration copy', () => {
    expect(APP_VARIANT).toBe('wm-fd-2');
    expect(APP_BASELINE).toBe('pg-classic');
    expect(APP_IDENTITY_BACKEND_MODE).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
  });
});
