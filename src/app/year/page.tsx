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
  BAND_ORDER,
  CLASS_COLORS,
  GroupedBars,
  spectrumAt,
  RoomGauge,
  SeriesChart,
  Waterfall,
  YearSankey,
} from "@/components/charts";
import { accent as accentFor } from "@/lib/palette";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady, useRemembered, useSpendGroups } from "@/lib/hooks";
import {
  allTimeSeries,
  classShares,
  firstFlowMonth,
  monthsSince,
  netExternalFlows,
  netWorthByClass,
  netWorthOver,
  portfolioSeries,
} from "@/lib/analytics";
import {
  categoryByYear,
  incomeTypeAmounts,
  incomeTypeShares,
  passiveIncomeByYear,
  spendableCashAt,
  yearFlow,
  yearRows,
  yearShapes,
  yearWaterfall,
  periodShape,
} from "@/lib/year";
import { groupOf } from "@/lib/expenses";
import { yearToDate } from "@/lib/spans";
import {
  REGISTERED_PLANS,
  contributionRoom,
  type ContributionLimits,
  type RegisteredPlan,
} from "@/lib/contributions";
import { fmtCAD, fmtCompact, fmtPct, fmtSignedCAD, labelMonth } from "@/lib/format";
import { getSettings, saveSettings } from "@/lib/api";

