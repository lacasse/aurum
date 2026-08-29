-- Monthly closing prices, so the portfolio can be valued back to its first
-- trade instead of only over the eighteen monthly prices carried on each
-- holding row.
--
-- History does not change: once March 2023's close is written it is never
-- fetched again, and only the current month is refreshed. That is what makes a
-- five-year series affordable against providers that ration calls.
--
-- The USD→CAD rate lives here under the ticker 'USDCAD'; it is fetched with
-- the prices, keyed by the same month, and read on the same path.
CREATE TABLE IF NOT EXISTS "price_history" (
	"ticker" text NOT NULL,
	"month" text NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	CONSTRAINT "price_history_pkey" PRIMARY KEY("ticker","month")
);
