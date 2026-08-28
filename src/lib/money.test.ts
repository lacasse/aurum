import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  addMoney,
  fromCents,
  multiplyMoney,
  roundMoney,
  subtractMoney,
  sumMoney,
  sumProducts,
  toCents,
} from "./money";

describe("toCents", () => {
  test("scales whole and fractional amounts", () => {
    assert.equal(toCents(0), 0);
    assert.equal(toCents(1), 100);
    assert.equal(toCents(12.34), 1234);
    assert.equal(toCents(-5.67), -567);
  });

  test("rounds half-cent values up rather than down", () => {
    // The reason for the toPrecision pass: 1.005 * 100 is 100.49999999999999
    // in IEEE-754, so a naive Math.round yields 100 (=$1.00), not 101.
    assert.equal(Math.round(1.005 * 100), 100, "precondition: naive rounding is wrong");
    assert.equal(toCents(1.005), 101);
    assert.equal(toCents(2.675), 268);
    assert.equal(toCents(8.615), 862);
  });

  test("treats non-finite input as zero", () => {
    assert.equal(toCents(NaN), 0);
    assert.equal(toCents(Infinity), 0);
    assert.equal(toCents(-Infinity), 0);
  });
});

describe("sumMoney", () => {
  test("is exact where floating point is not", () => {
    assert.notEqual(0.1 + 0.2, 0.3, "precondition: float addition drifts");
    assert.equal(sumMoney([0.1, 0.2]), 0.3);
  });

  test("does not accumulate error over many terms", () => {
    const amounts = Array.from({ length: 1000 }, () => 0.1);

    let naive = 0;
    for (const a of amounts) naive += a;
    assert.notEqual(naive, 100, "precondition: naive accumulation drifts");

    assert.equal(sumMoney(amounts), 100);
  });

  test("handles an empty list and mixed signs", () => {
    assert.equal(sumMoney([]), 0);
    assert.equal(sumMoney([10.05, -3.02, -7.03]), 0);
  });
});

describe("sumProducts", () => {
  test("rounds each line item before totalling", () => {
    // 3 x 0.005 rounds to 0.01 per line, so the total is 0.03, not 0.015.
    assert.equal(sumProducts([[1, 0.005], [1, 0.005], [1, 0.005]]), 0.03);
  });

  test("totals share x price exactly", () => {
    // 3 x 19.99 = 59.97, 2 x 5.005 = 10.01
    assert.equal(sumProducts([[3, 19.99], [2, 5.005]]), 69.98);
  });
});

describe("arithmetic helpers", () => {
  test("roundMoney rounds to whole cents", () => {
    assert.equal(roundMoney(1.234), 1.23);
    assert.equal(roundMoney(1.235), 1.24);
  });

  test("add/subtract are exact", () => {
    assert.equal(addMoney(0.1, 0.2), 0.3);
    assert.equal(subtractMoney(0.3, 0.1), 0.2);
    assert.notEqual(0.3 - 0.1, 0.2, "precondition: float subtraction drifts");
  });

  test("multiplyMoney rounds the product", () => {
    assert.equal(multiplyMoney(3, 19.99), 59.97);
    assert.equal(multiplyMoney(0.5, 0.05), 0.03);
  });

  test("fromCents inverts toCents", () => {
    for (const n of [0, 1.01, 99.99, 12345.67, -0.05]) {
      assert.equal(fromCents(toCents(n)), n);
    }
  });
});
