"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  PiggyBank,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  Segmented,
  cn,
} from "@/components/ui";
import {
  AllocationBar,
  GroupedBars,
  RoomGauge,
  SeriesChart,
  SignedHBars,
  Waterfall,
  YearSankey,
} from "@/components/charts";
import { accent as accentFor } from "@/lib/palette";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  allTimeSeries,
  firstFlowMonth,
  monthsSince,
  netExternalFlows,
  netWorthByClass,
  netWorthOver,
  portfolioSeries,
} from "@/lib/analytics";
import {
  categoryShifts,
  contributionsVsValue,
  incomeAllocation,
  incomeTypeAmounts,
  incomeTypeShares,
  yearFlow,
  unearnedShare,
  yearRows,
  yearShapes,
  yearWaterfall,
} from "@/lib/year";
import { groupOf, type SpendGroup } from "@/lib/expenses";
import {
  REGISTERED_PLANS,
  contributionRoom,
  type ContributionLimits,
  type RegisteredPlan,
} from "@/lib/contributions";
import { fmtCAD, fmtCompact, fmtPct, fmtSignedCAD } from "@/lib/format";

/** A colour per plan, so the same gauge is the same colour every time. */
const PLAN_TONE = {
  TFSA: "brand",
  RRSP: "market",
  FHSA: "passive",
} as const;

/**
 * A year at a time.
 *
 * Every figure here exists month by month elsewhere in the app. What a year
 * adds is the comparison — whether this one is better than the last — which is
 * the question the spreadsheet's Year sheet was built to answer and the one
 * the dashboard, always looking at the last twelve months, cannot.
 */
