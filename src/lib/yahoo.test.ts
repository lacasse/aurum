import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMonthlyChart, toYahooSymbol } from "./yahoo";

describe("toYahooSymbol", () => {
  test("Cboe Canada is .NE to Yahoo and .NEO to us", () => {
    assert.equal(toYahooSymbol("RETL.NEO"), "AMZN.NE");
    assert.equal(toYahooSymbol("AUTO.NEO"), "AUTO.NE");
  });

  test("every other listing keeps its suffix", () => {
    assert.equal(toYahooSymbol("XEQT.TO"), "XEQT.TO");
    assert.equal(toYahooSymbol("CRYP-A.TO"), "CRYP-A.TO");
    assert.equal(toYahooSymbol("REIT"), "REIT");
  });

  test("a coin is quoted in the currency the position is recorded in", () => {
    assert.equal(toYahooSymbol("BTC", "CAD"), "BTC-CAD");
    assert.equal(toYahooSymbol("ETH", "USD"), "ETH-USD");
  });

  test("an exchange-listed crypto product is a listing, not a pair", () => {
    assert.equal(toYahooSymbol("CRYP-C.TO", "CAD"), "CRYP-C.TO");
  });
});

describe("parseMonthlyChart", () => {
  // 2024-01-01 and 2024-02-01 UTC.
  const chart = (closes: (number | null)[]) => ({
    chart: {
      result: [
        {
          meta: { currency: "CAD" },
          timestamp: [1704067200, 1706745600],
          indicators: { adjclose: [{ adjclose: closes }] },
        },
      ],
    },
  });

  test("keys closes by month and reports the currency", () => {
    const { closes, currency } = parseMonthlyChart(chart([10.5, 11.25]));
    assert.equal(currency, "CAD");
    assert.deepEqual([...closes], [["2024-01", 10.5], ["2024-02", 11.25]]);
  });

  test("skips months the provider has no price for", () => {
    const { closes } = parseMonthlyChart(chart([null, 11]));
    assert.deepEqual([...closes], [["2024-02", 11]]);
  });

  test("a payload with no result is an empty series, not a throw", () => {
    assert.deepEqual([...parseMonthlyChart({}).closes], []);
    assert.deepEqual([...parseMonthlyChart({ chart: { result: [] } }).closes], []);
  });
});
