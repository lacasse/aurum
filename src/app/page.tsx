"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Coins,
  Gauge,
  LineChart,
  Timer,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Button, Card, CardHeader, Progress, Segmented } from "@/components/ui";
import { DonutChart, SeriesChart, categoryColors } from "@/components/charts";
import { TransactionForm } from "@/components/forms";
import { MonthlyChecklistButton, MonthlyChecklistModal } from "@/components/monthly-checklist";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  allTimeSeries,
  avgSpendByCategory,
  cashflowSeries,
  consolidateHoldings,
  firstFlowMonth,
  monthlyAverages,
  monthsSince,
  fiProgress,
  savingsRate,
  runwayMonths,
  DEFAULT_WITHDRAWAL_RATE,
  netWorthByClass,
  netWorthOver,
  NET_WORTH_CLASSES,
  type NetWorthClass,
  portfolioSeries,
  stackedSpend,
  type SnapshotHistory,
} from "@/lib/analytics";
import {
  fmtCompact,
  fmtPct,
  fmtSignedCAD,
  fmtCAD,
  labelMonth,
  lastCompleteMonthKey,
} from "@/lib/format";
import { snapshotGaps } from "@/lib/checklist";
import { ACCOUNT_KIND_LABELS } from "@/lib/types";
import { roundMoney } from "@/lib/money";

/**
 * A colour per band of net worth.
 *
 * Cash and the pension keep the colours they carry on the accounts page, so a
 * band means the same thing wherever it is drawn; the portfolio's three sit
 * between them, cool to warm as they get more volatile.
 */
const CLASS_COLORS: Record<NetWorthClass, string> = {
  Cash: "#8b5cf6",
  Bonds: "#60a5fa",
  Stocks: "#22d3ee",
  Crypto: "#a3e635",
  Pension: "#f59e0b",
};

/** How much of the net worth history to draw: months, or the whole record. */
type Range = "12" | "60" | "all";

/**
 * A year-over-year move for one of the average-month figures.
 *
 * Percent only when there is a positive figure to be a percent *of*: a change
 * from minus two hundred to plus fifty is a real improvement and "−125%" says
 * nothing true about it, so the money is the answer there. `good` is which
 * direction is the welcome one — spending more is not an improvement.
 */
function yearOverYear(
  now: number,
  before: number | undefined,
  good: "up" | "down",
): { delta?: number; deltaValue: string; tone: "positive" | "negative" | "neutral" } {
  if (before === undefined) return { deltaValue: "", tone: "neutral" };
  const change = roundMoney(now - before);
  const rose = change >= 0;
  const tone = change === 0 ? "neutral" : (rose === (good === "up") ? "positive" : "negative");
  return {
    delta: before > 0 ? (change / before) * 100 : undefined,
    deltaValue: fmtSignedCAD(change),
    tone,
  };
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1 pt-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
        {title}
      </h2>
      <span className="text-[11px] text-ink-faint">{note}</span>
    </div>
  );
}

