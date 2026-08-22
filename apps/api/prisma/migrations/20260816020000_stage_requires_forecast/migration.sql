-- A deal may not enter this stage without a value and an expected close date.
--
-- No rule may identify a stage by NAME — stages are rows and can be renamed, and a
-- rule keyed on "Negotiation" would silently stop firing the day somebody calls it
-- "Commercials". The flag carries the intent so the rule survives the rename.
ALTER TABLE "stages" ADD COLUMN "requiresForecast" BOOLEAN NOT NULL DEFAULT false;
