import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const ENCODING = 'base64url';
const PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY env var is not set');

  const buf = Buffer.from(secret, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return buf;
}

/**
 * Encrypt a plaintext string.
 * Returns a prefixed string: "enc:v1:<iv>:<tag>:<ciphertext>"
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString(ENCODING)}:${tag.toString(ENCODING)}:${encrypted.toString(ENCODING)}`;
}

/**
 * Decrypt a previously encrypted string.
 * Throws if the value is not a valid encrypted string or if decryption fails.
 */
export function decrypt(encryptedValue: string): string {
  if (!isEncrypted(encryptedValue)) {
    throw new Error('Value is not an encrypted credential');
  }

  const key = getKey();
  const withoutPrefix = encryptedValue.slice(PREFIX.length);
  const parts = withoutPrefix.split(':');

  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }

  const [ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, ENCODING);
  const tag = Buffer.from(tagB64, ENCODING);
  const ciphertext = Buffer.from(ciphertextB64, ENCODING);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8');
}

/**
 * Returns true if the value is an encrypted credential string.
 */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Given a document, encrypt all fields whose keys are in the provided set.
 * Skips fields that are already encrypted or empty.
 */
export function encryptFields<T extends Record<string, any>>(
  data: T,
  passwordFields: Set<string>
): T {
  const result: Record<string, any> = { ...data };
  for (const key of passwordFields) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0 && !isEncrypted(value)) {
      result[key] = encrypt(value);
    }
  }
  return result as T;
}

/**
 * Given a document, replace all encrypted field values with a masked placeholder.
 * Recurses into nested objects. Serialises ObjectId to hex string.
 * Use this before sending documents to the client.
 */
export function maskEncryptedFields<T extends Record<string, any>>(data: T): T {
  const result: Record<string, any> = { ...data };
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (value instanceof ObjectId) {
      result[key] = value.toHexString();
    } else if (value instanceof Date) {
      // leave Date instances as-is so JSON.stringify serialises them correctly
    } else if (isEncrypted(value)) {
      result[key] = '[encrypted]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = maskEncryptedFields(value);
    }
  }
  return result as T;
}
