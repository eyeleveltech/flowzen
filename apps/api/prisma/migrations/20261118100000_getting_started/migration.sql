-- Ease Plan 2: when a person hid My Work's Getting started card. Additive only.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gettingStartedHiddenAt" TIMESTAMP(3);
