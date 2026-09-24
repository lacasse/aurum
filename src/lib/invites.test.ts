import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  hashInviteToken,
  inviteStatus,
  looksLikeToken,
  newInviteToken,
  passwordProblem,
} from "./invites";

describe("invitation tokens", () => {
  test("are long, random and URL-safe", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    assert.notEqual(a, b);
    assert.ok(looksLikeToken(a), a);
  });

  test("are stored as a hash, so the table does not hold anything usable", () => {
    const t = newInviteToken();
    const h = hashInviteToken(t);
    assert.notEqual(h, t);
    assert.ok(!h.includes(t));
    assert.equal(hashInviteToken(t), h, "the same token always finds its row");
  });

  test("anything not shaped like a token is refused before a lookup", () => {
    assert.equal(looksLikeToken(""), false);
    assert.equal(looksLikeToken("short"), false);
    assert.equal(looksLikeToken("x".repeat(43) + "'; drop table users; --"), false);
  });
});

describe("what an invitation's state is", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  test("pending until used or out of date", () => {
    assert.equal(inviteStatus({ expiresAt: "2026-09-27T12:00:00Z", acceptedAt: null }, now), "pending");
    assert.equal(inviteStatus({ expiresAt: "2026-09-20T11:59:59Z", acceptedAt: null }, now), "expired");
    assert.equal(
      inviteStatus({ expiresAt: "2026-09-19T12:00:00Z", acceptedAt: "2026-09-18T12:00:00Z" }, now),
      "accepted",
      "a used invitation says so even after its date",
    );
  });
});

describe("a new account's password", () => {
  test("must be long enough", () => {
    assert.match(passwordProblem("short") ?? "", /12/);
    assert.equal(passwordProblem("a perfectly fine passphrase"), null);
  });
  test("cannot hide surrounding spaces the person will not type next time", () => {
    assert.notEqual(passwordProblem(" leading-space-pass"), null);
  });
});
