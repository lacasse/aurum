-- Sector was never used. Every row carried the fallback the importer writes
-- ("Other", or the asset class), so the column described nothing and the sector
-- chart it fed had a single spoke. Asset class is the grouping the app uses.
--
-- Dropping a column cannot be undone: restore from a backup if this turns out
-- to be wrong. Nothing but the discarded chart ever read it.
ALTER TABLE "holdings" DROP COLUMN IF EXISTS "sector";
