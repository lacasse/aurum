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
        <thead className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
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
            <code className="rounded bg-elevated px-1 py-0.5 text-[0.75rem]">
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
          id="rewards"
          title="Staking rewards"
          lead="Tokens that arrive without being bought"
        >
          <p>
            A reward is not a free acquisition, however it looks on a
            statement. It is two things at once:{" "}
            <strong className="text-ink">income</strong> equal to what the
            tokens were worth on the day they landed, and an{" "}
            <strong className="text-ink">acquisition</strong> of those tokens at
            that same value. The second half is what keeps the cost base
            honest — the amount counts once as income, and because it is also
            the cost, it is not counted again as a capital gain when the tokens
            are sold.
          </p>
          <p>
            Recorded as arriving for nothing, the income disappears and the
            whole future sale becomes a gain. So the app writes the pair
            instead, and no cash moves: a reward is paid in tokens, not into
            your account.
          </p>
          <p>
            The one figure it cannot work out is the value on the day — it
            fetches today’s price and nothing else. Enter a reward without one
            and the units are still recorded, flagged, and listed on the
            Investments page until you fill it in.
          </p>
          <Table>
            <Row
              figure="Units received"
              source="Your wallet or exchange"
              where={
                <>
                  <Link href="/investments" className="text-brand hover:underline">
                    Investments
                  </Link>{" "}
                  → Log trades → <strong>Staking reward</strong>
                </>
              }
            />
            <Row
              figure="Value on the day"
              source="The price in CAD when the tokens landed"
              where="Same row, or later from the card that lists rewards without one"
            />
          </Table>
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
          id="spending"
          title="Necessity, choice, and neither"
          lead="The three judgements the expenses page makes about a category"
        >
          <p>
            Every category on the{" "}
            <Link href="/expenses" className="text-brand hover:underline">
              expenses page
            </Link>{" "}
            sits in one of three groups. A{" "}
            <strong className="text-ink">necessity</strong> arrives whether or
            not the month went well — rent, food, getting to work, keeping a
            body and a dog alive. A{" "}
            <strong className="text-ink">choice</strong> is decided one
            purchase at a time, and it is the part a bad quarter can actually
            move. Everything else is{" "}
            <strong className="text-ink">neither</strong>, and is left out of
            every total on that page.
          </p>
          <p>
            Debt repayment starts in that third group. Paying down a loan is
            not consumption: the money leaves chequing and lands on the other
            side of the balance sheet as debt that no longer exists. Counted as
            spending it both overstates what living costs and understates what
            was saved — it is what made 2024 read as a year that spent $132,000
            and kept nothing.
          </p>
          <p>
            The split is a default rather than a rule — donations may feel less
            optional than groceries — so any category can be moved with the
            Categories button on that page. Only the departures from the
            defaults are stored, which is why a category added later still
            picks up a sensible side rather than whatever the map happened to
            say when it was last saved.
          </p>
        </Section>

        <Section
          id="running-costs"
          title="What a car costs"
          lead="Why the average is divided by months owned rather than months billed"
        >
          <p>
            The card takes the month you say ownership started, the categories
            you say its costs land in, and divides the total by every calendar
            month since — including the ones with no charge at all. A car costs
            what it costs in the months it is not filled up, and averaging over
            only the months with a receipt would price it off its expensive
            months alone.
          </p>
          <p>
            The starting point is yours to choose because it changes the
            question. Starting from the purchase includes the purchase, which
            is the true cost of having owned it; starting after includes only
            what it takes to keep running. If the car shares a category with
            anything else, that comes along too — separating it means giving
            the car a category of its own.
          </p>
        </Section>

        <Section
          id="checklist"
          title="What the monthly checklist covers"
          lead="One month, closed in order, and only that month"
        >
          <p>
            The checklist closes the month that has just finished, not the one
            running. Everything it imports is trimmed to that month: rows dated
            earlier belong to a close already done, and rows from the current
            month belong to the next one. A statement downloaded on the third
            carries a few days of both, and without the trim those days would
            land silently in the wrong month&apos;s totals.
          </p>
          <p>
            The file is read first, because every step after it is a review of
            what the file said — income is a total of it, spending is a list of
            it, trades are read out of it. Each is editable.
          </p>
          <p>
            <strong className="text-ink">Nothing is written until the last
            step.</strong> Every step collects; the final one lists exactly
            what is about to be recorded and saves the lot at once. Closing the
            dialog before then discards all of it and changes nothing. The
            steps used to save as you left them, which meant abandoning the
            checklist halfway left half a month behind — income recorded
            against a month whose spending was never reviewed, or trades posted
            before the snapshot meant to value them. Income is dated the last
            day of the month being closed, whatever day the checklist is
            actually done on.
          </p>
          <p>
            The pension figure is recorded against the month that ended, not
            the day the checklist is done — a figure entered on the second or
            third is near enough to the month-end it stands for, and the
            alternative was a single run writing to two different months.
          </p>
          <p>
            <strong className="text-ink">The portfolio snapshot is not a step
            any more.</strong> It was a table of sixty prices to scroll past,
            and nobody edits a price they have no better source for than the
            app itself. Saving the month records what is held, taken{" "}
            <em>after</em> the trades land — so it values the portfolio the
            month actually ended with, including a position opened in that very
            save.
          </p>
          <p>
            <strong className="text-ink">Nothing takes a snapshot outside the
            checklist.</strong> There is no scheduled job: if you never close a
            month, that month has no closing value, and every chart reaching
            back through it draws a straight line across the hole — which looks
            like a quiet month rather than a missing one. So the months that
            are missing, or that hold a fraction of the positions the months
            around them hold, are counted on the checklist button.
          </p>
          <p>
            For anything older, use{" "}
            <Link href="/import" className="text-brand hover:underline">
              Import
            </Link>
            , which takes whatever you have and does not care what month it is
            from.
          </p>
        </Section>

        <Section
          id="imports"
          title="What a statement is read for"
          lead="Three things the file already says, and is no longer asked about"
        >
          <p>
            <strong className="text-ink">Which account a row came out of.</strong>{" "}
            A brokerage activity export names the account on every line. That
            used to be read only when the line named a registered account, so
            chequing rows arrived with no account at all — and anything
            unattributed was filed against the credit card. A month of
            pre-authorized debits and e-transfers was recorded as card
            spending. The row&apos;s own word comes first now, then the
            file&apos;s kind, since a card statement really is one account from
            top to bottom.
          </p>
          <p>
            <strong className="text-ink">Which sign means money leaving.</strong>{" "}
            Some exports write spending as a negative number, some as a
            positive one, and some carry an explicit Debit/Credit column. Every
            row is read first, the convention is decided for the file as a
            whole, and only then are directions assigned — so a card statement
            is not read with a bank&apos;s rule. An explicit column always
            beats an inferred sign.
          </p>
          <p>
            <strong className="text-ink">Which position a trade belongs
            to.</strong> A broker writes the venue into the symbol —{" "}
            <code>TSLA.NEO</code>, <code>XEQT.TO</code> — and a position held
            under the plain symbol looked like a security nobody owned, so a
            routine buy opened a second holding beside the first. The venue is
            ignored when matching now. An exact match still wins, and where a
            venue-less symbol matches two holdings the account decides; if it
            is still ambiguous the row is left alone, because{" "}
            <code>MA</code> and <code>MA.NEO</code> in one account really are
            two different securities — Mastercard and its CDR.
          </p>
          <p>
            One thing it does ask: a repayment is the only kind of spending
            whose far side cannot be guessed. Every other expense ends at the
            merchant; a repayment ends at a debt, and which debt decides whose
            balance comes down.
          </p>
        </Section>

        <Section
          id="gains"
          title="Realized, unrealized, and the cost base"
          lead="Why a closed position still shows in a row you have just reopened"
        >
          <p>
            Cost base is <strong className="text-ink">average cost, per
            account</strong>, and selling part of a position disposes of the
            same fraction of its cost. Per-account matters: a loss in a TFSA is
            not deductible and its cost base is not worth tracking, while the
            same trade in a non-registered account is the one figure that is.
          </p>
          <p>
            The gain column on the holdings table pools{" "}
            <em>unrealized + realized + dividends</em> across every account and
            every closed lot. So if you sold out of something at a loss and
            bought back in two years later, the row shows the old loss rather
            than how the new position is doing. Both are true; they answer
            different questions. The open position&apos;s cost base is
            unaffected by the closed one — the sale took the whole of its cost
            with it.
          </p>
          <p>
            Two rules this app does not apply, and which matter at filing time.
            The <strong className="text-ink">superficial loss</strong> rule
            denies a loss where the same security is bought back within 30 days
            either side of the sale, and adds it to the cost base of the
            repurchase instead. And a return of capital reduces cost base
            without being a sale. Neither is worked out here.
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
