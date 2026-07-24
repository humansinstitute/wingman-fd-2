import { beforeEach, describe, expect, it } from 'vitest';

import {
  CREDENTIAL_RECOVERY_STORAGE_KEY,
  clearCredentials,
  getStoredCredentials,
  refreshCredentialExpiry,
  storeCredentials,
} from '../src/auth/secure-store.js';

describe('secure auth credential recovery', () => {
  beforeEach(async () => {
    await clearCredentials();
  });

  it('restores direct nsec credentials from the recovery copy', async () => {
    localStorage.setItem(CREDENTIAL_RECOVERY_STORAGE_KEY, JSON.stringify({
      method: 'secret',
      pubkey: 'a'.repeat(64),
      secretHex: 'b'.repeat(64),
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() - 1,
    }));

    await expect(getStoredCredentials()).resolves.toMatchObject({
      method: 'secret',
      pubkey: 'a'.repeat(64),
      secretHex: 'b'.repeat(64),
    });
  });

  it('stores an extension recovery identity and removes it on logout', async () => {
    await storeCredentials({
      method: 'extension',
      pubkey: 'c'.repeat(64),
      authEvent: { id: 'login-event' },
    });

    expect(JSON.parse(localStorage.getItem(CREDENTIAL_RECOVERY_STORAGE_KEY))).toMatchObject({
      method: 'extension',
      pubkey: 'c'.repeat(64),
    });

    await clearCredentials();
    expect(localStorage.getItem(CREDENTIAL_RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it('refreshes recovery expiry without requiring IndexedDB', async () => {
    localStorage.setItem(CREDENTIAL_RECOVERY_STORAGE_KEY, JSON.stringify({
      method: 'extension',
      pubkey: 'd'.repeat(64),
      expiresAt: 1,
    }));

    await refreshCredentialExpiry();

    const recovered = JSON.parse(localStorage.getItem(CREDENTIAL_RECOVERY_STORAGE_KEY));
    expect(recovered.expiresAt).toBeGreaterThan(Date.now());
  });
});
