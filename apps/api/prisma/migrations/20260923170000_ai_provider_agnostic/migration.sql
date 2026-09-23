-- Zen stops being a Gemini client and becomes an AI client.
--
-- The three columns before this were named for one vendor, and so was
-- everything they fed: the request body, the auth header, the SSE parsing, the
-- tool-call shape. Changing provider meant rewriting the service, which is the
-- wrong thing to have to do when a free tier runs out of quota at lunchtime.
--
-- Renamed rather than added-and-copied so there is one column per setting and
-- no window where two disagree. RENAME COLUMN keeps the data, the NOT NULL and
-- the default, so no organisation loses its key or its model.
ALTER TABLE "organizations" RENAME COLUMN "geminiApiKey" TO "aiApiKey";
ALTER TABLE "organizations" RENAME COLUMN "geminiModel" TO "aiModel";

-- Which adapter answers. A string rather than an enum because the provider list
-- lives in `services/ai` and should not need a migration to grow.
--
-- GEMINI as the default is the truthful value for every row that exists: they
-- were all set up against Gemini, and their key and model are still Gemini's.
ALTER TABLE "organizations" ADD COLUMN "aiProvider" TEXT NOT NULL DEFAULT 'GEMINI';

-- Where to send it, for a provider with no fixed home. Null for the three named
-- ones, which know their own endpoints. Set for OPENAI_COMPATIBLE, where the
-- person chooses -- OpenRouter, Groq, a local server.
ALTER TABLE "organizations" ADD COLUMN "aiBaseUrl" TEXT;
