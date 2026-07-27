-- Token revocation handle. Bumping tokenVersion invalidates every JWT previously issued to
-- the user (their token carries the version it was signed under). Set on password change/reset.
ALTER TABLE "users" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
