-- Unify accounts and holdings, give transactions two sides, and add recurring
-- rules.
--
-- Holdings used to carry a free-text `account_type` tag ("TFSA", "RRSP", …)
-- that named an account which did not exist anywhere. Registered accounts
-- become real rows, so money can be transferred into them like any other
-- account and their tax treatment lives in one place.

--> accounts: tax treatment, separate from `kind`
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "registration" text;--> statement-breakpoint

--> Create one investment account per account_type still in use by a holding.
-- The generated id inherits the demo prefix ("acc-") only when every holding
-- of that type is itself demo data, so deleting the demo data cleans these up
-- too without ever touching an account backing real positions.
INSERT INTO "accounts" ("id", "name", "institution", "kind", "balance", "history", "position", "registration")
SELECT
  g.acct_id,
  CASE WHEN g.account_type = 'non-registered' THEN 'Non-registered' ELSE g.account_type END,
  '—',
  'investment',
  0,
  '[]'::jsonb,
  100 + row_number() OVER (ORDER BY g.account_type),
  g.account_type
FROM (
  SELECT
    account_type,
    (CASE WHEN bool_and(id LIKE 'hold-%') THEN 'acc-inv-' ELSE 'inv-' END
      || lower(replace(account_type, ' ', '-'))) AS acct_id
  FROM "holdings"
  GROUP BY account_type
) g
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

--> holdings: point at that account instead of naming a type
ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "account_id" text;--> statement-breakpoint

UPDATE "holdings" h
SET "account_id" = g.acct_id
FROM (
  SELECT
    account_type,
    (CASE WHEN bool_and(id LIKE 'hold-%') THEN 'acc-inv-' ELSE 'inv-' END
      || lower(replace(account_type, ' ', '-'))) AS acct_id
  FROM "holdings"
  GROUP BY account_type
) g
WHERE h.account_type = g.account_type;--> statement-breakpoint

ALTER TABLE "holdings" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" DROP COLUMN IF EXISTS "account_type";--> statement-breakpoint

--> transactions: a source and a destination instead of one account
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "source_account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "destination_account_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "recurring_id" text;--> statement-breakpoint

-- Income arrived in the account; everything else left it.
UPDATE "transactions" SET "destination_account_id" = "account_id" WHERE "type" = 'income';--> statement-breakpoint
UPDATE "transactions" SET "source_account_id" = "account_id" WHERE "type" <> 'income';--> statement-breakpoint

ALTER TABLE "transactions" DROP COLUMN IF EXISTS "account_id";--> statement-breakpoint

--> recurring rules
CREATE TABLE IF NOT EXISTS "recurring_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"category" text NOT NULL,
	"source_account_id" text,
	"destination_account_id" text,
	"payee" text NOT NULL,
	"note" text,
	"frequency" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"next_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
