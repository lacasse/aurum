import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  contributedIn,
  contributionRoom,
  clearAnswered,
  deferAsks,
  roomAsks,
  triggeredAsks,
  REGISTERED_PLANS,
  type ContributionLimits,
} from "./contributions";
import type { Account, Transaction } from "./types";
import { generateSampleData, generateSampleLimits } from "./sample";

/* ALL-FIXTURES-INVENTED */

const account = (id: string, registration: Account["registration"]): Account =>
  ({
    id,
    name: id,
    institution: "—",
    kind: "investment",
    balance: 0,
    history: [],
    registration,
  }) as Account;

const accounts = [
  account("tfsa-1", "TFSA"),
  account("rrsp-1", "RRSP"),
  account("fhsa-1", "FHSA"),
  account("cash-1", "non-registered"),
];

const deposit = (
  date: string,
  amount: number,
  destinationAccountId: string,
  sourceAccountId = "cash-1",
): Transaction => ({
  id: `t-${date}-${destinationAccountId}-${amount}`,
  date,
  type: "transfer",
  amount,
  category: "Transfer",
  payee: "Deposit",
  sourceAccountId,
  destinationAccountId,
});

describe("what was paid into a plan", () => {
  test("transfers into the plan's accounts, for that year only", () => {
    const txns = [
      deposit("2026-03-01", 1000, "tfsa-1"),
      deposit("2026-09-01", 500, "tfsa-1"),
      deposit("2025-11-01", 900, "tfsa-1"),
    ];
    assert.equal(contributedIn("2026", "TFSA", txns, accounts), 1500);
    assert.equal(contributedIn("2025", "TFSA", txns, accounts), 900);
  });

  test("each plan counts only its own accounts", () => {
    const txns = [deposit("2026-03-01", 1000, "tfsa-1"), deposit("2026-03-01", 400, "rrsp-1")];
    assert.equal(contributedIn("2026", "TFSA", txns, accounts), 1000);
    assert.equal(contributedIn("2026", "RRSP", txns, accounts), 400);
    assert.equal(contributedIn("2026", "FHSA", txns, accounts), 0);
  });

  test("money moved inside the plan is not a contribution", () => {
    const second = account("tfsa-2", "TFSA");
    const txns = [deposit("2026-04-01", 700, "tfsa-2", "tfsa-1")];
    assert.equal(contributedIn("2026", "TFSA", txns, [...accounts, second]), 0);
  });

  /*
   * Gross, not net. Taking money out does not hand the room back in the year
   * it was taken, so subtracting a withdrawal would report room that does not
   * exist and invite an over-contribution.
   */
  test("a withdrawal does not give the room back", () => {
    const txns = [
      deposit("2026-02-01", 2000, "tfsa-1"),
      { ...deposit("2026-06-01", 2000, "cash-1", "tfsa-1"), id: "w" },
    ];
    assert.equal(contributedIn("2026", "TFSA", txns, accounts), 2000);
  });

  test("income and spending are not contributions", () => {
    const txns: Transaction[] = [
      { ...deposit("2026-02-01", 100, "tfsa-1"), type: "income" },
      { ...deposit("2026-02-02", 100, "tfsa-1"), type: "expense", id: "e" },
    ];
    assert.equal(contributedIn("2026", "TFSA", txns, accounts), 0);
  });
});

