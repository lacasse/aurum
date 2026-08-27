ALTER TABLE "holdings" ADD COLUMN "dividends_received" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "account_type" text DEFAULT 'non-registered' NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "currency" text DEFAULT 'CAD' NOT NULL;
