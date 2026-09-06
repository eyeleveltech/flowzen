import dotenv from 'dotenv';
import path from 'path';

// Must be imported before any module that reads process.env at module scope (utils/jwt.ts,
// services/email.ts, lib/redis.ts). ES imports are hoisted and evaluated in declaration order,
// so calling dotenv.config() in index.ts's body runs too late — those modules have already
// captured undefined and fallen back to their dev defaults.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

/**
 * Secrets people have actually shipped, plus the one this repo shipped itself.
 *
 * `utils/jwt.ts` and `utils/crypto.ts` both used to end in
 * `|| 'flowzen-production-secure-jwt-secret-key-2026'`. A default like that is
 * worse than no default: the deployment that loses its environment does not
 * fail, it comes up signing sessions with a key that is in the git history —
 * and nothing anywhere says so. Anyone holding this repo could then mint a
 * valid token for any account.
 *
 * The same value also keys the at-rest encryption of an organisation's SMTP
 * password, so the fallback quietly made that reversible too.
 */
const REFUSED = new Set([
  'flowzen-production-secure-jwt-secret-key-2026',
  'changeme',
  'change-me',
  'secret',
  'your-secret-key',
  'development',
  'test',
]);

/** Short enough to brute-force offline is not a secret, whatever it says. */
const MIN_LENGTH = 32;

/**
 * A required secret, or a refusal to start.
 *
 * Failing at boot is the point. A missing secret is a deployment mistake, and
 * the only safe moment to say so is before the first request — not after a
 * fortnight of sessions signed with a key from a public repository.
 */
export function requireSecret(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env — the server will not start without it, ` +
        `because the alternative is signing sessions with a key that is public.`,
    );
  }

  if (REFUSED.has(value.toLowerCase())) {
    throw new Error(
      `${name} is a known placeholder. Generate a real one: ` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }

  if (value.length < MIN_LENGTH) {
    throw new Error(
      `${name} is ${value.length} characters; ${MIN_LENGTH} is the minimum. Generate one: ` +
        `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }

  return value;
}