describe("room for a year", () => {
  const limits: ContributionLimits = { "2026": { TFSA: 7000, RRSP: 30000 } };
  const txns = [deposit("2026-03-01", 5250, "tfsa-1"), deposit("2026-03-01", 1000, "fhsa-1")];

  test("what is left, and how much of it is used", () => {
    const [tfsa] = contributionRoom("2026", txns, accounts, limits);
    assert.equal(tfsa.limit, 7000);
    assert.equal(tfsa.contributed, 5250);
    assert.equal(tfsa.remaining, 1750);
    assert.equal(tfsa.used, 75);
    assert.equal(tfsa.over, false);
  });

  test("a plan with no room entered reports null rather than zero", () => {
    const room = contributionRoom("2026", txns, accounts, limits);
    const fhsa = room.find((r) => r.plan === "FHSA")!;
    assert.equal(fhsa.limit, null);
    assert.equal(fhsa.remaining, null);
    assert.equal(fhsa.used, null);
    // The deposit is still counted; only the room is unknown.
    assert.equal(fhsa.contributed, 1000);
  });

  test("over-contributing is reported, not clamped", () => {
    const over = [deposit("2026-03-01", 9000, "tfsa-1")];
    const [tfsa] = contributionRoom("2026", over, accounts, limits);
    assert.equal(tfsa.over, true);
    assert.equal(tfsa.remaining, -2000);
    assert.ok(tfsa.used! > 100);
  });

  test("the plans always come back in the same order", () => {
    assert.deepEqual(
      contributionRoom("2026", txns, accounts, limits).map((r) => r.plan),
      ["TFSA", "RRSP", "FHSA"],
    );
  });

  test("a plan nobody holds is marked as such", () => {
    const room = contributionRoom("2026", txns, [accounts[0]], limits);
    assert.equal(room.find((r) => r.plan === "RRSP")!.held, false);
    assert.equal(room.find((r) => r.plan === "TFSA")!.held, true);
  });

  test("a year with nothing entered still reports contributions", () => {
    const [tfsa] = contributionRoom("2026", txns, accounts, {});
    assert.equal(tfsa.limit, null);
    assert.equal(tfsa.contributed, 5250);
  });
});

/*
 * The question is keyed off the month being closed, never today's date: a
 * checklist run late is still that month's checklist and the answer is still
 * owed. It is also only worth asking when the account exists and the figure is
 * missing — a step that can only be skipped is worse than no step.
 */
describe("when the checklist should ask", () => {
  const held = accounts;

  test("closing December asks about next year's TFSA and FHSA", () => {
    // The January checklist. The limits for the year just started are known.
    assert.deepEqual(triggeredAsks("2026-12"), [
      { plan: "TFSA", year: "2027" },
      { plan: "FHSA", year: "2027" },
    ]);
  });

  test("closing March asks about this year's RRSP", () => {
    // The April checklist, by which point the notice of assessment has come.
    assert.deepEqual(triggeredAsks("2027-03"), [{ plan: "RRSP", year: "2027" }]);
  });

  test("every other month raises nothing", () => {
    for (const m of ["01", "02", "04", "05", "06", "07", "08", "09", "10", "11"]) {
      assert.deepEqual(triggeredAsks(`2027-${m}`), [], `2027-${m}`);
    }
  });

  test("a plan with no account is never asked about", () => {
    const noFhsa = held.filter((a) => a.registration !== "FHSA");
    assert.deepEqual(
      roomAsks("2026-12", {}, {}, noFhsa).map((a) => a.plan),
      ["TFSA"],
    );
  });

  test("holding nothing registered means nothing to ask", () => {
    assert.deepEqual(roomAsks("2026-12", {}, {}, [account("cash-1", "non-registered")]), []);
  });

  test("room already entered is not asked about again", () => {
    const limits: ContributionLimits = { "2027": { TFSA: 7000 } };
    assert.deepEqual(
      roomAsks("2026-12", limits, {}, held).map((a) => a.plan),
      ["FHSA"],
    );
  });

  test("zero is an answer, not a gap", () => {
    const limits: ContributionLimits = { "2027": { TFSA: 0, FHSA: 0 } };
    assert.deepEqual(roomAsks("2026-12", limits, {}, held), []);
  });
});

/*
 * "I do not have it yet" has to mean next month, not next year. The notice of
 * assessment arrives when it arrives, and a skip that waits for the next
 * trigger month turns a few weeks of not knowing into a year of an empty gauge.
 */
