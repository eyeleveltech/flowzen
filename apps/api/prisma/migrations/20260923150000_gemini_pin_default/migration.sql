-- Pin the default model rather than track an alias.
--
-- The previous default was `gemini-flash-latest`, chosen because an alias does
-- not go stale the way a pinned version does. Tested against a real key it
-- returned 503 twice in a row while `gemini-2.5-flash` answered immediately on
-- the same key, seconds apart -- so the alias itself is unhealthy, and an
-- assistant that reports "Gemini is busy" every time reads as broken.
--
-- A pinned name will eventually be retired, which is exactly the bug this
-- whole sequence started with. The difference is that Settings now lists what
-- the key can actually call, so a stale default is two clicks to fix instead
-- of a name nobody could guess.
UPDATE "organizations" SET "geminiModel" = 'gemini-2.5-flash'
  WHERE "geminiModel" IN ('gemini-flash-latest', 'gemini-2.0-flash');

ALTER TABLE "organizations" ALTER COLUMN "geminiModel" SET DEFAULT 'gemini-2.5-flash';
