-- Preserve secondary-contact intelligence on lead -> client conversion.
--
-- LeadContact carries role (ContactRole: DECISION_MAKER / INFLUENCER / GATEKEEPER / CHAMPION /
-- CC_ONLY), linkedinUrl and notes, but ClientContact had none of these columns, so conversion
-- silently dropped them. Add them (all nullable — manually-added client contacts may have no
-- role) so the conversion service can carry them across.

ALTER TABLE "client_contacts" ADD COLUMN "linkedinUrl" TEXT;
ALTER TABLE "client_contacts" ADD COLUMN "role" "ContactRole";
ALTER TABLE "client_contacts" ADD COLUMN "notes" TEXT;
