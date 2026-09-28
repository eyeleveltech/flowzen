-- Work done for a client without charging for it.
--
-- The sample reel, the pilot design, the trial piece: real work, with real
-- people and real costs behind it, and no invoice at the end. There was no way
-- to record one. `quotedValue` had to be positive, so a project could not be
-- worth nothing; and a project refused a company that was still a prospect,
-- which is exactly who a sample is usually FOR — you make the thing in order
-- to win them.
--
-- So the money a studio spends winning a client was invisible. It went out as
-- people's time and external costs against nothing, and the first record of
-- that client began on the day they finally paid.
--
-- A sample does not make anybody a client. §3 keeps its shape: a company
-- becomes a CLIENT because a proposal was won, and a sample is not a sale.
--
-- Additive: one boolean column with a default. No existing row changes — every
-- project already in the table is paid work, which is what `false` says.

ALTER TABLE "projects" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;
