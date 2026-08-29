-- Record where each monthly close came from.
--
-- The user keeps their own month-end record of what every position was worth.
-- That is a better figure than any provider's: it is what the holding was
-- actually valued at, rather than a price fetched years later and multiplied
-- by a reconstructed share count. Marking the source lets a snapshot outrank a
-- fetched close, so a later backfill cannot quietly overwrite the better
-- number with a worse one.
--
-- Existing rows are provider data by definition — nothing else could have
-- written them before this column existed.
ALTER TABLE "price_history"
	ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'provider' NOT NULL;
