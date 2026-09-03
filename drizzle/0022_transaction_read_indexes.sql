-- Every read of this table orders by date, newest first: the whole state load
-- does it, and so does anything asking about a month. At fourteen hundred rows
-- Postgres sorts that in well under a millisecond, so this is for the table
-- this becomes after a few more years of imports rather than for today.
--
-- The second index is for the per-account questions — a balance history, or
-- the transactions touching one account — which scan for an id in either of
-- two nullable columns.
CREATE INDEX IF NOT EXISTS "transactions_date_idx" ON "transactions" ("date" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "transactions_source_account_idx" ON "transactions" ("source_account_id") WHERE "source_account_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "transactions_destination_account_idx" ON "transactions" ("destination_account_id") WHERE "destination_account_id" IS NOT NULL;
