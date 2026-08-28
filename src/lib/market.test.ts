import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isCoinTicker,
  priceSource,
  toEodhdSymbol,
  toTwelveDataSymbol,
  toUsdCryptoSymbol,
} from "./market";

describe("priceSource", () => {
  test("a bare coin goes to Twelve Data whatever currency it is recorded in", () => {
    // The bug this replaces: recording BTC in CAD sent it to the Canadian
    // equity feed as "BTC.TO", which has no price, so it showed as
    // permanently stale.
    for (const coin of ["BTC", "ETH", "SOL"]) {
      assert.equal(priceSource("Crypto", "CAD", coin), "twelvedata", coin);
      assert.equal(priceSource("Crypto", "USD", coin), "twelvedata", coin);
    }
  });

  test("a crypto ETF is an exchange listing and stays on EODHD", () => {
    // CRYP-A.TO is a TSX product, not a coin.
    assert.equal(priceSource("Crypto", "CAD", "CRYP-A.TO"), "eodhd");
  });

  test("equities still route on currency", () => {
    assert.equal(priceSource("US Equity", "CAD", "XEQT"), "eodhd");
    assert.equal(priceSource("US Equity", "USD", "CHIP"), "twelvedata");
    assert.equal(priceSource("Intl Equity", "CAD", "GRWT"), "eodhd");
    assert.equal(priceSource("US Equity", "CAD", "RETL.NEO"), "eodhd");
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
