import Dexie from 'dexie';

const db = new Dexie('CoworkerV4SecureAuth');

db.version(1).stores({
  credentials: 'id',
  device_keys: 'id',
});

const CRED_ID = 'primary';
const DEVICE_KEY_ID = 'device-key';
const AUTH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
export const CREDENTIAL_RECOVERY_STORAGE_KEY = 'nostr_secure_auth_recovery_v1';

function readRecoveryCredentials() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREDENTIAL_RECOVERY_STORAGE_KEY) || 'null');
    if (!parsed?.method || !parsed?.pubkey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecoveryCredentials(record) {
  try {
    localStorage.setItem(CREDENTIAL_RECOVERY_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // IndexedDB remains the primary credential store when localStorage is unavailable.
  }
}

function clearRecoveryCredentials() {
  try {
    localStorage.removeItem(CREDENTIAL_RECOVERY_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures during logout.
  }
}

function hasDeviceCrypto() {
  return Boolean(
    globalThis.crypto?.subtle
    && typeof globalThis.crypto.subtle.generateKey === 'function'
    && typeof globalThis.crypto.subtle.encrypt === 'function'
    && typeof globalThis.crypto.subtle.decrypt === 'function'
  );
}

async function getOrCreateDeviceKey() {
  const stored = await db.device_keys.get(DEVICE_KEY_ID);
  if (stored?.jwk) {
    return crypto.subtle.importKey(
      'jwk',
      stored.jwk,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  await db.device_keys.put({ id: DEVICE_KEY_ID, jwk });
  return key;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function encryptWithDeviceKey(plaintext) {
  if (!hasDeviceCrypto()) return plaintext;
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(packed);
}

async function decryptWithDeviceKey(payload) {
  if (!hasDeviceCrypto()) return payload;
  const key = await getOrCreateDeviceKey();
  const packed = base64ToBytes(payload);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export async function storeCredentials({ method, pubkey, secretHex, authEvent, bunkerUri }) {
  const recoveryRecord = {
    method,
    pubkey,
    createdAt: Date.now(),
    expiresAt: Date.now() + AUTH_EXPIRY_MS,
  };
  if (secretHex) recoveryRecord.secretHex = secretHex;
  if (authEvent) recoveryRecord.authEvent = authEvent;
  if (bunkerUri) recoveryRecord.bunkerUri = bunkerUri;
  writeRecoveryCredentials(recoveryRecord);

  const record = {
    id: CRED_ID,
    method,
    pubkey,
    createdAt: recoveryRecord.createdAt,
    expiresAt: recoveryRecord.expiresAt,
    storageMode: hasDeviceCrypto() ? 'encrypted' : 'plain',
  };

  if (secretHex) {
    if (hasDeviceCrypto()) record.encryptedSecret = await encryptWithDeviceKey(secretHex);
    else record.secretHex = secretHex;
  }
  if (authEvent) record.authEvent = authEvent;
  if (bunkerUri) {
    if (hasDeviceCrypto()) record.encryptedBunkerUri = await encryptWithDeviceKey(bunkerUri);
    else record.bunkerUri = bunkerUri;
  }

  await db.credentials.put(record);
}

export async function getStoredCredentials() {
  const recoveryRecord = readRecoveryCredentials();
  const record = await db.credentials.get(CRED_ID).catch(() => null);
  if (!record) return recoveryRecord;

  const result = {
    method: record.method,
    pubkey: record.pubkey,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };

  try {
    if (record.secretHex) result.secretHex = record.secretHex;
    if (record.encryptedSecret) result.secretHex = await decryptWithDeviceKey(record.encryptedSecret);
    if (record.authEvent) result.authEvent = record.authEvent;
    if (record.bunkerUri) result.bunkerUri = record.bunkerUri;
    if (record.encryptedBunkerUri) {
      result.bunkerUri = await decryptWithDeviceKey(record.encryptedBunkerUri);
    }
  } catch (error) {
    // A browser/device-key failure must not silently log the user out or erase
    // the only remaining credential. Use the recovery copy when available.
    return recoveryRecord;
  }

  return result;
}

export async function clearCredentials() {
  clearRecoveryCredentials();
  await db.credentials.delete(CRED_ID).catch(() => undefined);
}

export async function refreshCredentialExpiry() {
  const expiresAt = Date.now() + AUTH_EXPIRY_MS;
  const recoveryRecord = readRecoveryCredentials();
  if (recoveryRecord) {
    recoveryRecord.expiresAt = expiresAt;
    writeRecoveryCredentials(recoveryRecord);
  }
  const record = await db.credentials.get(CRED_ID).catch(() => null);
  if (!record) return;
  record.expiresAt = expiresAt;
  await db.credentials.put(record).catch(() => undefined);
}
