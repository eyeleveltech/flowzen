-- The money assistant's Gemini key, and which model it asks.
--
-- On the organisation rather than in the environment so it can be changed from
-- Settings without a deploy. Nullable because most organisations will not have
-- one, and the assistant says so plainly rather than failing.
--
-- The key is write-only across the wire: GET /config never returns it. The
-- browser is told only whether one is set.
ALTER TABLE "organizations" ADD COLUMN "geminiApiKey" TEXT;
ALTER TABLE "organizations" ADD COLUMN "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash';
