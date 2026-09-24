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
  sessionUser,
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
  const USER = "user-1111";
  const OTHER = "user-2222";

  test("a freshly issued cookie verifies, and names its user and epoch", () => {
    const session = createSession(USER, 3);
    assert.equal(session.name, getSessionCookieName());
    assert.equal(session.httpOnly, true);
    assert.equal(session.sameSite, "lax");
    assert.equal(verifySession(session.value), true);
    assert.deepEqual(sessionUser(session.value), { userId: USER, epoch: 3 });
  });

  test("the epoch is signed, so an old cookie cannot claim a new one", () => {
    const session = createSession(USER, 1);
    const [id, , expiry, signature] = session.value.split(".");
    assert.equal(sessionUser(`${id}.2.${expiry}.${signature}`), null);
  });

  test("one user's cookie is never read as another's", () => {
    /*
     * The whole of multi-user rests on this: the id is signed with the rest of
     * the cookie, so swapping it in an otherwise valid cookie proves nothing.
     */
    const session = createSession(USER);
    const [, epoch, expiry, signature] = session.value.split(".");
    assert.equal(sessionUser(`${OTHER}.${epoch}.${expiry}.${signature}`), null);
    assert.notEqual(sessionUser(createSession(OTHER).value)?.userId, USER);
  });

  test("rejects missing, malformed and tampered cookies", () => {
    assert.equal(verifySession(undefined), false);
    assert.equal(verifySession(""), false);
    assert.equal(verifySession("no-separator"), false);
    assert.equal(verifySession("two.parts"), false);
    assert.equal(verifySession("three.part.cookie"), false);
    assert.equal(sessionUser(undefined), null);

    const session = createSession(USER);
    const [id, epoch, expiry, signature] = session.value.split(".");
    assert.equal(verifySession(`${id}.${epoch}.${expiry}.${signature}tampered`), false);
    // Extending the expiry invalidates the signature it was computed over.
    assert.equal(verifySession(`${id}.${epoch}.${Number(expiry) + 60_000}.${signature}`), false);
  });

  test("rejects an expired cookie even with a valid signature", () => {
    const session = createSession(USER);
    const [id, epoch, , signature] = session.value.split(".");
    const past = Date.now() - 1000;
    assert.equal(verifySession(`${id}.${epoch}.${past}.${signature}`), false);
  });

  test("an empty user id proves nothing", () => {
    assert.equal(sessionUser(`.0.${Date.now() + 1000}.signature`), null);
    assert.equal(sessionUser(`${USER}.x.${Date.now() + 1000}.signature`), null);
  });

  test("rotating AUTH_SECRET invalidates already-issued cookies", () => {
    const session = createSession("user-1111");
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-different-secret";
    try {
      assert.equal(verifySession(session.value), false);
    } finally {
      process.env.AUTH_SECRET = previous;
    }
  });

  test("treats a misconfigured environment as unauthenticated, not an error", () => {
    const session = createSession("user-1111");
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
