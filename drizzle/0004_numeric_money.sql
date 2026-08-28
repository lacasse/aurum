-- Money must not live in binary floating point. Convert every monetary,
-- price and quantity column from `double precision` to an exact `numeric`.
-- Defaults are dropped and re-added around each ALTER so Postgres never has
-- to coerce a float default expression into the new type.

--> accounts
ALTER TABLE "accounts" ALTER COLUMN "balance" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "balance" TYPE numeric(18, 2) USING round("balance"::numeric, 2);--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "balance" SET DEFAULT 0;--> statement-breakpoint

--> transactions
ALTER TABLE "transactions" ALTER COLUMN "amount" TYPE numeric(18, 2) USING round("amount"::numeric, 2);--> statement-breakpoint

--> budgets
ALTER TABLE "budgets" ALTER COLUMN "max" TYPE numeric(18, 2) USING round("max"::numeric, 2);--> statement-breakpoint

--> holdings
ALTER TABLE "holdings" ALTER COLUMN "shares" TYPE numeric(28, 10) USING round("shares"::numeric, 10);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "avg_cost" TYPE numeric(20, 8) USING round("avg_cost"::numeric, 8);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "price" TYPE numeric(20, 8) USING round("price"::numeric, 8);--> statement-breakpoint

ALTER TABLE "holdings" ALTER COLUMN "dividends_received" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "dividends_received" TYPE numeric(18, 2) USING round("dividends_received"::numeric, 2);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "dividends_received" SET DEFAULT 0;--> statement-breakpoint

ALTER TABLE "holdings" ALTER COLUMN "price_cad" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "price_cad" TYPE numeric(20, 8) USING round("price_cad"::numeric, 8);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "price_cad" SET DEFAULT 0;--> statement-breakpoint

ALTER TABLE "holdings" ALTER COLUMN "avg_cost_cad" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "avg_cost_cad" TYPE numeric(20, 8) USING round("avg_cost_cad"::numeric, 8);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "avg_cost_cad" SET DEFAULT 0;--> statement-breakpoint

ALTER TABLE "holdings" ALTER COLUMN "dividends_received_cad" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "dividends_received_cad" TYPE numeric(18, 2) USING round("dividends_received_cad"::numeric, 2);--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "dividends_received_cad" SET DEFAULT 0;--> statement-breakpoint

--> monthly_snapshots
ALTER TABLE "monthly_snapshots" ALTER COLUMN "price" TYPE numeric(20, 8) USING round("price"::numeric, 8);--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "avg_cost" TYPE numeric(20, 8) USING round("avg_cost"::numeric, 8);--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "shares" TYPE numeric(28, 10) USING round("shares"::numeric, 10);--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "value" TYPE numeric(18, 2) USING round("value"::numeric, 2);--> statement-breakpoint

ALTER TABLE "monthly_snapshots" ALTER COLUMN "value_cad" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "value_cad" TYPE numeric(18, 2) USING round("value_cad"::numeric, 2);--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "value_cad" SET DEFAULT 0;--> statement-breakpoint

-- The 0002 migration created this constraint by hand while the Drizzle schema
-- carried a malformed composite-key declaration. Guarantee it exists so the
-- schema and the database agree.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'monthly_snapshots_pkey'
  ) THEN
    ALTER TABLE "monthly_snapshots"
      ADD CONSTRAINT "monthly_snapshots_pkey" PRIMARY KEY ("month", "holding_id");
  END IF;
END $$;
