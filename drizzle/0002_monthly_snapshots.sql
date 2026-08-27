CREATE TABLE IF NOT EXISTS "monthly_snapshots" (
  "month" text NOT NULL,
  "holding_id" text NOT NULL,
  "ticker" text NOT NULL,
  "price" double precision NOT NULL,
  "avg_cost" double precision NOT NULL,
  "shares" double precision NOT NULL,
  "value" double precision NOT NULL,
  CONSTRAINT "monthly_snapshots_pkey" PRIMARY KEY ("month", "holding_id")
);--> statement-breakpoint