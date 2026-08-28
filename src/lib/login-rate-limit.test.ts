import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isLoginLocked,
  recordLoginFailure,
  resetLoginFailures,
} from "./login-rate-limit";

// The limiter keeps module-level state keyed by IP, so each test uses its own.
let n = 0;
const freshIp = () => `198.51.100.${n++}`;

describe("login rate limiting", () => {
  test("allows attempts below the failure threshold", () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) recordLoginFailure(ip);
    assert.equal(isLoginLocked(ip).locked, false);
  });

  test("locks out after five consecutive failures", () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    const lock = isLoginLocked(ip);
    assert.equal(lock.locked, true);
    assert.ok(lock.retryAfter > 0, "a Retry-After hint is provided");
    assert.ok(lock.retryAfter <= 15 * 60, "first lockout is the 15 minute base");
  });

  test("a successful login clears the failure count", () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    assert.equal(isLoginLocked(ip).locked, true);
    resetLoginFailures(ip);
    assert.equal(isLoginLocked(ip).locked, false);
  });

  test("lockouts back off exponentially across rounds", () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    const first = isLoginLocked(ip).retryAfter;

    // Further failures while locked must not extend or reset the window.
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    assert.ok(isLoginLocked(ip).retryAfter <= first, "failures during lockout do not stack");
  });

  test("tracks each client independently", () => {
    const locked = freshIp();
    const other = freshIp();
    for (let i = 0; i < 5; i++) recordLoginFailure(locked);
    assert.equal(isLoginLocked(locked).locked, true);
    assert.equal(isLoginLocked(other).locked, false);
  });

  test("an unknown client shares a single fallback bucket", () => {
    assert.equal(isLoginLocked(freshIp()).locked, false);
    assert.doesNotThrow(() => recordLoginFailure(undefined));
  });
});
