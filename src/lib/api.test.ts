import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "./api";
import type { Account } from "./types";

test("two writes to one account reach the server in the order they were made", async () => {
  // The first request is slow and the second fast: sent at once, the first
  // would land last and undo the second.
  const arrived: number[] = [];
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const n = ++call;
    await new Promise((r) => setTimeout(r, n === 1 ? 30 : 0));
    arrived.push(JSON.parse(String(init?.body)).balanceUSD);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const acct = { id: "a1", balance: 0, balanceUSD: 0 } as Account;
    await Promise.all([
      api.updateAccount({ ...acct, balance: -10 }),
      api.updateAccount({ ...acct, balance: -10, balanceUSD: 5 }),
    ]);
    assert.deepEqual(arrived, [0, 5]);
  } finally {
    globalThis.fetch = original;
  }
});
