"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Coins,
  CreditCard,
  Gauge,
  LineChart,
  Timer,
  PiggyBank,
  Wallet,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Button, Card, CardHeader, Progress, Segmented } from "@/components/ui";
import { DonutChart, SeriesChart, categoryColors } from "@/components/charts";
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
} from "@/lib/analytics";
import {
  fmtCompact,
  fmtCAD,
  labelMonth,
  lastCompleteMonthKey,
} from "@/lib/format";
import { snapshotGaps } from "@/lib/checklist";
import { roundMoney } from "@/lib/money";

/**
 * A colour per band of net worth.
 *
 * Cash takes the green the app uses for money arriving and crypto the brand
 * violet; the rest are chosen for contrast against whichever band they touch,
 * which is where confusion actually happens.
 *
 * Checked rather than judged by eye, because the eye is bad at this. Two pairs
 * this went through measure under the ΔE 15 floor for *normal* vision — blue
 * beside cyan at 13.2, green beside cyan at 12.1 — meaning full-colour readers
 * genuinely struggle to separate them. This set's worst touching pair is 22.1
 * for normal vision and 12.5 simulating deuteranopia, both clear.
 *
 * Which pairs touch depends on BAND_ORDER, so changing that order means
 * re-running the check rather than assuming it still holds.
 */
const CLASS_COLORS: Record<NetWorthClass, string> = {
  Cash: "#34d399",
  Bonds: "#60a5fa",
  Pension: "#f472b6",
  Stocks: "#f59e0b",
  Crypto: "#8b5cf6",
};

/**
 * The order the bands are stacked and listed in, bottom upwards.
 *
 * Kept here rather than in `NET_WORTH_CLASSES`, which is the domain's list of
 * what a band can be; this is a decision about a picture, and the two should
 * not have to move together.
 *
 * Whatever sits last is the top of the stack, and the top of a stack that
 * always totals a hundred percent is the ceiling of the plot — so that band's
 * boundary line runs along the frame and cannot be seen. It costs nothing for
 * crypto, which is half the chart and unmistakable from its fill alone. It
 * cost the pension its line entirely while it sat up there.
 */
const BAND_ORDER: NetWorthClass[] = ["Cash", "Bonds", "Pension", "Stocks", "Crypto"];

/** How much of the net worth history to draw: months, or the whole record. */
type Range = "12" | "60" | "all";

/**
 * A year-over-year move for one of the average-month figures.
 *
 * Money only, no percentage. A change from minus two hundred to plus fifty is
 * a real improvement and "−125%" says nothing true about it, and the pair of
 * them side by side was two readings of one move. The colour carries what the
 * badge used to. `good` is which direction is the welcome one — spending more
 * is not an improvement.
 */