describe("putting the question off", () => {
  const held = accounts;

  test("a deferral brings the question back the following month", () => {
    const deferred = deferAsks("2026-12", triggeredAsks("2026-12"), {});
    // Not again in the same month it was put off in.
    assert.deepEqual(roomAsks("2026-12", {}, deferred, held), []);
    assert.deepEqual(
      roomAsks("2027-01", {}, deferred, held).map((a) => a.plan),
      ["FHSA", "TFSA"],
    );
  });

  test("and keeps coming back until it is answered", () => {
    const deferred = deferAsks("2026-12", triggeredAsks("2026-12"), {});
    assert.equal(roomAsks("2027-05", {}, deferred, held).length, 2);
    const answered: ContributionLimits = { "2027": { TFSA: 7000, FHSA: 8000 } };
    assert.deepEqual(roomAsks("2027-05", answered, deferred, held), []);
  });

  test("deferring one plan does not defer the other", () => {
    const deferred = deferAsks("2026-12", [{ plan: "FHSA", year: "2027" }], {});
    const limits: ContributionLimits = { "2027": { TFSA: 7000 } };
    assert.deepEqual(
      roomAsks("2027-02", limits, deferred, held).map((a) => a.plan),
      ["FHSA"],
    );
  });

  test("a deferred question and a new one are asked together", () => {
    const deferred = deferAsks("2026-12", [{ plan: "TFSA", year: "2027" }], {});
    const asks = roomAsks("2027-03", {}, deferred, held);
    assert.deepEqual(asks.map((a) => `${a.plan} ${a.year}`), [
      "RRSP 2027",
      "TFSA 2027",
    ]);
  });

  test("an answered deferral is cleared rather than left to linger", () => {
    const deferred = deferAsks("2026-12", triggeredAsks("2026-12"), {});
    const limits: ContributionLimits = { "2027": { TFSA: 7000 } };
    const tidied = clearAnswered(limits, deferred);
    assert.equal(tidied["2027"]?.TFSA, undefined);
    assert.equal(tidied["2027"]?.FHSA, "2026-12");
  });

  test("clearing every answered deferral leaves nothing behind", () => {
    const deferred = deferAsks("2026-12", triggeredAsks("2026-12"), {});
    const limits: ContributionLimits = { "2027": { TFSA: 7000, FHSA: 8000 } };
    assert.deepEqual(clearAnswered(limits, deferred), {});
  });
});

/*
 * The demo seeds room as well as deposits. A card whose figures all read "not
 * set" demonstrates only its own empty state, and the deposits alone are half
 * the picture — the half that matters is what they are measured against.
 */
describe("the demo's own contribution room", () => {
  const data = generateSampleData();
  const limits = generateSampleLimits(data);
  const year = String(new Date().getFullYear());

  test("every plan the demo holds is given room", () => {
    for (const plan of REGISTERED_PLANS) {
      if (!data.accounts.some((a) => a.registration === plan)) continue;
      assert.equal(typeof limits[year]?.[plan], "number", plan);
    }
  });

  test("the gauges land where they were meant to, not wherever the data fell", () => {
    const room = contributionRoom(year, data.transactions, data.accounts, limits);
    const used = (plan: string) => room.find((r) => r.plan === plan)?.used ?? 0;
    // Comfortable, nearly out, and barely started — the three states worth
    // showing. Loose bounds because the limits are rounded to a real-looking
    // figure rather than to whatever hits the ratio exactly.
    assert.ok(used("TFSA") > 45 && used("TFSA") <= 60, `TFSA ${used("TFSA")}`);
    assert.ok(used("RRSP") > 80 && used("RRSP") <= 98, `RRSP ${used("RRSP")}`);
    assert.ok(used("FHSA") > 20 && used("FHSA") <= 40, `FHSA ${used("FHSA")}`);
  });

  test("nothing is drawn as over-contributed", () => {
    const room = contributionRoom(year, data.transactions, data.accounts, limits);
    assert.deepEqual(room.filter((r) => r.over), []);
  });

  test("last year is seeded too, so the year picker has somewhere to go", () => {
    assert.ok(limits[String(Number(year) - 1)]);
  });
});
