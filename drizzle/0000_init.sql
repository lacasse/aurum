CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"institution" text DEFAULT '—' NOT NULL,
	"kind" text NOT NULL,
	"balance" double precision DEFAULT 0 NOT NULL,
	"history" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"category" text PRIMARY KEY NOT NULL,
	"max" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"name" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"asset_class" text NOT NULL,
	"sector" text NOT NULL,
	"shares" double precision NOT NULL,
	"avg_cost" double precision NOT NULL,
	"price" double precision NOT NULL,
	"history" jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"merchant" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"amount" double precision NOT NULL,
	"category" text NOT NULL,
	"account_id" text NOT NULL,
	"payee" text NOT NULL,
	"note" text
);
