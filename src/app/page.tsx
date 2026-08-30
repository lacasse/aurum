"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Coins,
  LineChart,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Button, Card, CardHeader, Segmented } from "@/components/ui";
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
  netWorthOver,
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
import { ACCOUNT_KIND_LABELS } from "@/lib/types";
import { roundMoney } from "@/lib/money";

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
    return {
      through,
      nwAll,
      cf,
      spend,
      catColors,
      stacked,
      topCats,
      port,
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
  const yoy = {
    income: yearOverYear(data.avg.income, prev?.income, "up"),
    expenses: yearOverYear(data.avg.expenses, prev?.expenses, "down"),
    uncommittedLiquid: yearOverYear(data.avg.uncommittedLiquid, prev?.uncommittedLiquid, "up"),
    passive: yearOverYear(data.avg.passive, prev?.passive, "up"),
  };

  const spark = data.nwAll.slice(-18);
  const totalSpend = data.spend.reduce((s, c) => s + c.value, 0);
  const monthName = labelMonth(data.through);

  return (
    <Shell
      title="Dashboard"
      subtitle="Your complete financial picture at a glance"
      action={
        <div className="flex items-center gap-2">
          <MonthlyChecklistButton onOpen={() => setChecklistOpen(true)} />
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

        <SectionHeading
          title="Cash flow"
          note={`12-month averages · complete months only · through ${monthName}`}
        />

        {/* How the months average out */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
