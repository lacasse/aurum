-- The day an account's balance was last stated by hand.
--
-- Null everywhere to begin with, which is the old behaviour: with no anchor,
-- every dated movement applies. An account only gains one when someone types a
-- balance into the form, and from then on anything dated on or before that day
-- is treated as already counted.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "balance_as_of" text;
