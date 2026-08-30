"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { Shell } from "@/components/shell";

/**
 * What the app cannot work out for itself.
 *
 * Most of what is on these pages is derived: balances follow from
 * transactions, returns from trades, spending from the categories on
 * imported rows. A few figures cannot be — nothing in a bank export says what
 * a defined benefit pension is worth — and those have to be entered. This
 * page is the list of them, and of where each one goes, so that a number
 * looking wrong somewhere has an obvious first place to check.
 */

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader title={title} subtitle={lead} />
      <div className="space-y-4 px-5 pb-5 text-sm leading-relaxed text-ink-dim">
        {children}
      </div>
    </Card>
  );
}

function Row({
  figure,
  source,
  where,
}: {
  figure: string;
  source: string;
  where: ReactNode;
}) {
  return (
    <tr className="border-t border-line/60 align-top">
      <td className="py-2.5 pr-4 font-medium text-ink">{figure}</td>
      <td className="py-2.5 pr-4">{source}</td>
      <td className="py-2.5">{where}</td>
    </tr>
  );
}

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-ink-faint">
          <tr>
            <th className="pb-1 pr-4 font-medium">Figure</th>
            <th className="pb-1 pr-4 font-medium">Where it comes from</th>
            <th className="pb-1 font-medium">Where you enter it</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function GuidePage() {
  return (
    <Shell
      title="How this works"
      subtitle="What the app works out for itself, and what it has to be told"
    >
      <div className="space-y-4">
        <Section
          id="pension"
          title="The defined benefit pension"
          lead="Two numbers that answer two different questions"
        >
          <p>
            A defined benefit pension is not an account holding money. What it
            holds is a promise: an income for life, earned by service. That
            promise has no balance, so the app tracks it through two figures
            which are not interchangeable.
          </p>
          <p>
            <strong className="text-ink">The transfer value</strong> — sometimes
            called the commuted value — is the lump sum the plan would pay out
            if you left. It is an actuarial figure: it moves with interest
            rates as much as with your service, and it includes the employer’s
            side. This is what appears in your net worth, because it is the
            only cash number the plan has. It is <em>not</em> money you can
            spend: it exists only on leaving, and mostly locked in.
          </p>
          <p>
            <strong className="text-ink">Your contributions</strong> are what
            came off your pay. The app already knows them — they arrive with
            every import as income in the{" "}
            <code className="rounded bg-elevated px-1 py-0.5 text-[12px]">
              RSP / Pension
            </code>{" "}
            category — so nothing needs entering. The gap between the two is
            shown as <em>beyond contributions</em>: the employer’s share plus
            growth, the part of the pension that never appeared on a pay stub.
          </p>
          <p>
            <strong className="text-ink">The annual pension and service</strong>{" "}
            answer the other question — what happens if you stay. They come off
            your yearly statement, they are optional, and they are shown for
            reference rather than counted anywhere.
          </p>
          <Table>
            <Row
              figure="Transfer value"
              source="Your pension plan, on request"
              where={
                <>
                  Monthly checklist → <strong>Update the pension</strong>, or{" "}
                  <Link href="/accounts" className="text-brand hover:underline">
                    Accounts
                  </Link>{" "}
                  → pencil
                </>
              }
            />
            <Row
              figure="Contributions"
              source="Derived from your transactions"
              where="Nothing to do — they come in with the monthly import"
            />
            <Row
              figure="Annual pension earned"
              source="Your annual statement"
              where={
                <>
                  <Link href="/accounts" className="text-brand hover:underline">
                    Accounts
                  </Link>{" "}
                  → pencil → Annual pension earned
                </>
              }
            />
            <Row
              figure="Pensionable service"
              source="Your annual statement"
              where={
                <>
                  <Link href="/accounts" className="text-brand hover:underline">
                    Accounts
                  </Link>{" "}
                  → pencil → Pensionable service
                </>
              }
            />
          </Table>
        </Section>

        <Section
          id="estimates"
          title="Skipping a month"
          lead="What happens when the figure isn’t to hand"
        >
          <p>
            The transfer value comes from the plan, and the plan is not always
            to hand at month end. Skipping that step of the checklist is a
            legitimate answer rather than a gap: the month is filled with the
            last real figure plus the contributions made since — money that
            certainly went in — and marked <strong>Estimated</strong> wherever
            it appears.
          </p>
          <p>
            The estimate is deliberately conservative. It ignores the
            employer’s share and any change in the actuarial value, so it runs
            low: an estimate that flattered your net worth would be worse than
            none at all. Enter a real figure at any time and it replaces the
            estimate for that month; earlier months are left exactly as they
            are.
          </p>
        </Section>

        <Section
          id="monthly"
          title="The rest of the month"
          lead="What the checklist collects, and what it derives"
        >
          <Table>
            <Row
              figure="Income"
              source="Entered, or imported from your activity export"
              where="Monthly checklist → Record income"
            />
            <Row
              figure="Spending and transfers"
              source="Your card statement and activity export"
              where={
                <>
                  <Link href="/import" className="text-brand hover:underline">
                    Import
                  </Link>{" "}
                  — both files, duplicates ignored
                </>
              }
            />
            <Row
              figure="Trades and dividends"
              source="Your activity export"
              where="Same import — reviewed before anything is written"
            />
            <Row
              figure="Month-end portfolio value"
              source="Prices, or your own correction"
              where="Monthly checklist → Portfolio snapshot"
            />
            <Row
              figure="Account balances"
              source="Derived from transactions"
              where={
                <>
                  Corrected on{" "}
                  <Link href="/accounts" className="text-brand hover:underline">
                    Accounts
                  </Link>{" "}
                  when a balance drifts
                </>
              }
            />
          </Table>
          <p>
            The snapshot is what makes the long charts possible. Prices are
            only carried for eighteen months, but a recorded month-end value is
            permanent — the all-time net worth and portfolio charts are built
            from those, which is why the record reaches back years further than
            any price feed.
          </p>
        </Section>

        <Section
          id="months"
          title="Which months a chart shows"
          lead="Why the current month is on some charts and not others"
        >
          <p>
            Anything comparing one month with the next stops at the last
            complete month: income against expenses, spending by category, the
            monthly averages, and the breakdown of an average month. A partial
            month drawn beside whole ones reads as a collapse, and the drop
            would be a fact about the calendar rather than about you.
          </p>
          <p>
            Charts whose last point is meant to be <em>now</em> — net worth,
            the portfolio, every balance — do include today. Those are not
            comparisons between months; they are the current state.
          </p>
        </Section>
      </div>
    </Shell>
  );
}
