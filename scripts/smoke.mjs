#!/usr/bin/env node
/*
 * End-to-end smoke test against a running server and a real PostgreSQL.
 *
 * This covers the seam the other suites cannot: unit tests never touch HTTP,
 * and the repository integration test never goes through a route handler. The
 * bugs that have actually escaped to production here lived in between — a field
 * accepted by the form and dropped before the INSERT, for one — so these
 * assertions go through the API exactly as the browser does.
 *
 * It makes no outbound network calls. EODHD_DAY_LIMIT is pinned to 0 by CI, and
 * one of the assertions below proves the price route then spends nothing.
 *
 * Run against an already-running app:
 *   BASE_URL=http://127.0.0.1:3000 node scripts/smoke.mjs
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const USER = process.env.AUTH_USERNAME ?? "ci";
const PASS = process.env.AUTH_PASSWORD ?? "ci-smoke-only-not-a-real-password";

let failures = 0;
function expect(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

/*
 * The session cookie is marked Secure in production builds, so a cookie jar
 * would refuse to send it back over plain HTTP. Carrying the value by hand
 * keeps the test on the real production build instead of a weakened one.
 */
let cookie = "";

async function api(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    if (c.startsWith("aurum_session=")) cookie = c.split(";")[0];
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not every response is JSON */
  }
  return { status: res.status, body };
}