/** How much of the monthly composition to draw. */
type Range = "ytd" | "12" | "60" | "all";
const RANGES: Range[] = ["ytd", "12", "60", "all"];

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
  const spendGroups = useSpendGroups();
  const [mixRange, setMixRange] = useRemembered<Range>("aurum.span.composition", "all", RANGES);

  useEffect(() => {
    let cancelled = false;
    getSettings<{ limits?: ContributionLimits }>("/api/contribution-limits")
      .then((d) => {
        if (!cancelled) setLimits(d.limits ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLimits = useCallback((next: ContributionLimits) => {
    setLimits(next);
    saveSettings("/api/contribution-limits", { limits: next }).catch(() => {});
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
    const rows = yearRows(
      transactions,
      netWorth,
      portfolio,
      netExternalFlows(holdings),
      undefined,
      (c) => groupOf(c, spendGroups),
    );
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
      classes,
      shapes: yearShapes(rows, classes),
      /* The last month the record reaches, for closing a year still running. */
      netWorth,
      lastMonth: netWorth[netWorth.length - 1]?.key ?? null,
    };
  }, [accounts, holdings, transactions, snapshots, usdCadRate, spendGroups]);

  /*
   * The balance sheet month by month, cut to the range asked for. A level,
   * so the year to date opens on last December.
   */
  const monthlyMix = useMemo(() => {
    const bands =
      mixRange === "all"
        ? data.classes
        : mixRange === "ytd"
          ? yearToDate(data.classes, (r) => r.key, { withBase: true })
          : data.classes.slice(-Number(mixRange));
    return {
      bands,
      names: BAND_ORDER.filter((c) => bands.some((p) => p[c] > 0)),
      shares: classShares(bands),
      last: bands[bands.length - 1],
    };
  }, [data.classes, mixRange]);

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
  /*
   * A part-year's percentages are measured against the same window of the year
   * before, so the label has to say so — "vs 2025" beside a figure that
   * compares nine months to twelve is a different claim than the one made.
   */
  const paceLabel = !before
    ? "first year on record"
    : selected.complete
      ? `vs ${before.year}`
      : `vs ${before.year} to the same date`;

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
  const byYear = categoryByYear(transactions);
  const passiveYears = passiveIncomeByYear(transactions, (c) => groupOf(c, spendGroups));
  const passiveLatest = passiveYears[passiveYears.length - 1] ?? null;
  const passiveBefore = passiveYears[passiveYears.length - 2] ?? null;
  /*
   * Against the year before it in dollars, not against the record's first
   * year: a rise from almost nothing is a large percentage and says little.
   */
  const passiveGrowth =
    passiveLatest && passiveBefore && passiveBefore.passive > 0
      ? ((passiveLatest.passive - passiveBefore.passive) / passiveBefore.passive) * 100
      : null;
  /*
   * How much of a month of that year's spending the year's passive income
   * would have paid for. Both figures are annual, so the ratio is the same
   * either way round, and a month is the unit a reader lives in.
   */
  const passiveCoverage =
    passiveLatest && passiveLatest.expenses > 0
      ? (passiveLatest.passive / passiveLatest.expenses) * 100
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
  const cashAt = (month: string) => spendableCashAt(accounts, month);
  /*
   * A year still running closes on the last month on record, not on a December
   * that has not happened.
   */
  const closingMonth =
    data.lastMonth && data.lastMonth < `${selected.year}-12`
      ? data.lastMonth
      : `${selected.year}-12`;
  const flow = yearFlow(transactions, selected.year, {
    accounts,
    holdings,
    openingCash: cashAt(`${Number(selected.year) - 1}-12`),
    closingCash: cashAt(closingMonth),
    spendGroup: (c) => groupOf(c, spendGroups),
  });
  /*
   * The passive share, which is what the chart is titled after. "Did not come
   * from working" was the figure before, and it counted a gift as though an
   * asset had produced it.
   */
  const passiveShare = typeRow ? Number(typeRow.Passive) : null;
  /*
   * Each month of the selected year, split the way the roll-forward splits the
   * whole of it: what was saved, and what everything else did to net worth.
   * The roll-forward says how much; this says when.
   */
  const monthlyMoves = [] as { label: string; saved: number; growth: number }[];
  for (let m = 1; m <= 12; m++) {
    const key = `${selected.year}-${String(m).padStart(2, "0")}`;
    if (key > closingMonth) break;
    const month = periodShape(transactions, data.netWorth, key, key, (c) => groupOf(c, spendGroups));
    if (month && month.from === key) {
      monthlyMoves.push({ label: labelMonth(key), saved: month.saved, growth: month.revaluation });
    }
  }

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
            {selected.year} is still running — the figures are the year so far,
            {" "}
            {Math.round(selected.elapsed * 100)}% of the way through, and the
            comparisons cover the same stretch of {before?.year ?? "the year before"}.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Income · ${selected.year}`}
            value={fmtCAD(selected.income)}
            delta={selected.incomeGrowth ?? undefined}
            deltaLabel={paceLabel}
            icon={<ArrowDownRight size={16} className="text-positive" />}
          />
          <StatCard
            label="Expenses"
            value={fmtCAD(selected.expenses)}
            delta={selected.expenseGrowth ?? undefined}
            deltaLabel={paceLabel}
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
          * Three questions, in the order they are asked: what the year did
          * with its money, what that left behind, and how it compares with
          * the years before it. The page used to alternate between a single
          * year and the whole record every other card, so reading either one
          * meant skipping the cards between.
          */}
        <SectionHeading title="Cash flow" hint="What came in, and where it went" />
        {/*
          * The year itself, rather than a question about it. Income on the
          * left, the accounts it landed in down the middle, and everything it
          * left for on the right — with each account forced to reconcile, so
          * the chart cannot show more leaving one than reached it.
          */}
        {flow.nodes.length > 0 && (
          <Card>
            <CardHeader
              title="Sources and uses of funds"
              subtitle={`Every dollar that entered or left an account in ${selected.year}`}
            />
            <div className="px-3 pb-4">
              <YearSankey
                nodes={flow.nodes}
                links={flow.links}
                format={(n) => fmtCompact(n)}
              />
            </div>
          </Card>
        )}

        {/*
          * The same category across the years, rather than one year's total.
          *
          * A total says the year cost more. A single comparison says which
          * category did it, but one bad year and one good year are the same
          * single step to it — the direction only appears once there are three
          * or four bars to read along.
          */}
        {byYear.years.length > 1 && (
          <Card>
            <CardHeader
              title="Expenses by category"
              subtitle={`Year over year, ${byYear.years[0]} to ${byYear.years[byYear.years.length - 1]}`}
            />
            <div className="px-3 pb-4">
              <GroupedBars
                data={byYear.rows}
                xKey="category"
                bars={byYear.years.map((y, i) => ({
                  key: y,
                  name: y,
                  /*
                   * A ramp rather than a categorical set: years are ordered,
                   * and colours that run in the same direction let the reader
                   * see which way a category is going without reading the
                   * legend for every group.
                   */
                  color: spectrumAt(i, byYear.years.length),
                }))}
                yFmt={(n: number) => fmtCompact(n)}
                height={300}
              />
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="flex h-full flex-col">
            <CardHeader
              title="Income, expenses and net savings"
              subtitle="Every year on record, side by side"
            />
            <div className="min-h-[260px] flex-1 px-3 pb-4">
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
                height="100%"
                yFmt={fmtCompact}
              />
            </div>
          </Card>

          {/*
            * Two categories, not five. The full breakdown answers what the money
            * was; this answers the only question about it that changes a life —
            * active income stops when you do, passive income does not, and the
            * share of one against the other is the distance between having a job
            * and not needing one.
            */}
          {typeShares.length > 1 && (
            <Card className="flex h-full flex-col">
              <CardHeader
                title="Active and passive income mix"
                subtitle={
                  passiveShare === null
                    ? "What paid for the year, by where it came from"
                    : `${passiveShare.toFixed(1)}% of ${selected.year} came from what you own`
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
              <div className="min-h-[280px] flex-1 px-3 pb-2">
                <SeriesChart
                  data={typeShares as unknown as Record<string, unknown>[]}
                  xKey="label"
                  stacked
                  fadeAtZero
                  series={[
                    /*
                     * Active along the bottom and passive at the top, so the
                     * band that matters is measured against the ceiling rather
                     * than drawn as a sliver on the floor — a distance to the
                     * top is the easier of the two to watch move. Whatever was
                     * neither sits between them, out of the way of both.
                     */
                    { key: "Active", name: "Active", color: accentFor("brand") },
                    { key: "Other", name: "Neither", color: accentFor("passive") },
                    { key: "Passive", name: "Passive", color: accentFor("cost") },
                  ]}
                  height="100%"
                  yDomain={[0, 100]}
                  yFmt={(n: number) => `${Math.round(n)}%`}
                />
              </div>
              {typeLast && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-5">
                  {([
                    ["Passive", "Passive", "cost"],
                    ["Other", "Neither", "passive"],
                    ["Active", "Active", "brand"],
                  ] as const).map(([k, label, tone]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span
                        className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                        style={{ background: accentFor(tone) }}
                      />
                      <span className="text-[0.6875rem] text-ink-faint">{label}</span>
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
                Passive is what you own paying you: interest, cashback and
                dividends. A pension contribution counts as active, being
                deferred pay off the same hours as the salary it comes from. A
                gift is neither, and a refund or a drawdown is not income at
                all, so neither appears here.
              </p>
            </Card>
          )}
        </div>

        <SectionHeading title="Net worth" hint="What the year built, when, and what it is made of" />
        {/*
          * A third of the row for the roll-forward, two thirds for its months.
          *
          * Five columns given half a page were slabs — a waterfall is five
          * numbers and the shape they make, and at that width the shape was
          * lost behind the bars drawing it. The months beside it are twelve
          * pairs of bars and read better the wider they get, so the space
          * one chart does not want is the space the other one does.
          *
          * Only where a third is wide enough to label, though. Below that the
          * five names run into each other and the figures over the bars
          * collide, so the row falls back to halves before it falls back to
          * one on top of the other.
          */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {shape && (
            <Card className="flex h-full flex-col">
              <CardHeader
                title="Net worth roll-forward"
                subtitle={`From opening to closing net worth in ${selected.year}`}
              />
              <div className="min-h-[300px] flex-1 px-3 pb-4">
                <Waterfall
                  steps={yearWaterfall(shape)}
                  format={(n) => fmtCompact(n)}
                  height="100%"
                />
              </div>
            </Card>
          )}

          {monthlyMoves.length > 1 && (
            <Card className="flex h-full flex-col xl:col-span-2">
              <CardHeader
                title="Net worth change by month"
                subtitle={`What was saved and what growth added, each month of ${selected.year}`}
              />
              <div className="min-h-[300px] flex-1 px-3 pb-4">
                <GroupedBars
                  data={monthlyMoves as unknown as Record<string, unknown>[]}
                  xKey="label"
                  bars={[
                    { key: "saved", name: "Saved", color: accentFor("positive") },
                    { key: "growth", name: "Growth", color: accentFor("market") },
                  ]}
                  height="100%"
                  yFmt={fmtCompact}
                />
              </div>
            </Card>
          )}
        </div>

        {/*
          * What everything owned is made of, month by month.
          *
          * Moved here from the old dashboard, which read the last twelve
          * months and had no business drawing a record's whole shape. The
          * year ends above say where the mix landed; this says how it got
          * there — a band that swells over one summer and one that creeps up
          * across years look the same at a year end and nothing alike here.
          */}
        {monthlyMix.bands.length > 1 && (
          <Card>
            <CardHeader
              title="Net worth composition"
              subtitle={`Share of everything you own, month by month · through ${labelMonth(monthlyMix.last.key)}`}
              action={
                <Segmented<Range>
                  options={[
                    { value: "ytd", label: "YTD" },
                    { value: "12", label: "1Y" },
                    { value: "60", label: "5Y" },
                    { value: "all", label: "All" },
                  ]}
                  value={mixRange}
                  onChange={setMixRange}
                />
              }
            />
            {/*
              * Shares, not dollars. In dollars this is the net worth line again
              * with lines inside it, and the mix — the only thing the chart is
              * for — is a few pixels along the bottom. A band worth very little
              * stays a few pixels tall, and the figures underneath answer for it.
              */}
            <div className="px-3 pb-2">
              <SeriesChart
                data={monthlyMix.shares as unknown as Record<string, unknown>[]}
                xKey="label"
                stacked
                fadeAtZero
                series={monthlyMix.names.map((name) => ({
                  key: name,
                  name,
                  color: CLASS_COLORS[name],
                }))}
                height={280}
                yDomain={[0, 100]}
                yFmt={(n: number) => `${Math.round(n)}%`}
              />
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-5">
              {monthlyMix.names.map((c) => {
                const owned = monthlyMix.names.reduce(
                  (sum, k) => sum + Math.max(0, monthlyMix.last[k]),
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
                      {fmtCompact(monthlyMix.last[c])}
                    </span>
                    <span className="text-[0.6875rem] tabular-nums text-ink-faint">
                      {owned > 0
                        ? `${Math.round((monthlyMix.last[c] / owned) * 100)}%`
                        : "—"}
                    </span>
                  </div>
                );
              })}
              {monthlyMix.last.liabilities > 0 && (
                <div className="flex items-baseline gap-2">
                  <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full border border-negative" />
                  <span className="text-[0.6875rem] text-ink-faint">Debt</span>
                  <span className="text-sm font-semibold tabular-nums text-negative">
                    −{fmtCompact(monthlyMix.last.liabilities)}
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/*
            * Passive income in dollars, which the mix chart beside it cannot
            * say. That one normalises each year to its own total to stop a
            * rising salary hiding a rising dividend; the price of doing so is
            * that a steady share and a growing amount look identical. Here the
            * axis is money, so the curve rising means one thing only.
            */}
          {passiveYears.length > 1 && (
            <Card className="flex h-full flex-col">
              <CardHeader
                title="Passive income over time"
                subtitle="What interest, cashback and dividends paid each year"
              />
              <div className="min-h-[240px] flex-1 px-3 pb-4">
                <SeriesChart
                  data={passiveYears as unknown as Record<string, unknown>[]}
                  xKey="label"
                  series={[
                    { key: "passive", name: "Passive income", color: accentFor("cost") },
                  ]}
                  yFmt={(n: number) => fmtCompact(n)}
                  height="100%"
                />
              </div>
              {passiveLatest && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 px-5 pb-5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[0.6875rem] text-ink-faint">
                      {passiveLatest.label}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {fmtCAD(passiveLatest.passive)}
                    </span>
                  </div>
                  {passiveGrowth !== null && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[0.6875rem] text-ink-faint">
                        vs {passiveBefore!.label}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          passiveGrowth >= 0 ? "text-positive" : "text-negative",
                        )}
                      >
                        {passiveGrowth >= 0 ? "+" : "−"}
                        {Math.abs(Math.round(passiveGrowth))}%
                      </span>
                    </div>
                  )}
                  {passiveCoverage !== null && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[0.6875rem] text-ink-faint">Covers</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {passiveCoverage.toFixed(1)}%
                      </span>
                      <span className="text-[0.6875rem] text-ink-faint">
                        of what the year cost
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/*
            * Room is the one limit here the app cannot work out for itself. It
            * depends on income, on room carried forward and on withdrawals made
            * years ago, all of it stated on a notice of assessment — so the
            * figure is entered, and what has been paid in against it is counted.
            */}
          <Card className="flex h-full flex-col">
            <CardHeader
              title="Registered plan contribution room"
              subtitle={`What you have paid into each plan in ${selected.year}`}
              action={
                <Button variant="ghost" size="sm" onClick={() => setRoomOpen(true)}>
                  <SlidersHorizontal size={14} /> Set room
                </Button>
              }
            />
            <div className="grid min-h-0 flex-1 grid-cols-1 content-center gap-6 px-4 pb-5 pt-1 sm:grid-cols-3">
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
                An over-contribution is charged 1% per month on the excess until it is
                withdrawn. Check the figure against your notice of assessment before
                acting on it.
              </p>
            )}
          </Card>
        </div>

        <SectionHeading title="The record" hint="Every year on record, side by side" />
        <Card>
          <CardHeader
            title="Annual summary"
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
 * A break between groups of cards.
 *
 * Deliberately a label rather than a heavier divider: the cards already have
 * their own edges, and a second box around a group of boxes reads as another
 * card. A rule and a word are enough to say "these answer the same question",
 * which is the whole job.
 */
function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line px-1 pt-4">
      <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-ink-dim">
        {title}
      </h2>
      <p className="text-[0.6875rem] text-ink-faint">{hint}</p>
    </div>
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