export default function DashboardPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const holdings = useFinance((s) => s.holdings);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const [range, setRange] = useState<Range>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotHistory>({});
  const [rate, setRate] = useState("0.035");

  /*
   * Recorded month-end portfolio values. They reach back years further than
   * the eighteen months of prices carried on the holdings, which is what makes
   * an all-time net worth line possible at all. Fetched once: it is history.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/snapshots/history", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { months: SnapshotHistory }) => {
        if (!cancelled) setSnapshots(d.months ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useMemo(() => {
    /*
     * Everything that compares one month with the next stops at the last
     * complete month. The month in progress is a partial one, and drawn beside
     * whole months it reads as a collapse in both income and spending.
     */
    const through = lastCompleteMonthKey();

    /*
     * How far back this chart can honestly go: the first month there is any
     * portfolio data for.
     *
     * It used to start at the first recorded account balance, which is over a
     * year earlier, and drew the portfolio as $0 across all of those months —
     * stating as fact something that was merely unrecorded. Net worth went
     * with it, showing tens of thousands *below* zero for months when the
     * portfolio was the largest thing owned. A month with no portfolio figure
     * is not a month with no portfolio, so the line begins where the record
     * does. The cash and debt before then are still drawn in full on the
     * accounts page, where no portfolio is claimed.
     */
    const starts = [
      Object.keys(snapshots).sort()[0] ?? null,
      firstFlowMonth(holdings),
    ].filter((m): m is string => m !== null);
    const historyStart = starts.length > 0 ? starts.sort()[0] : null;

    /*
     * The portfolio side of net worth, over the whole record. Until the
     * recorded values arrive this falls back to the eighteen months the
     * holdings carry themselves, so the chart is never empty.
     */
    const portAll =
      historyStart && Object.keys(snapshots).length > 0
        ? allTimeSeries(holdings, {}, monthsSince(historyStart), snapshots).points
        : portfolioSeries(holdings, 18);

    const nwAll = netWorthOver(accounts, portAll, usdCadRate);
    const cf = cashflowSeries(transactions, 12, through);
    /*
     * What a month costs, on average, rather than what last month happened to
     * cost. One month is mostly noise — a car repair or an annual premium
     * lands in it and the breakdown is about that, not about you — and the
     * average is also what the four cards above it report.
     *
     * The stacked chart below is the same twelve months seen month by month,
     * so both take their categories from this one ranking: same order, same
     * colours, and the legend beside the donut serves the pair.
     */
    const spend = avgSpendByCategory(transactions, 12, through);
    const catColors = categoryColors(spend.map((c) => c.name));
    const topCats = spend.slice(0, 5).map((c) => c.name);
    const stacked = stackedSpend(
      transactions,
      topCats,
      12,
      through,
    ) as unknown as Record<string, unknown>[];
    /*
     * Net worth and the portfolio on one set of months.
     *
     * They were two charts, and the second was mostly a redrawing of the
     * first: the portfolio is four fifths of net worth, so the two lines had
     * the same shape and the same peaks a card apart. Together they answer
     * the question the pair was really posing — how much of this is the
     * market, and how much is everything else — which is the gap between the
     * lines. The cost basis runs under both, so the distance from it is the
     * gain.
     */
    /*
     * What net worth is made of, rather than what it adds up to. The line
     * above says it doubled; these bands say the doubling was crypto.
     */
    const byClass = historyStart
      ? netWorthByClass(
          accounts,
          holdings,
          {},
          monthsSince(historyStart),
          snapshots,
          usdCadRate,
        )
      : [];
    const port = portAll.map((p, i) => ({
      ...nwAll[i],
      value: p.value,
      cost: p.cost,
    }));
    const avg = monthlyAverages(transactions, 12);
    /*
     * What net worth is made of. The portfolio is the largest part of it and
     * moves on its own, so the top row breaks it out rather than leaving one
     * number to stand for everything.
     */
    const rows = consolidateHoldings(holdings).filter((r) => !r.closed);
    const invested = rows.reduce((sum, r) => sum + r.costBasis, 0);
    const market = rows.reduce((sum, r) => sum + r.marketValue, 0);
    const dividends = rows.reduce((sum, r) => sum + r.totalDividends, 0);
    /*
     * Months the portfolio record never got. Counted here because the history
     * is already loaded for the chart, and shown on the checklist button —
     * nothing takes a snapshot on its own, so a skipped month stays skipped
     * until somebody is told.
     */
    const gaps = snapshotGaps(
      Object.fromEntries(
        Object.entries(snapshots).map(([m, t]) => [m, Object.keys(t).length]),
      ),
      through,
    ).length;

    return {
      through,
      snapshotGaps: gaps,
      nwAll,
      cf,
      spend,
      catColors,
      stacked,
      topCats,
      port,
      byClass,
      avg,
      invested,
      market,
      dividends,
    };
  }, [accounts, transactions, holdings, snapshots, usdCadRate]);

  const nw = useMemo(
    () => (range === "all" ? data.port : data.port.slice(-Number(range))),
    [data.port, range],
  );
  const bandsLast = data.byClass[data.byClass.length - 1];
  const bands = useMemo(
    () => (range === "all" ? data.byClass : data.byClass.slice(-Number(range))),
    [data.byClass, range],
  );

  if (!ready) return <PageSkeleton />;

  const nwLast = nw[nw.length - 1];
  const nwPrev = nw[nw.length - 2] ?? nwLast;
  const nwDelta =
    nwPrev.net !== 0 ? ((nwLast.net - nwPrev.net) / Math.abs(nwPrev.net)) * 100 : 0;
  const nwFirst = data.nwAll[0];

  const portLast = data.port[data.port.length - 1];
  const portPrev = data.port[data.port.length - 2] ?? portLast;
  const portDelta =
    portPrev.value !== 0
      ? ((portLast.value - portPrev.value) / portPrev.value) * 100
      : 0;
  // Dividends count: they are return the position paid out rather than kept.
  const unrealized = data.market - data.invested + data.dividends;
  const unrealizedPct = data.invested > 0 ? (unrealized / data.invested) * 100 : 0;

  const prev = data.avg.previous;
  /*
   * Two ratios that need no window of their own: both read the twelve-month
   * averages above them, so all six cards answer for the same months.
   */
  const saved = savingsRate(data.avg.income, data.avg.expenses);
  const savedBefore = prev ? savingsRate(prev.income, prev.expenses) : null;
  const runway = runwayMonths(nwLast.assets, data.avg.expenses);

  const yoy = {
    income: yearOverYear(data.avg.income, prev?.income, "up"),
    expenses: yearOverYear(data.avg.expenses, prev?.expenses, "down"),
    uncommittedLiquid: yearOverYear(data.avg.uncommittedLiquid, prev?.uncommittedLiquid, "up"),
    passive: yearOverYear(data.avg.passive, prev?.passive, "up"),
    /*
     * A rate is already a percentage, so the change is in points and the
     * "percent of a percent" a ratio would give is not a thing anybody wants.
     */
    savings:
      saved !== null && savedBefore !== null
        ? {
            delta: undefined,
            deltaValue: `${savedBefore <= saved ? "+" : ""}${(saved - savedBefore).toFixed(1)} pts`,
            tone: (saved >= savedBefore ? "positive" : "negative") as
              | "positive"
              | "negative",
          }
        : { delta: undefined, deltaValue: "", tone: "neutral" as const },
  };

  const fi = fiProgress(nwLast.net, data.avg.expenses, Number(rate) || DEFAULT_WITHDRAWAL_RATE);

  const spark = data.nwAll.slice(-18);
  const totalSpend = data.spend.reduce((s, c) => s + c.value, 0);
  const monthName = labelMonth(data.through);

  return (
    <Shell
      title="Dashboard"
      subtitle="Your complete financial picture at a glance"
      action={
        <div className="flex items-center gap-2">
          <MonthlyChecklistButton
            onOpen={() => setChecklistOpen(true)}
            gaps={data.snapshotGaps}
          />
          <Button onClick={() => setAddOpen(true)}>
            <ArrowUpRight size={15} /> Add transaction
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <SectionHeading title="Net worth" note="what you own, as it stands today" />

        {/* What net worth is made of */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Net Worth"
            value={fmtCAD(nwLast.net)}
            delta={nwDelta}
            deltaLabel="vs last month"
            icon={<Wallet size={16} />}
            spark={spark.map((p) => ({ v: p.net }))}
            sparkKey="v"
            sparkColor="#8b5cf6"
          />
          <StatCard
            label="Investments"
            value={fmtCAD(data.market)}
            delta={portDelta}
            deltaLabel="vs last month"
            icon={<LineChart size={16} />}
            spark={data.port.slice(-18).map((p) => ({ v: p.value }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Unrealized gain"
            value={fmtSignedCAD(unrealized)}
            delta={unrealizedPct}
            deltaLabel="of what you paid"
            tone={unrealized >= 0 ? "positive" : "negative"}
            icon={<TrendingUp size={16} />}
          />
          <StatCard
            label="Cash and accounts"
            value={fmtCAD(nwLast.assets)}
            deltaLabel="balances you can draw on"
            tone={nwLast.assets >= 0 ? "neutral" : "negative"}
            icon={<Banknote size={16} />}
            spark={spark.map((p) => ({ v: p.assets }))}
            sparkKey="v"
            sparkColor="#f59e0b"
          />
        </div>

        {/*
          * How much of a life the money already pays for.
          *
          * The target is not a figure anybody entered: a year of spending at
          * the rate you would draw at is what it takes to fund that year
          * forever. Which also means net worth over the target and the payout
          * over a month's spending are the same percentage, so one number
          * answers both.
          */}
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-dim">
                Financial independence
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {fi.pct.toFixed(1)}%
                <span className="ml-2 text-sm font-normal text-ink-faint">
                  of {fmtCAD(fi.target)}
                </span>
              </p>
            </div>
            <Segmented<string>
              options={[
                { value: "0.03", label: "3%" },
                { value: "0.035", label: "3.5%" },
                { value: "0.04", label: "4%" },
              ]}
              value={rate}
              onChange={setRate}
            />
          </div>
          <Progress value={fi.pct} max={100} tone="positive" className="mt-4" />
          <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[11px] text-ink-faint">
            <span>
              Pays{" "}
              <span className="font-medium tabular-nums text-ink-dim">
                {fmtCAD(fi.monthly)}
              </span>{" "}
              a month at {(fi.rate * 100).toFixed(1)}%
            </span>
            <span>
              A month costs{" "}
              <span className="font-medium tabular-nums text-ink-dim">
                {fmtCAD(data.avg.expenses)}
              </span>
            </span>
            <span>
              Still short{" "}
              <span className="font-medium tabular-nums text-ink-dim">
                {fmtCAD(fi.shortfall)}
              </span>{" "}
              a month
            </span>
          </div>
        </Card>

        {/* The whole record, in one chart */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Net worth and portfolio"
              subtitle={
                nwLast.pension > 0
                  ? `${fmtCAD(nwLast.assets)} cash + ${fmtCAD(nwLast.portfolio)} portfolio + ${fmtCAD(nwLast.pension)} pension − ${fmtCAD(nwLast.liabilities)} debt`
                  : `${fmtCAD(nwLast.assets)} cash + ${fmtCAD(nwLast.portfolio)} portfolio − ${fmtCAD(nwLast.liabilities)} debt`
              }
              action={
                <div className="flex items-center gap-2">
                  <Segmented<Range>
                    options={[
                      { value: "12", label: "1Y" },
                      { value: "60", label: "5Y" },
                      { value: "all", label: "All" },
                    ]}
                    value={range}
                    onChange={setRange}
                  />
                  <Link href="/investments">
                    <Button variant="ghost" size="sm">
                      Details <ArrowRight size={13} />
                    </Button>
                  </Link>
                </div>
              }
            />
            <div className="px-3 pb-4">
              {/*
                * Three lines that only mean something together: what you are
                * worth, how much of it is the market, and what the market
                * cost you. The gap between the first two is everything that
                * is not the portfolio; the gap between the last two is the
                * gain.
                */}
              <SeriesChart
                data={nw as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "net", name: "Net worth", color: "#8b5cf6" },
                  { key: "value", name: "Portfolio", color: "#22d3ee" },
                  {
                    key: "cost",
                    name: "Cost basis",
                    color: "#6e6e79",
                    kind: "line",
                    dashed: true,
                  },
                ]}
                height={320}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Accounts"
              subtitle={`${accounts.length} connected`}
              action={
                <Link href="/accounts">
                  <Button variant="ghost" size="sm">
                    All <ArrowRight size={13} />
                  </Button>
                </Link>
              }
            />
            <ul className="space-y-1 px-3 pb-4">
              {accounts.slice(0, 6).map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-elevated"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-[11px] text-ink-faint">
                      {ACCOUNT_KIND_LABELS[a.kind]} · {a.institution}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 text-sm font-semibold tabular-nums">
                    {fmtCAD(a.balance)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="What net worth is made of"
            subtitle={`${NET_WORTH_CLASSES.filter((c) => (bandsLast?.[c] ?? 0) > 0).join(" · ")} — stacked to what you own`}
          />
          <div className="px-3 pb-4">
            {/*
              * The same months as the line above, kept apart by what they are.
              * Net worth doubling tells you nothing about what did it; six
              * bands do, and the shape of the mix is the part that changes
              * slowly enough to act on.
              */}
            <SeriesChart
              data={bands as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              series={NET_WORTH_CLASSES.map((name) => ({
                key: name,
                name,
                color: CLASS_COLORS[name],
              }))}
              height={300}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        <SectionHeading
          title="Cash flow"
          note={`12-month averages · complete months only · through ${monthName}`}
        />

        {/* How the months average out */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Monthly income"
            value={fmtCAD(data.avg.income)}
            delta={yoy.income.delta}
            deltaValue={yoy.income.deltaValue}
            deltaLabel="vs the year before"
            tone={yoy.income.tone}
            icon={<ArrowDownRight size={16} className="text-positive" />}
            spark={data.avg.series.map((p) => ({ v: p.income }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Monthly expenses"
            value={fmtCAD(data.avg.expenses)}
            delta={yoy.expenses.delta}
            deltaValue={yoy.expenses.deltaValue}
            deltaLabel="vs the year before"
            tone={yoy.expenses.tone}
            icon={<ArrowUpRight size={16} className="text-negative" />}
            spark={data.avg.series.map((p) => ({ v: p.expenses }))}
            sparkKey="v"
            sparkColor="#fb7185"
          />
          <StatCard
            label="Monthly uncommitted liquid cash flow"
            value={fmtCAD(data.avg.uncommittedLiquid)}
            delta={yoy.uncommittedLiquid.delta}
            deltaValue={yoy.uncommittedLiquid.deltaValue}
            deltaLabel="vs the year before"
            tone={yoy.uncommittedLiquid.tone}
            icon={<PiggyBank size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.uncommittedLiquid }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Monthly passive income"
            value={fmtCAD(data.avg.passive)}
            delta={yoy.passive.delta}
            deltaValue={yoy.passive.deltaValue}
            deltaLabel="vs the year before"
            tone={yoy.passive.tone}
            icon={<Coins size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.passive }))}
            sparkKey="v"
            sparkColor="#a78bfa"
          />
          <StatCard
            label="Savings rate"
            value={saved === null ? "—" : `${saved.toFixed(1)}%`}
            delta={yoy.savings.delta}
            deltaValue={yoy.savings.deltaValue}
            deltaLabel="vs the year before"
            tone={yoy.savings.tone}
            icon={<Gauge size={16} />}
          />
          <StatCard
            label="Runway"
            value={runway === null ? "—" : `${runway.toFixed(1)} mo`}
            deltaValue={fmtCAD(nwLast.assets)}
            deltaLabel="of cash, against a month's spending"
            tone={runway !== null && runway < 3 ? "negative" : "neutral"}
            icon={<Timer size={16} />}
          />
        </div>

        {/* What came in and went out, and where it went */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Income vs expenses"
              subtitle={`Monthly cash flow · 12 months through ${monthName}`}
            />
            <div className="px-3 pb-4">
              <SeriesChart
                data={data.cf as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[
                  { key: "income", name: "Income", color: "#34d399", kind: "line" },
                  { key: "expenses", name: "Expenses", color: "#fb7185", kind: "line" },
                ]}
                height={280}
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Where money went"
              subtitle={`Average month · 12 months through ${monthName}`}
            />
            <div className="px-5 pb-5">
              {totalSpend > 0 ? (
                <DonutChart
                  data={data.spend}
                  colors={data.catColors}
                  centerLabel="Per month"
                  centerValue={fmtCAD(totalSpend)}
                  fmt={(n) => fmtCAD(n)}
                  height={210}
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  No expenses recorded in the last 12 months.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Category trend */}
        <Card>
          <CardHeader
            title="Spending by category"
            subtitle={`Top five categories · 12 months through ${monthName} (stacked)`}
          />
          <div className="px-3 pb-4">
            <SeriesChart
              data={data.stacked}
              xKey="label"
              stacked
              series={data.topCats.map((cat) => ({
                key: cat,
                name: cat,
                color: data.catColors[cat],
              }))}
              height={280}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        <p className="text-center text-[11px] text-ink-faint">
          Net worth changed {fmtSignedCAD(nwLast.net - nwPrev.net)} ({fmtPct(nwDelta)})
          over the last month · {fmtSignedCAD(nwLast.net - nwFirst.net)} since{" "}
          {labelMonth(nwFirst.key)}
        </p>
      </div>

      <TransactionForm open={addOpen} onClose={() => setAddOpen(false)} />
      <MonthlyChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
    </Shell>
  );
}
