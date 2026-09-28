-- Partnerships is called Outsource.
--
-- The studio's own word for it: this is work that arrives because another
-- agency has outsourced it here, not a partnership in any other sense. The
-- list said Partnerships, which meant somebody picking a source had to
-- translate on the way in and back again on the way out.
--
-- Sources are TEXT since `industries_and_sources_as_text`, so the stored value
-- IS the label — renaming the option in code without touching the rows would
-- leave five companies holding a value that is no longer on the list. They
-- would still display, but they would not match the dropdown, so opening one
-- and saving it would quietly move it to the default.
--
-- Scoped to the exact old string. Nothing else in either column is touched,
-- and a source somebody typed by hand that merely contains the word is left
-- alone.

UPDATE "companies" SET "source" = 'Outsource' WHERE "source" = 'Partnerships';

UPDATE "outreach_entries" SET "source" = 'Outsource' WHERE "source" = 'Partnerships';
