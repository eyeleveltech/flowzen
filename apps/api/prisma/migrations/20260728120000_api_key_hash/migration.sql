-- FZ-024: store API keys as SHA-256 hashes, keep a non-secret display prefix.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "keyPrefix" TEXT;

-- Backfill the display prefix from the current (still plaintext) value before we hash it.
UPDATE "api_keys"
SET "keyPrefix" = substring("key" from 1 for 11)
WHERE "keyPrefix" IS NULL;

-- Hash any existing plaintext tokens in place. Raw tokens are minted as 'fz_' + hex, so that
-- prefix distinguishes not-yet-hashed rows from the 64-char hex digests we now store.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE "api_keys"
SET "key" = encode(digest("key", 'sha256'), 'hex')
WHERE "key" LIKE 'fz\_%';
