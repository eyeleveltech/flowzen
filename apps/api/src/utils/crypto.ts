import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { requireSecret } from '../lib/env.js';

/**
 * At-rest encryption for the one secret this app stores in its own database
 * rather than `.env` — an organisation's own SMTP password, entered through
 * Settings' Mail tab.
 *
 * Keyed off JWT_SECRET rather than a second secret nobody would remember to
 * provision. That is a deliberate trade and it has one consequence worth
 * knowing: ROTATING JWT_SECRET MAKES EVERY STORED SMTP PASSWORD UNREADABLE.
 * Nothing is lost that cannot be re-entered — the Mail tab asks for it again —
 * but the org's outbound mail stops until somebody does, so a rotation is a
 * two-step job, not a one-line one.
 *
 * `requireSecret` refuses a missing or placeholder key. This used to fall back
 * to a string committed to the repository, which meant the encryption was
 * decorative for anybody holding a copy of it.
 */
const key = scryptSync(requireSecret('JWT_SECRET'), 'flowzen-smtp', 32);

/** 96 bits, the nonce size GCM is specified for. */
const IV_LENGTH = 12;

/** Marks the authenticated format, so a legacy value is still readable below. */
const VERSION = 'v2';

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':');

  if (parts[0] === VERSION) {
    // AES-GCM: tampering fails loudly at `final()` rather than decrypting to
    // plausible rubbish, which is the whole reason to prefer it for a value
    // that is handed straight to a mail server.
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  // Unversioned `iv:data` — AES-CBC, unauthenticated, written by the previous
  // version of this file. Read-only: anything saved from here on is v2, so a
  // stored password upgrades itself the next time somebody saves the Mail tab.
  const [ivHex, dataHex] = parts;
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
