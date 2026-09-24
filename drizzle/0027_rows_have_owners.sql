-- Every row gains an owner.
--
-- Until now each row belonged to the installation. From here each belongs to a
-- user, and every query reads only the rows of whoever is asking. Nothing is
-- deleted and no figure changes: rows are given an owner, keys are widened to
-- include it, and one trigger stops comparing one person's rows with another's.
--
-- Who owns the rows that already exist. On an installation that has been
-- running, the users table was created a moment ago, in this same run, and is
-- still empty: the first real account is made from the deployment's
-- credentials by the app after migrations finish. So when there is no user yet,
-- one placeholder is created here to own everything, with a password nothing
-- can match and a name no invitation can produce. The app then *claims* that
-- placeholder — gives it the deployment's username and password hash — rather
-- than creating a second account beside it. The owner of every existing row is
-- therefore the account the owner already signs in with.
--
-- Where a user already exists (a dev database that ran the previous migrations
-- and started), the earliest admin owns the rows instead.
INSERT INTO "users" ("id", "username", "password_hash", "role", "created_at", "session_epoch")
SELECT 'unclaimed-owner', '__unclaimed__', '!', 'admin',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 0
WHERE NOT EXISTS (SELECT 1 FROM "users");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.first_owner() RETURNS text LANGUAGE sql AS $$
  SELECT "id" FROM "users" ORDER BY ("role" = 'admin') DESC, "created_at" ASC, "id" ASC LIMIT 1
$$;
--> statement-breakpoint
-- Tables keyed by an id. The id stays the key — ids are random, so two users'
-- rows never share one — and the owner is a required column beside it.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "accounts" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
-- The granularity guard is a deferred trigger, so the backfill below would
-- queue one check per row until commit — and Postgres will not alter a table
-- with checks still pending. Giving a row an owner changes no type, date or
-- granularity, so it cannot break the rule the guard enforces; the guard is
-- set aside for the one statement and put straight back.
ALTER TABLE "transactions" DISABLE TRIGGER "transactions_one_granularity_per_month";
--> statement-breakpoint
UPDATE "transactions" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE TRIGGER "transactions_one_granularity_per_month";
--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "holdings" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "recurring_transactions" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
-- Tables keyed by a name. Two people can both have a "Groceries" category, so
-- the owner becomes part of the key rather than a column beside it.
ALTER TABLE "budgets" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "budgets" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_pkey";
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_pkey" PRIMARY KEY ("user_id", "category");
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "categories" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_pkey";
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("user_id", "name");
--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "merchant_rules" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "merchant_rules" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "merchant_rules" DROP CONSTRAINT IF EXISTS "merchant_rules_pkey";
--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_pkey" PRIMARY KEY ("user_id", "merchant");
--> statement-breakpoint
-- Month-end valuations. Their holding id is not always random — a spreadsheet
-- import writes "sheet:" plus the ticker — so the owner joins that key too.
ALTER TABLE "monthly_snapshots" ADD COLUMN IF NOT EXISTS "user_id" text;
--> statement-breakpoint
UPDATE "monthly_snapshots" SET "user_id" = pg_temp.first_owner() WHERE "user_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "monthly_snapshots" DROP CONSTRAINT IF EXISTS "monthly_snapshots_pkey";
--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ADD CONSTRAINT "monthly_snapshots_pkey" PRIMARY KEY ("user_id", "month", "holding_id");
--> statement-breakpoint
-- An owner must be a user. No cascade: removing a user must never quietly take
-- their record with them — that is an explicit act, not a side effect.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ADD CONSTRAINT "monthly_snapshots_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
-- Every read is now "this user's rows", so that is what is indexed.
CREATE INDEX IF NOT EXISTS "accounts_user_idx" ON "accounts" ("user_id", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "holdings_user_idx" ON "holdings" ("user_id", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_transactions_user_idx" ON "recurring_transactions" ("user_id", "position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_date_idx" ON "transactions" ("user_id", "date" DESC, "id" DESC);
--> statement-breakpoint
-- Settings that belong to a person rather than to the installation: which
-- categories are necessities, contribution room, allocation targets, and the
-- record that they deleted the demo data. They move out of app_meta, which
-- keeps only what is genuinely the installation's — price caches, provider
-- allowances. The old app_meta rows are left where they are, unused, rather
-- than deleted in the same breath as they are copied.
CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "key" text NOT NULL,
  "value" text NOT NULL,
  CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id", "key")
);
--> statement-breakpoint
INSERT INTO "user_settings" ("user_id", "key", "value")
SELECT pg_temp.first_owner(), "key", "value"
  FROM "app_meta"
 WHERE "key" IN ('allocation_targets', 'contribution_limits', 'contribution_deferrals',
                 'expense_settings', 'demo_data_deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- One figure per month per kind, per person. The guard compared every row in
-- the table, so one person's monthly import would have refused another's
-- receipts for the same month — and said in its error how many rows the other
-- account held.
CREATE OR REPLACE FUNCTION transactions_one_granularity_per_month() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  opposite    text;
  month_start date;
  clashes     integer;
BEGIN
  opposite := CASE NEW.granularity WHEN 'monthly' THEN 'individual' ELSE 'monthly' END;
  month_start := date_trunc('month', NEW.date)::date;
  SELECT count(*) INTO clashes
    FROM transactions
   WHERE user_id = NEW.user_id
     AND type = NEW.type
     AND granularity = opposite
     AND date >= month_start
     AND date < month_start + interval '1 month'
     AND id <> NEW.id;
  IF clashes > 0 THEN
    RAISE EXCEPTION
      '% for %-% is already recorded as % in % row(s); adding % rows would count the same money twice',
      NEW.type,
      extract(year from NEW.date), lpad(extract(month from NEW.date)::text, 2, '0'),
      opposite, clashes, NEW.granularity
      USING ERRCODE = 'integrity_constraint_violation',
            HINT = 'Remove the existing rows for that month first, or import a period that is not already covered.';
  END IF;
  RETURN NEW;
END;
$$;