export default function YearPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const transactions = useFinance((s) => s.transactions);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const [year, setYear] = useState<string | null>(null);
  const [limits, setLimits] = useState<ContributionLimits>({});
  const [roomOpen, setRoomOpen] = useState(false);
  /*
   * Which categories count as necessities, as the owner has set them.
   *
   * Read rather than assumed: the Expenses page lets the split be reassigned,
   * and a year page working from the defaults would put the same spending in a
   * different half from the page it came from. Two answers to one question is
   * the fault, not the mild inaccuracy.
   */
  const [spendGroups, setSpendGroups] = useState<Record<string, SpendGroup>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/expense-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: { groups?: Record<string, SpendGroup> }) => {
        if (!cancelled) setSpendGroups(s.groups ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contribution-limits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { limits?: ContributionLimits }) => {
        if (!cancelled) setLimits(d.limits ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLimits = useCallback((next: ContributionLimits) => {
    setLimits(next);
    fetch("/api/contribution-limits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limits: next }),
    }).catch(() => {});
  }, []);

  /*
   * Recorded month-end portfolio values, from the store: four pages draw a
   * chart from this history and it is fetched once for all of them.
   */
  const snapshots = useFinance((s) => s.snapshotHistory);
  const loadSnapshotHistory = useFinance((s) => s.loadSnapshotHistory);
  useEffect(() => {
    loadSnapshotHistory();
  }, [loadSnapshotHistory]);

  const data = useMemo(() => {
    const starts = [Object.keys(snapshots).sort()[0] ?? null, firstFlowMonth(holdings)].filter(
      (m): m is string => m !== null,
    );
    const start = starts.length > 0 ? starts.sort()[0] : null;
    const portfolio = start
      ? allTimeSeries(holdings, {}, monthsSince(start), snapshots).points
      : portfolioSeries(holdings, 18);
    const netWorth = netWorthOver(accounts, portfolio, usdCadRate);
    const rows = yearRows(transactions, netWorth, portfolio, netExternalFlows(holdings));
    /*
     * The balance sheet, month by month, so each year can be closed on the last
     * month the record actually reaches rather than on a December that may not
     * have happened yet.
     */
    const classes = start
      ? netWorthByClass(accounts, holdings, {}, monthsSince(start), snapshots, usdCadRate)
      : [];
    return {
      rows,
      shapes: yearShapes(rows, classes),
    };
  }, [accounts, holdings, transactions, snapshots, usdCadRate]);

  if (!ready) return <PageSkeleton />;

  if (data.rows.length === 0) {
    return (
      <Shell title="Year" subtitle="Every year on record, against the one before">
        <EmptyState
          title="No years yet"
          subtitle="A year appears once there are transactions or balances in it."
        />
      </Shell>
    );
  }

  const selected = data.rows.find((r) => r.year === year) ?? data.rows[0];
  const before = data.rows[data.rows.indexOf(selected) + 1];
  const pct = (now: number, then: number | undefined) =>
    then !== undefined && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : undefined;

  // Named so the footnote can say what the compounding is measured from: on a
  // record that opens at a peak, growth since then is a different claim.
  const cagrBase = [...data.rows].reverse().find((r) => r.netWorth > 0)?.year ?? null;


  const bars = [...data.rows]
    .reverse()
    .map((r) => ({
      label: r.year,
      income: r.income,
      expenses: r.expenses,
      // The difference, not the rate: it belongs on the same axis as the two
      // figures it comes from.
      saved: r.income - r.expenses,
    }));

  const room = contributionRoom(selected.year, transactions, accounts, limits);
  const shape = data.shapes.find((sh) => sh.year === selected.year);
  const allocation = incomeAllocation(transactions, selected.year, (c) =>
    groupOf(c, spendGroups),
  );
  const shifts = categoryShifts(transactions, selected.year);
  const contributions = contributionsVsValue(data.rows);
  const latestGap =
    contributions.length > 0
      ? contributions[contributions.length - 1].value -
        contributions[contributions.length - 1].contributed
      : null;
  const typeShares = incomeTypeShares(transactions);
  /*
   * The figures beside the chart, for the year being read — a band too thin to
   * see is answered by the number under it rather than by drawing it bigger.
   */
  const typeRow = typeShares.find((r) => r.label === selected.year);
  const typeLast = typeRow
    ? { ...incomeTypeAmounts(transactions, selected.year), shares: typeRow }
    : null;
  const flow = yearFlow(transactions, selected.year, {
    accounts,
    holdings,
    spendGroup: (c) => groupOf(c, spendGroups),
  });
  const unearned = unearnedShare(transactions, selected.year);
  const balanceBars = data.shapes.map((sh) => ({
    label: sh.year,
    Cash: sh.cash,
    Bonds: sh.bonds,
    Stocks: sh.stocks,
    Crypto: sh.crypto,
    Pension: sh.pension,
  }));

  return (
    <Shell
      title="Year"
      subtitle="Every year on record, against the one before"
      action={
        <Segmented<string>
          options={data.rows.slice(0, 5).map((r) => ({ value: r.year, label: r.year }))}
          value={selected.year}
          onChange={setYear}
        />
      }
    >
      <div className="space-y-4">
        {!selected.complete && (
          <p className="px-1 text-[0.6875rem] text-ink-faint">
            {selected.year} is still running — its totals are the year so far, and
            the comparison is against a full year.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Income · ${selected.year}`}
            value={fmtCAD(selected.income)}
            delta={pct(selected.income, before?.income)}
            deltaLabel={before ? `vs ${before.year}` : "first year on record"}
            icon={<ArrowDownRight size={16} className="text-positive" />}
          />
          <StatCard
            label="Expenses"
            value={fmtCAD(selected.expenses)}
            delta={selected.expenseGrowth ?? undefined}
            deltaLabel={before ? `vs ${before.year}` : "first year on record"}
            tone={
              selected.expenseGrowth === null
                ? "neutral"
                : selected.expenseGrowth <= 0
                  ? "positive"
                  : "negative"
            }
            icon={<ArrowUpRight size={16} className="text-negative" />}
          />
          <StatCard
            label="Savings rate"
            value={selected.savingsRate === null ? "—" : `${selected.savingsRate.toFixed(1)}%`}
            deltaValue={fmtSignedCAD(selected.netCashflow)}
            deltaLabel="kept out of what came in"
            tone={selected.netCashflow >= 0 ? "positive" : "negative"}
            icon={<PiggyBank size={16} />}
          />
          <StatCard
            label="Net worth at year end"
            value={fmtCAD(selected.netWorth)}
            deltaValue={
              selected.netWorthChange === null
                ? undefined
                : fmtSignedCAD(selected.netWorthChange)
            }
            deltaLabel={before ? `vs ${before.year}` : "first year on record"}
            tone={(selected.netWorthChange ?? 0) >= 0 ? "positive" : "negative"}
            icon={<Wallet size={16} />}
          />
        </div>

        {/*
          * The year's movement beside the year's cash flow.
          *
          * The waterfall says what net worth did and the bars say what passed
          * through to do it, so the two answer each other: a year whose middle
          * columns are thin and whose closing column still rose was carried by
          * the market rather than by what was earned. Reading that used to
          * mean scrolling between them.
          */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shape && (
            <Card>
              <CardHeader
                title={`How ${selected.year} moved`}
                subtitle="Opening net worth, what passed through the year, and where it closed"
              />
              <div className="px-3 pb-4">
                <Waterfall steps={yearWaterfall(shape)} format={(n) => fmtCompact(n)} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Income against spending"
              subtitle="Every year on record, side by side"
            />
            <div className="px-3 pb-4">
              {/*
                * Saved is the difference, in dollars, so it shares the axis. A
                * rate would not: a percentage against a scale of dollars is a
                * flat line on the floor, and it would need an axis of its own to
                * say anything.
                */}
              <GroupedBars
                data={bars as unknown as Record<string, unknown>[]}
                xKey="label"
                bars={[
                  { key: "income", name: "Income", color: accentFor("positive") },
                  { key: "expenses", name: "Expenses", color: accentFor("negative") },
                  { key: "saved", name: "Saved", color: accentFor("brand") },
                ]}
                height={260}
                yFmt={fmtCompact}
              />
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/*
            * The balance sheet across years: what the money is, not what it did.
            *
            * Stacked rather than lined up side by side, because the question is
            * composition — a portfolio that stops being mostly cash is a
            * different portfolio, and that shift is invisible in four separate
            * lines.
            */}
          {balanceBars.length > 1 && (
            <Card>
              <CardHeader
                title="Balance sheet composition"
                subtitle="Where the money sits at the end of each year, and what is owed against it"
              />
              <div className="px-3 pb-4">
                {/*
                  * Bars, not an area. An area chart reads a trend between its
                  * points, and there is nothing between two year ends — the
                  * record has no June for a year it has already closed. Stacked
                  * columns say what each year *was*, which is the question.
                  */}
                <GroupedBars
                  data={balanceBars as unknown as Record<string, unknown>[]}
                  xKey="label"
                  stacked
                  bars={[
                    { key: "Cash", name: "Cash", color: accentFor("market") },
                    { key: "Bonds", name: "Bonds", color: accentFor("bonds") },
                    { key: "Stocks", name: "Stocks", color: accentFor("brand") },
                    { key: "Crypto", name: "Crypto", color: accentFor("cost") },
                    { key: "Pension", name: "Pension", color: accentFor("pension") },
                  ]}
                  yFmt={(n: number) => fmtCompact(n)}
                  height={240}
                />
              </div>
              <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
                {shape && [
                  { label: "Assets", value: shape.assets },
                  { label: "Owed", value: -shape.liabilities },
                  { label: "Net worth", value: shape.netWorth },
                  {
                    label: "Cash share",
                    value: null,
                    text: shape.assets > 0 ? `${Math.round((shape.cash / shape.assets) * 100)}%` : "—",
                  },
                ].map((c) => (
                  <div key={c.label} className="bg-surface px-4 py-2.5">
                    <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                      {c.label}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums">
                      {c.text ?? fmtCAD(c.value ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/*
            * Room is the one limit here the app cannot work out for itself. It
            * depends on income, on room carried forward and on withdrawals made
            * years ago, all of it stated on a notice of assessment — so the
            * figure is entered, and what has been paid in against it is counted.
            */}
          <Card>
            <CardHeader
              title="Contribution room"
              subtitle={`What you have paid into each registered plan in ${selected.year}`}
              action={
                <Button variant="ghost" size="sm" onClick={() => setRoomOpen(true)}>
                  <SlidersHorizontal size={14} /> Set room
                </Button>
              }
            />
            <div className="grid grid-cols-1 gap-6 px-4 pb-5 pt-1 sm:grid-cols-3">
              {room.map((r) => (
                <RoomGauge
                  key={r.plan}
                  label={r.plan}
                  used={r.used}
                  tone={PLAN_TONE[r.plan]}
                  over={r.over}
                  caption={
                    r.limit === null
                      ? `${fmtCAD(r.contributed)} paid in`
                      : `${fmtCAD(r.contributed)} of ${fmtCAD(r.limit)}`
                  }
                  detail={
                    r.limit === null
                      ? r.held
                        ? "Room not set for this year"
                        : "No account of this type"
                      : r.over
                        ? `${fmtCAD(Math.abs(r.remaining!))} over the limit`
                        : `${fmtCAD(r.remaining!)} left`
                  }
                />
              ))}
            </div>
            {room.some((r) => r.over) && (
              <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] text-negative">
                An over-contribution is charged 1% a month on the excess until it is
                withdrawn. Check the figure against your notice of assessment before
                acting on it.
              </p>
            )}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/*
            * The savings rate is one number and hides the interesting part: a
            * year that kept a fifth of its income says nothing about whether
            * the other four fifths were rent or restaurants. Splitting the
            * whole of income at once puts the cost of living, the choices and
            * the debt beside what was kept.
            */}
          <Card>
            <CardHeader
              title={`Where ${selected.year}'s income went`}
              subtitle="Every dollar that came in, and what became of it"
            />
            <div className="px-5 pb-5">
              <AllocationBar
                total={allocation.income}
                format={(n) => fmtCAD(n)}
                parts={[
                  { label: "Necessities", value: allocation.necessities, colour: accentFor("cost") },
                  { label: "Discretionary", value: allocation.discretionary, colour: accentFor("negative") },
                  { label: "Debt repaid", value: allocation.debt, colour: accentFor("bonds") },
                  { label: "Kept", value: Math.max(0, allocation.saved), colour: accentFor("positive") },
                ]}
              />
              {allocation.saved < 0 && (
                <p className="mt-3 text-[0.6875rem] leading-relaxed text-negative">
                  {selected.year} spent {fmtCAD(Math.abs(allocation.saved))} more than
                  it earned. The bar shows where the income went; the shortfall came
                  from savings or borrowing.
                </p>
              )}
            </div>
          </Card>

          {/*
            * A total says this year cost more than the last one. It never says
            * what did — and a category that moved is the one thing on this
            * page that can be acted on, where a total is a fact about the past.
            */}
          <Card>
            <CardHeader
              title="What changed"
              subtitle={
                shifts.length > 0
                  ? `Spending by category against ${Number(selected.year) - 1}`
                  : "Nothing to compare against yet"
              }
            />
            {shifts.length > 0 ? (
              <div className="px-3 pb-4">
                <SignedHBars
                  data={shifts.map((r) => ({ label: r.category, value: r.change }))}
                  labelKey="label"
                  valueKey="value"
                  fmt={(n) => fmtSignedCAD(n)}
                  height={Math.max(160, shifts.length * 30)}
                  positiveColor={accentFor("negative")}
                  negativeColor={accentFor("positive")}
                />
                <p className="px-2 pt-1 text-[0.6875rem] text-ink-faint">
                  Spending more is drawn as the unwelcome direction, so the
                  colours mean the same thing here as everywhere else on the
                  page.
                </p>
              </div>
            ) : (
              <p className="px-5 pb-5 text-xs text-ink-dim">
                A comparison needs the year before it. This is the first year on
                record.
              </p>
            )}
          </Card>
        </div>

        {/*
          * The year itself, rather than a question about it. Income on the
          * left, the accounts it landed in down the middle, and everything it
          * left for on the right — with each account forced to reconcile, so
          * the chart cannot show more leaving one than reached it.
          */}
        {flow.nodes.length > 0 && (
          <Card>
            <CardHeader
              title={`Every dollar of ${selected.year}`}
              subtitle="Where the money came from, where it landed, and what it became"
            />
            <div className="px-3 pb-4">
              <YearSankey
                nodes={flow.nodes}
                links={flow.links}
                format={(n) => fmtCompact(n)}
              />
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] leading-relaxed text-ink-faint">
              The second column is everything that arrived in an account you can
              spend from, and each bar balances on its own. Cards count as
              spendable: paying one off is a transfer between your own accounts,
              which this chart leaves out, so drawing the card apart left its
              spending with no visible funding. Pay that goes straight into a
              registered plan never arrives in one of your accounts, so it is not
              counted here — which is why this is smaller than the
              year&rsquo;s income. Spending ends at necessity or discretion
              rather than at a column of categories: the same split as the
              Expenses page, and reassignable there. A deposit into the invested
              bar and a purchase inside it are two different events, so the
              deposit moves the money and the purchase is what it became, broken
              down by asset class. A pension contribution is its own class there,
              beside the things that were bought — the plan has no trades to
              import, an entitlement accrues instead, and measured against
              purchases it would read as a shortfall. Selling appears on the left, because a sale is
              money arriving. Dividends are not taken from the trade history —
              they are already income under their own category. Transfers between
              two cash accounts are left out, because the same dollar would be
              counted twice. Anything that left an account income never reached
              comes in as “From savings”; anything the invested bar took in with
              no purchase to account for is “Not itemised”, which is cash sitting
              there or trades that were never imported.
            </p>
          </Card>
        )}

        {/*
          * Compounding, as a picture rather than a percentage. The lines start
          * together and separate; the gap is every dollar the portfolio earned
          * rather than received.
          */}
        {contributions.length > 1 && (
          <Card>
            <CardHeader
              title="Investment compounding"
              subtitle="Everything paid into the portfolio, beside what it is worth"
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={contributions as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "contributed", name: "Paid in", color: accentFor("cost"), kind: "line" },
                  { key: "value", name: "Worth", color: accentFor("brand") },
                ]}
                yFmt={(n: number) => fmtCompact(n)}
                height={240}
              />
            </div>
            {latestGap !== null && (
              <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] leading-relaxed text-ink-faint">
                The gap is {fmtCAD(Math.abs(latestGap))} the portfolio{" "}
                {latestGap >= 0 ? "has earned" : "is behind"} on what was paid
                into it. Withdrawals pull the lower line down, so a year that
                sold something narrows the gap without anything having been lost.
              </p>
            )}
          </Card>
        )}

        {/*
          * Two categories, not five. The full breakdown answers what the money
          * was; this answers the only question about it that changes a life —
          * active income stops when you do, passive income does not, and the
          * share of one against the other is the distance between having a job
          * and not needing one.
          */}
        {typeShares.length > 1 && (
          <Card>
            <CardHeader
              title="Income type"
              subtitle={
                unearned === null
                  ? "Active against passive, year by year"
                  : `${Math.round(unearned)}% of ${selected.year} did not come from working`
              }
            />
            {/*
              * The same treatment as net worth composition on the dashboard,
              * and for the same reason. Drawing a small band larger than it is
              * was tried there and rejected: it buys the thin band a visible
              * line at the cost of every other band being wrong, which is a bad
              * trade in a chart whose whole subject is proportion. The figures
              * underneath are what answer for a band too thin to read.
              */}
            <div className="px-3 pb-2">
              <SeriesChart
                data={typeShares as unknown as Record<string, unknown>[]}
                xKey="label"
                stacked
                fadeAtZero
                series={[
                  /*
                   * Active along the bottom, passive above it. The boundary
                   * between the two is then a single line, and passive is the
                   * gap between that line and the top of the chart — a distance
                   * to the ceiling rather than a sliver on the floor, which is
                   * the easier of the two to see change.
                   */
                  { key: "Active", name: "Active", color: accentFor("brand") },
                  { key: "Passive", name: "Passive", color: accentFor("cost") },
                ]}
                height={280}
                yDomain={[0, 100]}
                yFmt={(n: number) => `${Math.round(n)}%`}
              />
            </div>
            {typeLast && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-5">
                {(["Passive", "Active"] as const).map((k) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <span
                      className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: accentFor(k === "Passive" ? "cost" : "brand") }}
                    />
                    <span className="text-[0.6875rem] text-ink-faint">{k}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {fmtCompact(typeLast[k])}
                    </span>
                    <span className="text-[0.6875rem] tabular-nums text-ink-faint">
                      {Math.round(Number(typeLast.shares[k]))}%
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] leading-relaxed text-ink-faint">
              A pension contribution counts as active — it is deferred pay off
              the same hours as the salary it comes from. A pension paying out
              counts as passive.
            </p>
          </Card>
        )}


        <Card>
          <CardHeader
            title="Year by year"
            subtitle="What came in, what it grew to, and what the portfolio did with it"
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2 text-left font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Income</th>
                  <th className="px-3 py-2 text-right font-medium">Expenses</th>
                  <th className="px-3 py-2 text-right font-medium">Growth</th>
                  <th className="px-3 py-2 text-right font-medium">Kept</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Net worth</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  <th className="px-3 py-2 text-right font-medium">Portfolio</th>
                  <th className="px-3 py-2 text-right font-medium">Cost basis</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                  <th className="px-3 py-2 text-right font-medium">Invested</th>
                  <th className="px-3 py-2 text-right font-medium">Return</th>
                  <th className="px-3 py-2 text-right font-medium">CAGR</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.year}
                    onClick={() => setYear(r.year)}
                    className={cn(
                      "cursor-pointer border-t border-line/60 hover:bg-elevated",
                      r.year === selected.year && "bg-elevated",
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums">
                      {r.year}
                      {!r.complete && (
                        <span className="ml-2 text-[0.625rem] font-normal text-ink-faint">
                          so far
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtCAD(r.income)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtCAD(r.expenses)}</td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        r.expenseGrowth === null
                          ? "text-ink-faint"
                          : r.expenseGrowth <= 0
                            ? "text-positive"
                            : "text-negative",
                      )}
                    >
                      {r.expenseGrowth === null ? "—" : fmtPct(r.expenseGrowth)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        r.netCashflow >= 0 ? "text-ink" : "text-negative",
                      )}
                    >
                      {fmtSignedCAD(r.netCashflow)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {r.savingsRate === null ? "—" : `${r.savingsRate.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {fmtCAD(r.netWorth)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        (r.netWorthChange ?? 0) >= 0 ? "text-positive" : "text-negative",
                      )}
                    >
                      {r.netWorthChange === null ? "—" : fmtSignedCAD(r.netWorthChange)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(r.portfolio)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtCAD(r.costBasis)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        r.investmentProfit >= 0 ? "text-positive" : "text-negative",
                      )}
                    >
                      {fmtSignedCAD(r.investmentProfit)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-dim">
                      {fmtSignedCAD(r.investmentFlows)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        r.portfolioReturn === null
                          ? "text-ink-faint"
                          : r.portfolioReturn >= 0
                            ? "text-positive"
                            : "text-negative",
                      )}
                    >
                      {r.portfolioReturn === null ? "—" : fmtPct(r.portfolioReturn)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-faint">
                      {r.cagr === null ? "—" : fmtPct(r.cagr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
            <strong className="text-ink-dim">Kept</strong> is everything in less
            everything out, and <strong className="text-ink-dim">rate</strong> is
            that over what came in.{" "}
            <strong className="text-ink-dim">Invested</strong> is money moved into
            holdings, less money taken out, so it is contribution rather than
            growth. <strong className="text-ink-dim">Return</strong> chains the
            year&apos;s months with deposits taken out of the arithmetic, which is
            what makes it comparable between years that were funded differently.
            {cagrBase ? (
              <>
                {" "}
                <strong className="text-ink-dim">CAGR</strong> compounds net
                worth from {cagrBase}, the first year the record has a positive
                one — it says nothing about the years before the record starts.
              </>
            ) : null}
          </p>
        </Card>

        <Modal
          open={roomOpen}
          onClose={() => setRoomOpen(false)}
          title="Registered contribution room"
        >
          <ContributionRoomForm
            year={selected.year}
            limits={limits}
            onSave={saveLimits}
            onClose={() => setRoomOpen(false)}
          />
        </Modal>
      </div>
    </Shell>
  );
}

/**
 * Entering a year's room, one field per plan.
 *
 * Deliberately a plain form over a wizard: this is three numbers copied off a
 * notice of assessment once a year, and the only thing it owes the reader is
 * saying which year they are typing into — a figure entered against the wrong
 * year is invisible afterwards, because both years look plausible.
 *
 * Blank is a meaningful answer and means "not set", which the gauge draws
 * differently from zero. Clearing a field removes the figure rather than
 * storing a nought, because a nought is a real limit: it says you may not
 * contribute at all.
 */
function ContributionRoomForm({
  year,
  limits,
  onSave,
  onClose,
}: {
  year: string;
  limits: ContributionLimits;
  onSave: (next: ContributionLimits) => void;
  onClose: () => void;
}) {
  const [editYear, setEditYear] = useState(year);
  const [draft, setDraft] = useState<Record<RegisteredPlan, string>>(() =>
    fieldsFor(year, limits),
  );
  const [error, setError] = useState("");

  const changeYear = (next: string) => {
    setEditYear(next);
    setDraft(fieldsFor(next, limits));
    setError("");
  };

  const submit = () => {
    const forYear: Partial<Record<RegisteredPlan, number>> = {};
    for (const plan of REGISTERED_PLANS) {
      const raw = draft[plan].trim().replace(/[$,\s]/g, "");
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${plan} room must be an amount, or left blank.`);
        return;
      }
      forYear[plan] = Math.round(value * 100) / 100;
    }
    const next = { ...limits };
    if (Object.keys(forYear).length === 0) delete next[editYear];
    else next[editYear] = forYear;
    onSave(next);
    onClose();
  };

  const years = yearChoices(editYear);

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-ink-dim">
        Copy these from your notice of assessment or your CRA account. The app
        counts what you have paid in; it cannot know what you are allowed to.
      </p>

      <label className="block">
        <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
          Year
        </span>
        <select
          value={editYear}
          onChange={(e) => changeYear(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-3">
        {REGISTERED_PLANS.map((plan) => (
          <label key={plan} className="block">
            <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              {plan} room for {editYear}
            </span>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 focus-within:border-ink-faint">
              <span className="text-sm text-ink-faint">$</span>
              <input
                inputMode="decimal"
                placeholder="Not set"
                value={draft[plan]}
                onChange={(e) => setDraft((d) => ({ ...d, [plan]: e.target.value }))}
                className="w-full bg-transparent text-sm tabular-nums outline-none"
              />
            </div>
          </label>
        ))}
      </div>

      {error ? <p className="text-xs text-negative">{error}</p> : null}

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={submit}>Save room</Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function fieldsFor(
  year: string,
  limits: ContributionLimits,
): Record<RegisteredPlan, string> {
  const forYear = limits[year] ?? {};
  return {
    TFSA: forYear.TFSA?.toString() ?? "",
    RRSP: forYear.RRSP?.toString() ?? "",
    FHSA: forYear.FHSA?.toString() ?? "",
  };
}

/**
 * The years worth offering: a few back, and the next one.
 *
 * Next year is there because a TFSA limit is announced before the year it
 * applies to, and the obvious moment to record it is when you read it.
 */
function yearChoices(around: string): string[] {
  const here = new Date().getFullYear();
  const n = Number(around);
  const set = new Set<string>();
  for (let y = here + 1; y >= here - 6; y--) set.add(String(y));
  if (Number.isFinite(n)) set.add(String(n));
  return [...set].sort((a, b) => b.localeCompare(a));
}
