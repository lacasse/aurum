import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decideRoute } from "./route-guard";

const signedIn = { authenticated: true, demo: false };
const inDemo = { authenticated: false, demo: true };
const nobody = { authenticated: false, demo: false };

/*
 * The routes the record is served from. The demo is safe exactly as long as
 * none of these ever answer to it, so every one is named rather than assumed.
 */
const DATA_ROUTES = [
  "/api/data",
  "/api/accounts",
  "/api/transactions",
  "/api/holdings",
  "/api/snapshots",
  "/api/backups",
  "/api/expense-settings",
  "/api/contribution-limits",
  "/api/prices",
  "/api/demo",
];

describe("the demo never reaches the record", () => {
  for (const route of DATA_ROUTES) {
    test(`${route} refuses the demo`, () => {
      assert.deepEqual(decideRoute(route, inDemo), { kind: "unauthorized" });
    });
  }

  test("nor a bare /api", () => {
    assert.deepEqual(decideRoute("/api", inDemo), { kind: "unauthorized" });
  });

  test("a demo cookie alongside a missing session is still no session", () => {
    assert.equal(decideRoute("/api/data", { authenticated: false, demo: true }).kind, "unauthorized");
  });
});

describe("what the demo can load", () => {
  test("the page shells, which carry no data", () => {
    for (const page of ["/", "/income", "/expenses", "/year", "/transactions"]) {
      assert.deepEqual(decideRoute(page, inDemo), { kind: "next", endDemo: false });
    }
  });

  test("the login page, to sign in from", () => {
    assert.deepEqual(decideRoute("/login", inDemo), { kind: "next", endDemo: false });
  });
});

describe("without a session or a demo", () => {
  test("a page sends you to sign in, and back again after", () => {
    assert.deepEqual(decideRoute("/year", nobody), {
      kind: "redirect",
      to: "/login?next=%2Fyear",
      endDemo: false,
    });
  });

  test("the API refuses", () => {
    assert.deepEqual(decideRoute("/api/data", nobody), { kind: "unauthorized" });
  });
});

describe("signed in", () => {
  test("everything is open", () => {
    assert.deepEqual(decideRoute("/api/data", signedIn), { kind: "next", endDemo: false });
    assert.deepEqual(decideRoute("/year", signedIn), { kind: "next", endDemo: false });
  });

  test("the login page sends you home", () => {
    assert.equal(decideRoute("/login", signedIn).kind, "redirect");
  });

  test("a real session ends a demo left in the same browser", () => {
    /*
     * Otherwise the app would see the demo cookie and draw invented data over
     * the record that was just signed into.
     */
    const both = { authenticated: true, demo: true };
    assert.deepEqual(decideRoute("/api/data", both), { kind: "next", endDemo: true });
    assert.deepEqual(decideRoute("/", both), { kind: "next", endDemo: true });
    assert.deepEqual(decideRoute("/login", both), { kind: "redirect", to: "/", endDemo: true });
  });
});

describe("accepting an invitation, without an account", () => {
  test("the invitation page and its endpoint open to anyone", () => {
    assert.deepEqual(decideRoute("/invite/abc123", nobody), { kind: "next", endDemo: false });
    assert.deepEqual(decideRoute("/api/invites/accept", nobody), { kind: "next", endDemo: false });
  });

  test("…and nothing next to them does", () => {
    assert.deepEqual(decideRoute("/api/invites", nobody), { kind: "unauthorized" });
    assert.deepEqual(decideRoute("/api/invites/some-id", nobody), { kind: "unauthorized" });
    assert.deepEqual(decideRoute("/api/invites/accept/extra", nobody), { kind: "unauthorized" });
    assert.equal(decideRoute("/invite", nobody).kind, "redirect");
    assert.equal(decideRoute("/invite/a/b", nobody).kind, "redirect");
  });

  test("the demo gets no further through them than anyone else", () => {
    assert.deepEqual(decideRoute("/api/invites", inDemo), { kind: "unauthorized" });
  });
});