function yearOverYear(
  now: number,
  before: number | undefined,
  good: "up" | "down",
): {
  deltaValue: string;
  deltaDir?: "up" | "down";
  tone: "positive" | "negative" | "neutral";
} {
  if (before === undefined) return { deltaValue: "", tone: "neutral" };
  const change = roundMoney(now - before);
  const rose = change >= 0;
  const tone = change === 0 ? "neutral" : (rose === (good === "up") ? "positive" : "negative");
  /*
   * Unsigned: the arrow on the badge is the sign, and "▲ +$420" says it twice.
   */
  return {
    deltaValue: fmtCAD(Math.abs(change)),
    deltaDir: rose ? "up" : "down",
    tone,
  };
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1 pt-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
        {title}
      </h2>
      <span className="text-[0.6875rem] text-ink-faint">{note}</span>
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
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [rate, setRate] = useState("0.035");

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
     * One ranking for the order and the colours the donut is drawn in.
     */
    const spend = avgSpendByCategory(transactions, 12, through);
    const catColors = categoryColors(spend.map((c) => c.name));
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
  /*
   * The same months as shares of what was owned that month. Debt is left out
   * rather than netted off: a share of a total that something has already been
   * subtracted from is not a share of anything you can point at.
   */
  /*
   * Only the bands that exist somewhere in the window.
   *
   * A class held in none of these months still drew a line, and being flat it
   * lay exactly along the top edge of the band below — so an empty Bonds
   * allocation was a blue rule through the middle of Cash.
   */
  const mixBands = useMemo(
    () => BAND_ORDER.filter((c) => bands.some((p) => p[c] > 0)),
    [bands],
  );
  const mix = useMemo(
    () =>
      bands.map((p) => {
        const owned = NET_WORTH_CLASSES.reduce((sum, c) => sum + Math.max(0, p[c]), 0);
        const row: Record<string, string | number> = { key: p.key, label: p.label };
        for (const c of BAND_ORDER) {
          row[c] = owned > 0 ? (Math.max(0, p[c]) / owned) * 100 : 0;
        }
        return row;
      }),
    [bands],
  );

  if (!ready) return <PageSkeleton />;

  const nwLast = nw[nw.length - 1];
  const nwPrev = nw[nw.length - 2] ?? nwLast;
  const nwDelta =
    nwPrev.net !== 0 ? ((nwLast.net - nwPrev.net) / Math.abs(nwPrev.net)) * 100 : 0;

  const portLast = data.port[data.port.length - 1];
  const portPrev = data.port[data.port.length - 2] ?? portLast;
  const portDelta =
    portPrev.value !== 0
      ? ((portLast.value - portPrev.value) / portPrev.value) * 100
      : 0;
  /*
   * Null rather than zero when nothing is owed, so a record with no debt says
   * "nothing owed" instead of reporting a 0% move against a zero balance.
   */
  const debtDelta =
    nwLast.liabilities === 0 && nwPrev.liabilities === 0
      ? null
      : nwLast.liabilities - nwPrev.liabilities;

  /*
   * Cash as a share of net worth. Against net worth rather than assets, so it
   * answers "how much of what I am worth is spendable" — and null when net
   * worth is zero or negative, where a share of it means nothing.
   */
  const cashShare = nwLast.net > 0 ? (nwLast.assets / nwLast.net) * 100 : null;

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
     * A rate is already a percentage, so the change is the difference between
     * the two rates — the "percent of a percent" a ratio would give is not a
     * thing anybody wants.
     */
    savings:
      saved !== null && savedBefore !== null
        ? {
            deltaValue: `${Math.abs(saved - savedBefore).toFixed(1)}%`,
            deltaDir: (saved >= savedBefore ? "up" : "down") as "up" | "down",
            tone: (saved >= savedBefore ? "positive" : "negative") as
              | "positive"
              | "negative",
          }
        : { deltaValue: "", deltaDir: undefined, tone: "neutral" as const },
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
        <MonthlyChecklistButton
          onOpen={() => setChecklistOpen(true)}
          gaps={data.snapshotGaps}
        />
      }
    >
      <div className="space-y-4">
        <SectionHeading title="Net worth" note="what you own" />

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
          {/*
            * Debt rather than unrealized gain.
            *
            * The gain is a fact about the portfolio and it is already on the
            * Investments page beside the rest of the portfolio's arithmetic.
            * What the dashboard was missing is the other side of the balance
            * sheet: everything here was something owned, and what is owed
            * appeared only in a chart subtitle. With it, the row is the whole
            * position — owned, invested, spendable, owed.
            */}
          <StatCard
            label="Debt"
            value={fmtCAD(nwLast.liabilities)}
            deltaValue={
              debtDelta === null ? undefined : fmtCAD(Math.abs(debtDelta))
            }
            deltaDir={
              debtDelta === null ? undefined : debtDelta >= 0 ? "up" : "down"
            }
            deltaLabel={debtDelta === null ? "nothing owed" : "vs last month"}
            tone={debtDelta !== null && debtDelta > 0 ? "negative" : "positive"}
            icon={<CreditCard size={16} />}
            spark={spark.map((p) => ({ v: p.liabilities }))}
            sparkKey="v"
            sparkColor="#fb7185"
          />
          <StatCard
            label="Cash"
            value={fmtCAD(nwLast.assets)}
            deltaValue={cashShare === null ? undefined : `${cashShare.toFixed(1)}%`}
            deltaLabel={
              cashShare === null ? "balances you can draw on" : "of net worth"
            }
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
                  of the {fmtCAD(fi.target)} that would cover a month like
                  yours for good
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
          {/*
            * A sentence rather than three labelled figures. The old row read
            * "Pays $1,492 a month at 3.5% · A month costs $4,487 · Still short
            * $2,995 a month" — every number correct and the relationship
            * between them left for the reader to assemble. It is one idea:
            * what the money would pay you, against what you spend.
            */}
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
            Drawing{" "}
            <span className="font-medium text-ink-dim">
              {(fi.rate * 100).toFixed(1)}% a year
            </span>{" "}
            from what you have now would pay you{" "}
            <span className="font-medium tabular-nums text-ink-dim">
              {fmtCAD(fi.monthly)}
            </span>{" "}
            a month. You spend{" "}
            <span className="font-medium tabular-nums text-ink-dim">
              {fmtCAD(data.avg.expenses)}
            </span>
            , so you are{" "}
            <span className="font-medium tabular-nums text-ink-dim">
              {fmtCAD(fi.shortfall)}
            </span>{" "}
            a month short of never needing to work again.
          </p>
        </Card>

        {/* The whole record, in one chart */}
        <Card>
            <CardHeader
              title="Net worth over time"
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
                * One line. The portfolio is four fifths of net worth, so its
                * line had the same shape and the same peaks a few pixels
                * below — two lines saying one thing. What the net worth is
                * made of is a different question, and the chart below answers
                * it properly.
                */}
              <SeriesChart
                data={nw as unknown as Record<string, unknown>[]}
                xKey="label"
                series={[{ key: "net", name: "Net worth", color: "#8b5cf6" }]}
                height={320}
                yFmt={fmtCompact}
              />
            </div>
        </Card>

        <Card>
          <CardHeader
            title="Net worth composition"
            subtitle="Share of everything you own, month by month"
          />
          {/*
            * Shares, not dollars.
            *
            * In dollars this was the net worth line again with lines inside
            * it: the total grew fivefold, so every band swept upward together
            * and the mix — the only thing this chart is for — was a few pixels
            * of thickness along the bottom. Normalised, the shape moves only
            * when the composition moves, which is what "made of" means and the
            * part slow enough to act on.
            *
            * A band worth very little is still only a few pixels tall, and the
            * figures underneath are what answer for it. Drawing it larger than
            * it is was tried and rejected: it bought cash a visible line at the
            * cost of every other band being wrong, which is a bad trade in a
            * chart whose whole subject is proportion.
            */}
          <div className="px-3 pb-2">
            <SeriesChart
              data={mix as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              fadeAtZero
              series={mixBands.map((name) => ({
                key: name,
                name,
                color: CLASS_COLORS[name],
              }))}
              height={280}
              yDomain={[0, 100]}
              yFmt={(n) => `${Math.round(n)}%`}
            />
          </div>
          {bandsLast && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-5">
              {/*
                * The bands the chart drew, not the ones held today — a colour
                * in the chart with no key beside it is a colour you cannot
                * name. One held earlier in the window and since sold reads as
                * zero here, which is the answer rather than an omission.
                */}
              {mixBands.map((c) => {
                const owned = NET_WORTH_CLASSES.reduce(
                  (sum, k) => sum + Math.max(0, bandsLast[k]),
                  0,
                );
                return (
                  <div key={c} className="flex items-baseline gap-2">
                    <span
                      className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                      style={{ background: CLASS_COLORS[c] }}
                    />
                    <span className="text-[0.6875rem] text-ink-faint">{c}</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {fmtCompact(bandsLast[c])}
                    </span>
                    <span className="text-[0.6875rem] tabular-nums text-ink-faint">
                      {owned > 0 ? `${Math.round((bandsLast[c] / owned) * 100)}%` : "—"}
                    </span>
                  </div>
                );
              })}
              {bandsLast.liabilities > 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full border border-negative" />
                  <span className="text-[0.6875rem] text-ink-faint">Debt</span>
                  <span className="text-sm font-semibold tabular-nums text-negative">
                    −{fmtCompact(bandsLast.liabilities)}
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>

        <SectionHeading
          title="Cash flow"
          note={`12-month averages · complete months only · through ${monthName}`}
        />

        {/* How the months average out */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Monthly net income"
            value={fmtCAD(data.avg.income)}
            deltaValue={yoy.income.deltaValue}
            deltaDir={yoy.income.deltaDir}
            deltaLabel="vs last year"
            tone={yoy.income.tone}
            icon={<ArrowDownRight size={16} className="text-positive" />}
            spark={data.avg.series.map((p) => ({ v: p.income }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Monthly expenses"
            value={fmtCAD(data.avg.expenses)}
            deltaValue={yoy.expenses.deltaValue}
            deltaDir={yoy.expenses.deltaDir}
            deltaLabel="vs last year"
            tone={yoy.expenses.tone}
            icon={<ArrowUpRight size={16} className="text-negative" />}
            spark={data.avg.series.map((p) => ({ v: p.expenses }))}
            sparkKey="v"
            sparkColor="#fb7185"
          />
          <StatCard
            label="Monthly uncommitted liquid cash flow"
            value={fmtCAD(data.avg.uncommittedLiquid)}
            deltaValue={yoy.uncommittedLiquid.deltaValue}
            deltaDir={yoy.uncommittedLiquid.deltaDir}
            deltaLabel="vs last year"
            tone={yoy.uncommittedLiquid.tone}
            icon={<PiggyBank size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.uncommittedLiquid }))}
            sparkKey="v"
            sparkColor="#22d3ee"
          />
          <StatCard
            label="Monthly passive income"
            value={fmtCAD(data.avg.passive)}
            deltaValue={yoy.passive.deltaValue}
            deltaDir={yoy.passive.deltaDir}
            deltaLabel="vs last year"
            tone={yoy.passive.tone}
            icon={<Coins size={16} />}
            spark={data.avg.series.map((p) => ({ v: p.passive }))}
            sparkKey="v"
            sparkColor="#a78bfa"
          />
          <StatCard
            label="Savings rate"
            value={saved === null ? "—" : `${saved.toFixed(1)}%`}
            deltaValue={yoy.savings.deltaValue}
            deltaDir={yoy.savings.deltaDir}
            deltaLabel="vs last year"
            tone={yoy.savings.tone}
            icon={<Gauge size={16} />}
          />
          <StatCard
            label="Runway"
            value={runway === null ? "—" : `${runway.toFixed(1)} mo`}
            deltaValue={fmtCAD(nwLast.assets)}
            deltaLabel="of cash, against a month's spending"
            icon={<Timer size={16} />}
          />
        </div>

        {/* What came in and went out, and where it went */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/*
            * The chart fills whatever height the donut beside it sets.
            *
            * Side by side in a grid the two cards are the same height, and the
            * donut's card is the taller of the two — its legend is a row per
            * category. At a fixed 280 the lines sat in the top two thirds of
            * their card with the rest of it blank. Growing to the row rather
            * than to a number means the pair stays matched however many
            * categories the legend ends up listing.
            */}
          <Card className="flex h-full flex-col lg:col-span-2">
            <CardHeader
              title="Income vs expenses"
              subtitle={`Monthly cash flow · 12 months through ${monthName}`}
              action={
                <Link href="/income">
                  <Button variant="ghost" size="sm">
                    Income <ArrowRight size={13} />
                  </Button>
                </Link>
              }
            />
            {/*
              * Absolutely positioned inside the growing box, so the chart has
              * a height to be a percentage *of*. A percentage height against a
              * flex item whose own height came from its content is circular,
              * and resolves to nothing; against `inset-0` it is simply the box.
              * The floor keeps it readable on a narrow screen, where the cards
              * stack and there is no taller neighbour to match.
              */}
            <div className="relative min-h-[280px] flex-1">
              <div className="absolute inset-0 px-3 pb-4">
                <SeriesChart
                  data={data.cf as unknown as Record<string, unknown>[]}
                  xKey="label"
                  series={[
                    { key: "income", name: "Income", color: "#34d399" },
                    { key: "expenses", name: "Expenses", color: "#fb7185" },
                  ]}
                  height="100%"
                  yFmt={fmtCompact}
                />
              </div>
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

      </div>

      <MonthlyChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
    </Shell>
  );
}
