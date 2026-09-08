import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  contributedIn,
  contributionRoom,
  plansDueForUpdate,
  roomEntered,
  type ContributionLimits,
} from "./contributions";
import type { Account, Transaction } from "./types";

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
 * Keyed off the month being closed rather than today's date: a checklist run
 * late is still that month's checklist, and the question is still owed.
 */
describe("when the checklist should ask", () => {
  test("closing January asks about the TFSA and FHSA", () => {
    assert.deepEqual(plansDueForUpdate("2027-01"), ["TFSA", "FHSA"]);
  });

  test("closing March asks about the RRSP", () => {
    assert.deepEqual(plansDueForUpdate("2027-03"), ["RRSP"]);
  });

  test("every other month asks nothing", () => {
    for (const m of ["02", "04", "05", "06", "07", "08", "09", "10", "11", "12"]) {
      assert.deepEqual(plansDueForUpdate(`2027-${m}`), [], `2027-${m}`);
    }
  });

  test("the year asked about is the closed month's own year", () => {
    // Closing January 2027 happens in February 2027 and sets 2027's room.
    assert.equal(roomEntered("2027", plansDueForUpdate("2027-01"), {
      "2027": { TFSA: 7000, FHSA: 8000 },
    }), true);
  });

  test("room is not entered until every plan asked about has a figure", () => {
    const limits: ContributionLimits = { "2027": { TFSA: 7000 } };
    assert.equal(roomEntered("2027", ["TFSA", "FHSA"], limits), false);
    assert.equal(roomEntered("2027", ["TFSA"], limits), true);
  });

  test("zero is a figure, not a missing one", () => {
    assert.equal(roomEntered("2027", ["RRSP"], { "2027": { RRSP: 0 } }), true);
  });
});
