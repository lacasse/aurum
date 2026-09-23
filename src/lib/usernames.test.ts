import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normaliseUsername, usernameProblem } from "./usernames";

describe("one name, however it is typed", () => {
  test("case and surrounding space do not make a second account", () => {
    assert.equal(normaliseUsername("  Alex "), "alex");
  });

  test("compatibility forms fold together", () => {
    // Fullwidth letters are the same name.
    assert.equal(normaliseUsername("ａｌｅｘ"), "alex");
  });
});

describe("what a new account may be called", () => {
  test("plain names pass", () => {
    for (const n of ["alex", "sam.lee", "j_doe-2", "abc"]) assert.equal(usernameProblem(n), null, n);
  });

  test("a lookalike cannot sit beside the real one", () => {
    // Cyrillic а in place of Latin a.
    assert.notEqual(usernameProblem("аlex"), null);
  });

  test("names that are too short, too long or oddly shaped are refused", () => {
    assert.match(usernameProblem("ab") ?? "", /three/);
    assert.match(usernameProblem("a".repeat(33)) ?? "", /32/);
    assert.notEqual(usernameProblem("has space"), null);
    assert.notEqual(usernameProblem(".leadingdot"), null);
    assert.notEqual(usernameProblem("me@example.com"), null);
  });
});
