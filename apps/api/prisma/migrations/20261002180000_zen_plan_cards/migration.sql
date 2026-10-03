-- Zen Plan 4: the plans and messages Zen prepared on a turn, and which of
-- their steps were clicked. Both nullable; nothing existing changes.
ALTER TABLE "zen_messages" ADD COLUMN     "cards" JSONB,
ADD COLUMN     "stepsDone" JSONB;
