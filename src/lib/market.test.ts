import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isCoinTicker,
  priceSource,
  staleTickers,
  toEodhdSymbol,
  toTwelveDataSymbol,
  toUsdCryptoSymbol,
} from "./market";

describe("priceSource", () => {
  test("a ticker naming its exchange goes to EODHD", () => {
    for (const t of ["XEQT.TO", "RETL.NEO", "AUTO.NE", "RAIL.TO", "CRYP-A.TO"]) {
      assert.equal(priceSource(t), "eodhd", t);
    }
  });

  test("a bare ticker goes to Twelve Data", () => {
    for (const t of ["AAPL", "REIT", "CHIP", "RATE"]) {
      assert.equal(priceSource(t), "twelvedata", t);
    }
  });

  test("a bare coin goes to Twelve Data", () => {
    // The bug this replaces: recording BTC in CAD sent it to the Canadian
    // equity feed as "BTC.TO", which has no price, so it showed as
    // permanently stale.
    for (const coin of ["BTC", "ETH", "SOL"]) {
      assert.equal(priceSource(coin), "twelvedata", coin);
    }
  });

  test("a crypto ETF is an exchange listing and stays on EODHD", () => {
    // CRYP-A.TO is a TSX product, not a coin, and the suffix says so.
    assert.equal(priceSource("CRYP-A.TO"), "eodhd");
  });

  test("the currency a position is recorded in does not decide the feed", () => {
    /*
     * The regression that motivated the rule: a trade row defaults to CAD, so
     * routing on currency sent every US stock somebody typed to the Canadian
     * feed as "AAPL.TO". Only what the user wrote in the ticker counts now.
     */
    assert.equal(priceSource("AAPL"), "twelvedata");
    assert.equal(priceSource("XEQT.TO"), "eodhd");
  });
});

describe("toTwelveDataSymbol", () => {
  test("a coin is quoted in the currency the position is recorded in", () => {
    assert.equal(toTwelveDataSymbol("BTC", "Crypto", "CAD"), "BTC/CAD");
    assert.equal(toTwelveDataSymbol("SOL", "Crypto", "USD"), "SOL/USD");
  });

  test("defaults to USD when no currency is given", () => {
    assert.equal(toTwelveDataSymbol("ETH", "Crypto"), "ETH/USD");
  });

  test("an existing pair is left alone", () => {
    assert.equal(toTwelveDataSymbol("BTC/USD", "Crypto", "CAD"), "BTC/USD");
  });

  test("an exchange-listed crypto product is not turned into a pair", () => {
    assert.equal(toTwelveDataSymbol("CRYP-A.TO", "Crypto", "CAD"), "CRYP-A.TO");
  });

  test("equities pass through untouched", () => {
    assert.equal(toTwelveDataSymbol("aapl", "US Equity", "USD"), "AAPL");
  });
});

describe("toUsdCryptoSymbol", () => {
  test("is the USD pair for the same coin", () => {
    assert.equal(toUsdCryptoSymbol("BTC"), "BTC/USD");
    assert.equal(toUsdCryptoSymbol("btc"), "BTC/USD");
    assert.equal(toUsdCryptoSymbol("BTC/CAD"), "BTC/USD", "re-quotes an existing pair");
  });
});

describe("toEodhdSymbol", () => {
  test("keeps an existing venue suffix and defaults the rest to TSX", () => {
    assert.equal(toEodhdSymbol("XEQT"), "XEQT.TO");
    assert.equal(toEodhdSymbol("RETL.NEO"), "RETL.NEO");
    assert.equal(toEodhdSymbol("cryp-a.to"), "CRYP-A.TO");
  });
});

describe("isCoinTicker", () => {
  test("a bare coin symbol is a coin", () => {
    for (const t of ["BTC", "eth", "SOL", "ADA"]) {
      assert.equal(isCoinTicker(t), true, t);
    }
  });

  test("an exchange listing is not, however crypto-flavoured", () => {
    // These are TSX products, and EODHD really is the feed that carries them.
    for (const t of ["CRYP-A.TO", "CRYP-C.TO", "GOLD.TO", "RETL.NEO", "XEQT"]) {
      assert.equal(isCoinTicker(t), false, t);
    }
  });
});

describe("the portfolio's Canadian holdings after normalisation", () => {
  test("XEQT, QUAL and GRWT carry .TO and keep the Canadian feed", () => {
    /*
     * These three were stored bare, which under this rule would have sent them
     * to Twelve Data as ambiguous symbols — where a same-named US listing
     * would return a confident price for a security the user does not own.
     * Migration 0008 gave them their suffix; this is what makes that
     * migration load-bearing rather than cosmetic.
     */
    for (const t of ["XEQT.TO", "QUAL.TO", "GRWT.TO"]) {
      assert.equal(priceSource(t), "eodhd", t);
      assert.equal(toEodhdSymbol(t), t);
    }
  });

  test("REIT is bare and quoted by Twelve Data", () => {
    // Stored as "REIT.US", which Twelve Data does not understand and which the
    // old currency rule sent there anyway, so it never priced at all.
    assert.equal(priceSource("REIT"), "twelvedata");
    assert.equal(toTwelveDataSymbol("REIT", "US Equity", "USD"), "REIT");
  });
});

describe("staleTickers", () => {
  test("flags what this refresh could not price", () => {
    assert.deepEqual(
      staleTickers(["AAPL", "XEQT.TO", "BTC"], { AAPL: 190, BTC: 80000 }),
      ["XEQT.TO"],
    );
  });

  test("covers Twelve Data, not only EODHD", () => {
    /*
     * The regression this exists for: staleness was computed over the EODHD
     * tickers alone, so a coin or US stock that failed to quote kept showing
     * its last known price with nothing marking it as old. Both bare tickers
     * here route to Twelve Data.
     */
    assert.deepEqual(staleTickers(["BTC", "AAPL"], {}), ["BTC", "AAPL"]);
    for (const t of ["BTC", "AAPL"]) assert.equal(priceSource(t), "twelvedata");
  });

  test("a priced ticker is never stale, whichever feed answered", () => {
    assert.deepEqual(
      staleTickers(["AAPL", "XEQT.TO"], { AAPL: 190, "XEQT.TO": 33.1 }),
      [],
    );
  });

  test("nothing requested means nothing stale", () => {
    assert.deepEqual(staleTickers([], {}), []);
  });

  test("a zero price still counts as an answer rather than a gap", () => {
    // Only `undefined` means "no price came back". A provider is not expected
    // to return 0, but treating it as missing would flag it stale forever
    // while the row went on showing that same 0.
    assert.deepEqual(staleTickers(["AAPL"], { AAPL: 0 }), []);
  });
});
