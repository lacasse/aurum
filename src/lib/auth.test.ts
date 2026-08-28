import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// auth.ts reads its configuration lazily, inside each call, so setting the
// environment before the first call is enough.
before(() => {
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD = "correct-horse-battery-staple";
  process.env.AUTH_SECRET = "test-secret-not-used-anywhere-real";
  delete process.env.AUTH_PASSWORD_HASH;
});

import {
  clearSession,
  createSession,
  getSessionCookieName,
  hashPassword,
  verifyCredentials,
  verifySession,
} from "./auth";

describe("verifyCredentials", () => {
  test("accepts the configured username and password", () => {
    assert.equal(verifyCredentials("tester", "correct-horse-battery-staple"), true);
  });

  test("rejects a wrong password, wrong username, and empty input", () => {
    assert.equal(verifyCredentials("tester", "wrong"), false);
    assert.equal(verifyCredentials("someone", "correct-horse-battery-staple"), false);
    assert.equal(verifyCredentials("", ""), false);
  });

  test("verifies against a scrypt hash when one is configured", () => {
    const previous = process.env.AUTH_PASSWORD_HASH;
    process.env.AUTH_PASSWORD_HASH = hashPassword("hashed-password");
    try {
      assert.equal(verifyCredentials("tester", "hashed-password"), true);
      assert.equal(verifyCredentials("tester", "correct-horse-battery-staple"), false);
    } finally {
      if (previous === undefined) delete process.env.AUTH_PASSWORD_HASH;
      else process.env.AUTH_PASSWORD_HASH = previous;
    }
  });

  test("hashPassword produces a distinct salt each time", () => {
    const a = hashPassword("same-input");
    const b = hashPassword("same-input");
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f]{32}:[0-9a-f]+$/);
  });

  test("throws rather than defaulting when credentials are unset", () => {
    const previous = process.env.AUTH_USERNAME;
    delete process.env.AUTH_USERNAME;
    try {
      assert.throws(() => verifyCredentials("tester", "x"), /AUTH_USERNAME/);
    } finally {
      process.env.AUTH_USERNAME = previous;
    }
  });
});

describe("sessions", () => {
  test("a freshly issued cookie verifies", () => {
    const session = createSession();
    assert.equal(session.name, getSessionCookieName());
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, "lax");
    assert.equal(verifySession(session.value), true);
  });

  test("rejects missing, malformed and tampered cookies", () => {
    assert.equal(verifySession(undefined), false);
    assert.equal(verifySession(""), false);
    assert.equal(verifySession("no-separator"), false);

    const session = createSession();
    const [expiry, signature] = session.value.split(".");
    assert.equal(verifySession(`${expiry}.${signature}tampered`), false);
    // Extending the expiry invalidates the signature it was computed over.
    assert.equal(verifySession(`${Number(expiry) + 60_000}.${signature}`), false);
  });

  test("rejects an expired cookie even with a valid signature", () => {
    const session = createSession();
    const [, signature] = session.value.split(".");
    const past = Date.now() - 1000;
    assert.equal(verifySession(`${past}.${signature}`), false);
  });

  test("rotating the password invalidates already-issued cookies", () => {
    const session = createSession();
    assert.equal(verifySession(session.value), true);

    const previous = process.env.AUTH_PASSWORD;
    process.env.AUTH_PASSWORD = "a-different-password";
    try {
      assert.equal(verifySession(session.value), false);
    } finally {
      process.env.AUTH_PASSWORD = previous;
    }
    assert.equal(verifySession(session.value), true, "restoring the password restores the session");
  });

  test("rotating AUTH_SECRET invalidates already-issued cookies", () => {
    const session = createSession();
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret";
    try {
      assert.equal(verifySession(session.value), false);
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });

  test("treats a misconfigured environment as unauthenticated, not an error", () => {
    const session = createSession();
    const previous = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      assert.equal(verifySession(session.value), false);
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });

  test("clearSession expires the cookie immediately", () => {
    const cleared = clearSession();
    assert.equal(cleared.maxAge, 0);
    assert.equal(cleared.value, "");
    assert.equal(verifySession(cleared.value), false);
  });
});
