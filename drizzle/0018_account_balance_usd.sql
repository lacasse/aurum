-- Investment accounts hold cash in more than one currency: a USD listing is
-- bought with US dollars, and settling it against a Canadian balance is a
-- conversion that did not happen. The existing balance column keeps its
-- meaning as the CAD side; this is the US one, converted at display time.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "balance_usd" numeric(18, 2) NOT NULL DEFAULT 0;
