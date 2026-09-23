import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  process.env.AUTH_SECRET = "test-secret-not-used-anywhere-real";
});

import { createSession } from "./auth";
import { resolveSession } from "./session-check";

const users = new Map<string, { id: string; sessionEpoch: number }>();
const lookup = async (id: string) => users.get(id) ?? null;

describe("a signed cookie is only as good as its user", () => {
  test("a current cookie for an existing user is accepted", async () => {
    users.set("u1", { id: "u1", sessionEpoch: 0 });
    const cookie = createSession("u1", 0).value;
    assert.equal((await resolveSession(cookie, lookup))?.id, "u1");
  });

  test("changing the password ends the sessions issued before it", async () => {
    users.set("u2", { id: "u2", sessionEpoch: 0 });
    const before = createSession("u2", 0).value;
    users.set("u2", { id: "u2", sessionEpoch: 1 }); // what setUserPassword does
    assert.equal(await resolveSession(before, lookup), null);
    const after = createSession("u2", 1).value;
    assert.equal((await resolveSession(after, lookup))?.id, "u2");
  });

  test("a removed user's cookie stops working", async () => {
    users.set("u3", { id: "u3", sessionEpoch: 0 });
    const cookie = createSession("u3", 0).value;
    users.delete("u3");
    assert.equal(await resolveSession(cookie, lookup), null);
  });

  test("no cookie, or a bad one, is nobody", async () => {
    assert.equal(await resolveSession(undefined, lookup), null);
    assert.equal(await resolveSession("a.0.1.b", lookup), null);
  });
});
