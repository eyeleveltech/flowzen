/**
 * The one secret this app stores in its own database.
 *
 * Worth testing because both failure modes are silent. Encryption that does not
 * round-trip loses an organisation's mail password with no error until someone
 * tries to send; encryption that is not authenticated accepts a tampered value
 * and hands whatever falls out to a mail server.
 */

import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, scryptSync } from 'crypto';
import { encryptSecret, decryptSecret } from './crypto.js';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a password', () => {
    const secret = 'hunter2-but-longer-#!£';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('round-trips an empty string rather than throwing', () => {
    // The Mail tab can save a blank password while the host is being set up.
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('never produces the same ciphertext twice', () => {
    // A fresh nonce per write. Otherwise two orgs with the same password are
    // visibly the same password to anybody reading the table.
    const a = encryptSecret('same-password');
    const b = encryptSecret('same-password');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('marks its format, so a reader knows what it is holding', () => {
    expect(encryptSecret('x').startsWith('v2:')).toBe(true);
  });

  it('refuses a tampered ciphertext instead of decrypting to rubbish', () => {
    // The whole reason for GCM over CBC. Flip one byte of the payload and the
    // authentication tag stops matching.
    const stored = encryptSecret('smtp-password');
    const [v, iv, tag, data] = stored.split(':');
    const flipped = (parseInt(data.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
    expect(() => decryptSecret(`${v}:${iv}:${tag}:${flipped}${data.slice(2)}`)).toThrow();
  });

  it('refuses a swapped authentication tag', () => {
    const stored = encryptSecret('smtp-password');
    const [v, iv, , data] = stored.split(':');
    const otherTag = encryptSecret('something-else').split(':')[2];
    expect(() => decryptSecret(`${v}:${iv}:${otherTag}:${data}`)).toThrow();
  });

  it('still reads a value written by the old unauthenticated format', () => {
    // Anything already in a database predates v2. It has to stay readable, or
    // upgrading the code silently breaks an org's outbound mail.
    const key = scryptSync(process.env.JWT_SECRET!, 'flowzen-smtp', 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const legacy = Buffer.concat([cipher.update('old-password', 'utf8'), cipher.final()]);

    expect(decryptSecret(`${iv.toString('hex')}:${legacy.toString('hex')}`)).toBe('old-password');
  });
});
