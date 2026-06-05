import { describe, expect, it } from 'vitest';
import {
  BACKEND_MODE_ENCRYPTED_RECORDS,
  BACKEND_MODE_TOWER_PG,
  FLIGHT_DECK_BACKEND_MODE,
  FLIGHT_DECK_PG_WORKSPACES_ONLY,
  isEncryptedRecordsBackendMode,
  isPgWorkspacesOnlyMode,
  isTowerPgBackendMode,
  resolveBackendMode,
  resolveConfiguredPgWorkspacesOnly,
  resolveConfiguredBackendMode,
} from '../src/backend-mode.js';
import {
  APP_BASELINE,
  APP_VARIANT,
  FLIGHT_DECK_BACKEND_MODE as APP_IDENTITY_BACKEND_MODE,
  FLIGHT_DECK_PG_WORKSPACES_ONLY as APP_IDENTITY_PG_WORKSPACES_ONLY,
} from '../src/app-identity.js';

describe('backend mode resolution', () => {
  it('keeps the raw backend mode encrypted but defaults this rewrite to PG-only workspaces', () => {
    expect(resolveBackendMode()).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveConfiguredBackendMode({})).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(FLIGHT_DECK_BACKEND_MODE).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(resolveConfiguredPgWorkspacesOnly({})).toBe(true);
    expect(FLIGHT_DECK_PG_WORKSPACES_ONLY).toBe(true);
    expect(isTowerPgBackendMode()).toBe(true);
    expect(isEncryptedRecordsBackendMode()).toBe(false);
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

  it('allows the PG-only workspace gate to be disabled explicitly for debugging', () => {
    expect(resolveConfiguredPgWorkspacesOnly({ VITE_FLIGHT_DECK_PG_WORKSPACES_ONLY: 'false' }))
      .toBe(false);
    expect(isPgWorkspacesOnlyMode(false)).toBe(false);
    expect(isTowerPgBackendMode('encrypted-records', { pgWorkspacesOnly: false })).toBe(false);
    expect(isEncryptedRecordsBackendMode('encrypted-records', { pgWorkspacesOnly: false })).toBe(true);
  });

  it('exposes boolean helpers at the backend boundary', () => {
    expect(isTowerPgBackendMode('tower-pg', { pgWorkspacesOnly: false })).toBe(true);
    expect(isTowerPgBackendMode('encrypted-records', { pgWorkspacesOnly: false })).toBe(false);
    expect(isEncryptedRecordsBackendMode('encrypted-records', { pgWorkspacesOnly: false })).toBe(true);
    expect(isEncryptedRecordsBackendMode('tower-pg', { pgWorkspacesOnly: false })).toBe(false);
  });

  it('keeps the app identity marked as the PG classic migration copy', () => {
    expect(APP_VARIANT).toBe('wm-fd-2');
    expect(APP_BASELINE).toBe('pg-classic');
    expect(APP_IDENTITY_BACKEND_MODE).toBe(BACKEND_MODE_ENCRYPTED_RECORDS);
    expect(APP_IDENTITY_PG_WORKSPACES_ONLY).toBe(true);
  });
});
