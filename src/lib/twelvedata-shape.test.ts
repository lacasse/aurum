import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { twelveDataPrice } from "./market";

/*
 * Twelve Data answers in one of two shapes depending on how many symbols were
 * asked for, and the parser read only one of them. Any request carrying a
 * single symbol therefore returned nothing at all — silently, having spent the
 * credit. Crypto suffered worst: the retry that re-asks in USD for a coin with
 * no CAD pair usually carries exactly one symbol, so coins stayed unpriced
 * while everything else refreshed.
 */

describe("reading a Twelve Data price", () => {
  test("a batch is keyed by symbol", () => {
    const body = { "BTC/USD": { price: "79189.72" }, "ETH/USD": { price: "2497.71" } };
    assert.equal(twelveDataPrice(body, "BTC/USD", 2), "79189.72");
    assert.equal(twelveDataPrice(body, "ETH/USD", 2), "2497.71");
  });

  test("a single symbol comes back flat, with no key", () => {
    assert.equal(twelveDataPrice({ price: "79180.59" }, "BTC/USD", 1), "79180.59");
  });

  test("a flat price is not trusted when a batch was asked for", () => {
    // Reading it would attribute one symbol's price to every symbol in the
    // batch, which is worse than reporting the price as stale.
    assert.equal(twelveDataPrice({ price: "79180.59" }, "ETH/USD", 2), undefined);
  });

  test("a symbol missing from a batch has no price", () => {
    const body = { "BTC/USD": { price: "79189.72" } };
    assert.equal(twelveDataPrice(body, "ETH/USD", 2), undefined);
  });

  test("an error body yields nothing rather than a number", () => {
    for (const body of [
      { code: 429, message: "run out of API credits" },
      { status: "error" },
      null,
      "nonsense",
      { "BTC/USD": { price: 79189.72 } }, // a number, not the string the API sends
    ]) {
      assert.equal(twelveDataPrice(body, "BTC/USD", 2), undefined);
    }
  });
});
