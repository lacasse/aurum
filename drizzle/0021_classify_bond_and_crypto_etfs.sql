-- Put the bond and crypto ETFs in the classes they belong to.
--
-- Asset class had never been load-bearing: it coloured a donut of what is
-- held today, and every one of these is a closed position. Splitting net worth
-- by class month by month makes it history, and the history was wrong —
-- XLB.TO and XGB.TO are Canadian bond funds filed as US equity, which is why
-- the Bonds band was empty for a portfolio that held bonds through 2022.
--
-- The three crypto funds follow BTCX-B.TO, which was already Crypto. They are
-- exchange-traded, and they are held in registered accounts, which is where
-- they belong as accounts; but the exposure they carry is the coin, and a
-- chart of what net worth is made of is about exposure.
UPDATE "holdings" SET "asset_class" = 'Bonds'
WHERE upper("ticker") IN ('XLB.TO', 'XGB.TO');

UPDATE "holdings" SET "asset_class" = 'Crypto'
WHERE upper("ticker") IN ('ETHX-B.TO', 'BTCY.TO', 'BTCC.TO');