async function waitForServer() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${BASE} never became ready`);
}

async function main() {
  await waitForServer();

  console.log("authentication");
  expect((await api("/api/data")).status === 401, "unauthenticated read is refused");
  expect(
    (await api("/api/login", { method: "POST", body: JSON.stringify({ username: USER, password: "wrong" }) })).status === 401,
    "a wrong password is refused",
  );
  const login = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  expect(login.status === 200, `login succeeds (got ${login.status})`);
  expect(cookie !== "", "login sets a session cookie");

  /*
   * CI gets a fresh database every run, but a local re-run would otherwise trip
   * over its own rows from last time. Clearing first makes the script
   * repeatable without needing to recreate the database.
   */
  for (const id of ["smoke-txn-1", "smoke-txn-2"]) {
    await api(`/api/transactions/${id}`, { method: "DELETE" });
  }
  for (const id of ["smoke-tfsa", "smoke-chq"]) {
    await api(`/api/accounts/${id}`, { method: "DELETE" });
  }

  console.log("seeded state");
  const seeded = await api("/api/data");
  expect(seeded.status === 200, "authenticated read succeeds");
  const state = seeded.body ?? {};
  /*
   * What the seeded state must contain, rather than how many rows it has.
   *
   * This script runs under plain node and cannot import the generator, so the
   * counts here were literals — and every addition to the sample broke this
   * suite for being right, which teaches you to edit the number rather than
   * read the failure. What the route actually has to prove is that a first run
   * arrives whole and with the shapes the app reads: accounts of every kind,
   * positions carrying their trade history, budgets and categories present.
   * `src/lib/sample.test.ts` is where the sample's own coverage is asserted.
   */
  const kinds = new Set((state.accounts ?? []).map((a) => a.kind));
  for (const kind of ["checking", "savings", "investment", "credit", "loan", "pension"]) {
    expect(kinds.has(kind), `a ${kind} account was seeded`);
  }
  expect((state.holdings?.length ?? 0) >= 10, `seeded holdings (got ${state.holdings?.length})`);
  expect(
    (state.holdings ?? []).every((h) => (h.flows?.length ?? 0) > 0),
    "every seeded holding arrives with its trades",
  );
  expect((state.budgets?.length ?? 0) > 0, `seeded budgets (got ${state.budgets?.length})`);
  expect((state.categories?.length ?? 0) > 0, `seeded categories (got ${state.categories?.length})`);

  /*
   * Registration has been silently dropped twice, between the form and the
   * INSERT, in a way every unit test still passed through. Assert it survives a
   * real round trip.
   */
  console.log("account round trip");
  const tfsa = {
    id: "smoke-tfsa",
    name: "Smoke TFSA",
    institution: "Test Bank",
    kind: "investment",
    balance: 1000,
    history: [],
    registration: "TFSA",
  };
  expect(
    (await api("/api/accounts", { method: "POST", body: JSON.stringify(tfsa) })).status === 200,
    "an account can be created",
  );
  const chequing = { ...tfsa, id: "smoke-chq", name: "Smoke Chequing", kind: "checking", balance: 500, registration: undefined };
  await api("/api/accounts", { method: "POST", body: JSON.stringify(chequing) });

  let after = (await api("/api/data")).body;
  const savedTfsa = after.accounts.find((a) => a.id === "smoke-tfsa");
  expect(savedTfsa !== undefined, "the new account is read back");
  expect(savedTfsa?.registration === "TFSA", `registration survives the round trip (got ${savedTfsa?.registration})`);
  expect(Number(savedTfsa?.balance) === 1000, `balance survives the round trip (got ${savedTfsa?.balance})`);

  console.log("transactions move both sides");
  const transfer = {
    id: "smoke-txn-1",
    date: "2026-01-15",
    type: "transfer",
    amount: 250,
    category: "Transfer",
    sourceAccountId: "smoke-chq",
    destinationAccountId: "smoke-tfsa",
    payee: "Smoke transfer",
  };
  expect(
    (await api("/api/transactions", { method: "POST", body: JSON.stringify(transfer) })).status === 200,
    "a transfer is accepted",
  );
  after = (await api("/api/data")).body;
  const chqAfter = Number(after.accounts.find((a) => a.id === "smoke-chq").balance);
  const tfsaAfter = Number(after.accounts.find((a) => a.id === "smoke-tfsa").balance);
  expect(chqAfter === 250, `the source account is debited (500 - 250, got ${chqAfter})`);
  expect(tfsaAfter === 1250, `the destination account is credited (1000 + 250, got ${tfsaAfter})`);

  const selfTransfer = { ...transfer, id: "smoke-txn-2", destinationAccountId: "smoke-chq" };
  expect(
    (await api("/api/transactions", { method: "POST", body: JSON.stringify(selfTransfer) })).status === 400,
    "a transfer to the same account is rejected",
  );

  /*
   * The whole point of the quota work: with the limit pinned to 0 the route
   * must return last-known/absent prices and report the ticker as stale rather
   * than reaching for the provider.
   */
  console.log("EODHD quota");
  const prices = await api("/api/prices?tickers=XEQT.TO&classes=US%20Equity&currencies=CAD");
  expect(prices.status === 200, "the price route responds");
  expect(prices.body?.quota?.limit === 0, `the pinned limit is in force (got ${prices.body?.quota?.limit})`);
  expect(prices.body?.quota?.used === 0, `no calls were spent (got ${prices.body?.quota?.used})`);
  expect(
    Array.isArray(prices.body?.stale) && prices.body.stale.includes("XEQT.TO"),
    "an unpriceable CAD ticker is reported as stale",
  );

  /*
   * Twelve Data is capped the same way. CI pins both windows to zero, so the
   * route must report nothing spendable and reach for no provider at all.
   */
  expect(prices.body?.twelveData?.minute?.limit === 0, `the per-minute cap is pinned (got ${prices.body?.twelveData?.minute?.limit})`);
  expect(prices.body?.twelveData?.day?.used === 0, `no Twelve Data credits were spent (got ${prices.body?.twelveData?.day?.used})`);

  console.log("destructive endpoints demand confirmation");
  expect(
    (await api("/api/demo", { method: "DELETE", body: JSON.stringify({}) })).status === 400,
    "deleting demo data without a confirmation token is refused",
  );

  console.log("logout");
  await api("/api/logout", { method: "POST" });
  expect((await api("/api/data")).status === 401, "the session is dead after logout");
}

main()
  .then(() => {
    if (failures) {
      console.error(`\n${failures} smoke assertion(s) failed`);
      process.exit(1);
    }
    console.log("\nsmoke: all assertions passed");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
