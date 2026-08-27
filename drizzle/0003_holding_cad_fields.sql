ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "price_cad" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "avg_cost_cad" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "dividends_received_cad" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN IF NOT EXISTS "history_cad" jsonb NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "monthly_snapshots" ADD COLUMN IF NOT EXISTS "value_cad" double precision NOT NULL DEFAULT 0;--> statement-breakpoint
