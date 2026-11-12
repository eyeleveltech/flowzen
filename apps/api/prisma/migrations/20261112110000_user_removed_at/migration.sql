-- Additive: a person taken off the Team page's "Not signed in" list.
ALTER TABLE "users" ADD COLUMN "removedAt" TIMESTAMP(3);
