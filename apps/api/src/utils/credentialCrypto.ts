import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { logger } from './logger.js';

/**
 * At-rest encryption for logins (Credentials plan, decision 3).
 *
 * Its own key, CREDENTIALS_KEY — not JWT_SECRET, which `utils/crypto.ts` is
 * keyed off and which the security plan says to rotate. Rotating the login
 * secret must never make a saved password unreadable, so the two are
 * separate. The key is 32 random bytes, base64, and lives only in the
 * server's .env: a copy of the database alone holds unreadable ciphertext.
 *
 * Read when asked, never at import: a server without the key runs Flowzen
 * as before and the Logins page says "Not set up yet". `requireSecret`
 * would throw at startup, which is the wrong failure for an optional feature.
 *
 * Format: `c1:iv:tag:data`, AES-256-GCM, with the row's id as additional
 * authenticated data — so ciphertext copied onto another row fails to
 * decrypt, and a later format can be told apart by its prefix.
 */

export const FORMAT = 'c1';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/** The key as bytes, or null when it is missing or not 32 base64 bytes. */
export function parseKey(raw: string | undefined | null): Buffer | null {
  const text = raw?.trim();
  if (!text) return null;
  const key = Buffer.from(text, 'base64');
  return key.length === KEY_LENGTH ? key : null;
}

let warned = false;

/** The server's key. Null when unset — and, once, a warning when set but malformed. */
export function credentialsKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_KEY;
  const key = parseKey(raw);
  if (!key && raw?.trim() && !warned) {
    warned = true;
    logger.error('CREDENTIALS_KEY is set but is not 32 base64 bytes; Logins stay switched off. Make one with: openssl rand -base64 32');
  }
  return key;
}

/** The server was started with a key other than the one these rows were saved with — or the row was tampered with. */
export class CredentialKeyMismatch extends Error {
  constructor() {
    super('The credentials key on the server does not match the one used to save these logins.');
    this.name = 'CredentialKeyMismatch';
  }
}

export function encryptWith(key: Buffer, plain: string, rowId: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(rowId, 'utf8'));
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${FORMAT}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptWith(key: Buffer, stored: string, rowId: string): string {
  const [format, ivHex, tagHex, dataHex] = stored.split(':');
  if (format !== FORMAT || !ivHex || !tagHex || dataHex === undefined) throw new CredentialKeyMismatch();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAAD(Buffer.from(rowId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    // GCM refuses a wrong key, a wrong row and a changed byte the same way: at final().
    throw new CredentialKeyMismatch();
  }
}

// ── The key check ────────────────────────────────────────────────────────────

const KEY_CHECK_PLAIN = 'flowzen credentials key check';
const KEY_CHECK_ID = 'credentials-key-check';

/** What `Organization.credentialsKeyCheck` holds: the known value under this key. */
export const makeKeyCheck = (key: Buffer): string => encryptWith(key, KEY_CHECK_PLAIN, KEY_CHECK_ID);

/** Whether this key is the one the check was made with. */
export function keyMatchesCheck(key: Buffer, stored: string): boolean {
  try {
    return decryptWith(key, stored, KEY_CHECK_ID) === KEY_CHECK_PLAIN;
  } catch {
    return false;
  }
}

// ── A generated password ─────────────────────────────────────────────────────

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';

/** 20 characters by default: letters, digits and symbols, at least one of each, no look-alikes. */
export function generatePassword(length = 20): string {
  const all = LETTERS + DIGITS + SYMBOLS;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(LETTERS), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
