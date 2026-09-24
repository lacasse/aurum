import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bootstrapUserFromEnv } from "./bootstrap-user";
import { verifyPassword } from "./auth";

/* ALL-FIXTURES-INVENTED */

const HASH = "aa".repeat(16) + ":" + "bb".repeat(64);

describe("the first user, from an installation's own environment", () => {
  test("keeps an existing password hash exactly, so the login still works", () => {
    const user = bootstrapUserFromEnv({ AUTH_USERNAME: "owner", AUTH_PASSWORD_HASH: HASH });
    assert.equal(user?.passwordHash, HASH);
    assert.equal(user?.username, "owner");
    assert.equal(user?.role, "admin", "somebody has to be able to invite the second user");
  });

  test("hashes a plaintext password on the way in", () => {
    const user = bootstrapUserFromEnv({
      AUTH_USERNAME: "owner",
      AUTH_PASSWORD: "correct-horse-battery-staple",
    });
    assert.ok(user);
    assert.notEqual(user.passwordHash, "correct-horse-battery-staple");
    assert.equal(verifyPassword(user.passwordHash, "correct-horse-battery-staple"), true);
    assert.equal(verifyPassword(user.passwordHash, "wrong"), false);
  });

  test("the username is stored lowercase, so it is not case-sensitive", () => {
    assert.equal(bootstrapUserFromEnv({ AUTH_USERNAME: "Owner", AUTH_PASSWORD: "x".repeat(12) })?.username, "owner");
  });

  test("a hash is preferred over a plaintext password when both are set", () => {
    const user = bootstrapUserFromEnv({
      AUTH_USERNAME: "owner",
      AUTH_PASSWORD_HASH: HASH,
      AUTH_PASSWORD: "ignored-password",
    });
    assert.equal(user?.passwordHash, HASH);
  });

  test("nothing to build an account from is not an error", () => {
    /*
     * A new installation with no credentials in its environment is expected:
     * it has no users yet and says so on first run, rather than refusing to
     * start the way the single-user version did.
     */
    assert.equal(bootstrapUserFromEnv({}), null);
    assert.equal(bootstrapUserFromEnv({ AUTH_USERNAME: "owner" }), null);
    assert.equal(bootstrapUserFromEnv({ AUTH_PASSWORD: "x".repeat(12) }), null);
    assert.equal(bootstrapUserFromEnv({ AUTH_USERNAME: "  ", AUTH_PASSWORD: "x" }), null);
  });

  test("two calls make two ids, so a retry cannot collide with the first", () => {
    const a = bootstrapUserFromEnv({ AUTH_USERNAME: "owner", AUTH_PASSWORD_HASH: HASH });
    const b = bootstrapUserFromEnv({ AUTH_USERNAME: "owner", AUTH_PASSWORD_HASH: HASH });
    assert.notEqual(a?.id, b?.id);
  });
});
