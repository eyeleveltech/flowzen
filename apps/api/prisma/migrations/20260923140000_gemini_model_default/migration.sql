-- The default model was a name that no longer exists.
--
-- `gemini-2.0-flash` was picked from memory when the assistant was built, and
-- Google has since retired it: a key listing its models today offers 2.5 and
-- above. Every organisation created before this carries that dead name, and
-- the only symptom is a 404 at the moment somebody asks a question.
--
-- `gemini-flash-latest` is an alias Google keeps pointing at the current flash
-- model, so it does not go stale the way a pinned version does. Settings now
-- also offers whatever the key itself reports, which is the real fix -- this
-- migration is so nobody has to go and do that before the thing works at all.
UPDATE "organizations" SET "geminiModel" = 'gemini-flash-latest'
  WHERE "geminiModel" = 'gemini-2.0-flash';

ALTER TABLE "organizations" ALTER COLUMN "geminiModel" SET DEFAULT 'gemini-flash-latest';
