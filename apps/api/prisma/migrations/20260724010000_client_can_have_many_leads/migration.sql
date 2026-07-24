-- One Client, many Leads.
--
-- Lead.clientId was UNIQUE, which locked a client to exactly one lead forever. That made
-- repeat business impossible to model: when a customer you have already won comes back with
-- a second deal, the new lead could not be linked to the existing account, so conversion
-- either failed outright or was forced to create a duplicate company record.
--
-- The pipeline is a record of deals, not of companies. A company you win three times has one
-- account and three leads.

DROP INDEX IF EXISTS "public"."leads_clientId_key";

CREATE INDEX IF NOT EXISTS "leads_clientId_idx" ON "public"."leads"("clientId");
