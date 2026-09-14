"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  TriangleAlert,
} from "lucide-react";
import { Shell } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Progress,
  Segmented,
  cn,
} from "@/components/ui";
import { SeriesChart, Waterfall, YearSankey } from "@/components/charts";
import { MonthlyChecklistButton, MonthlyChecklistModal } from "@/components/monthly-checklist";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady, useRemembered, useSpendGroups } from "@/lib/hooks";
import { yearToDate } from "@/lib/spans";
import {
  allTimeSeries,
  firstFlowMonth,
  fiProgress,
  monthsSince,
  netWorthOver,
  portfolioSeries,
  runwayMonths,
  savingsRate,
  DEFAULT_WITHDRAWAL_RATE,
} from "@/lib/analytics";
import { groupOf, recurringFloor } from "@/lib/expenses";
import { periodShape, spendableCashAt, yearFlow, yearWaterfall } from "@/lib/year";
import { coverage, driverPhrase, perMonth, watchList, type WatchItem } from "@/lib/story";
import {
  fmtCAD,
  fmtCompact,
  labelMonth,
  lastCompleteMonthKey,
  lastMonthKeys,
  previousMonthKey,
} from "@/lib/format";
import { snapshotGaps } from "@/lib/checklist";
import { accent } from "@/lib/palette";
import { roundMoney } from "@/lib/money";

/**
 * Where you stand.
 *
 * The dashboard this replaces had ten tiles and four charts, every figure
 * right and none of them connected: net worth in one card, the months that
 * built it in another, and the reader left to work out that the two were the
 * same story. This page reads the record in the order the questions arrive —
 * what it is worth, what changed it, where the money went, what the money now
 * does, what deserves attention, and the long view last.
 *
 * One window for all of it: the last twelve complete months. Every figure on
 * the page answers for the same months, so nothing on it can disagree with
 * anything else, which was most of what made the old page hard to read. The
 * long view at the foot is the one exception, and says so.
 *
 * Nothing here is calculated for this page alone. The roll-forward and the
 * flow chart are the Year page's own, over a different window; the floor is
 * the Expenses page's; the withdrawal arithmetic is the one the old dashboard
 * used. What this page adds is the order, and the few judgements in story.ts.
 */

/** How much of the net worth history the long view draws. */
type Range = "ytd" | "12" | "60" | "all";
const RANGES: Range[] = ["ytd", "12", "60", "all"];

const WINDOW = 12;

/** A money move against the year before, as a badge: unsigned, with the arrow as the sign. */
function against(
  now: number,
  before: number | null,
  good: "up" | "down",
): { deltaValue?: string; deltaDir?: "up" | "down"; tone: "positive" | "negative" | "neutral" } {
  if (before === null) return { tone: "neutral" };
  const change = roundMoney(now - before);
  if (change === 0) return { deltaValue: fmtCAD(0), tone: "neutral" };
  const rose = change > 0;
  return {
    deltaValue: fmtCAD(Math.abs(change)),
    deltaDir: rose ? "up" : "down",
    tone: rose === (good === "up") ? "positive" : "negative",
  };
}

function Chapter({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
        {title}
      </h2>
      {note ? <span className="text-[0.6875rem] text-ink-faint">{note}</span> : null}
    </div>
  );
}

/** One line of the balance sheet beside the headline. */
function Holding({ label, value, tone }: { label: string; value: string; tone?: "negative" }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-base font-semibold tabular-nums",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * One figure of an average month, against the same figure a year earlier.
 *
 * The bar under it is the comparison drawn: this year filled, last year a
 * tick on the same scale, so a rise and a fall read before the badge is.
 * The scale is the row's own — income and spending are an order of magnitude
 * apart from what is saved, and one shared scale would flatten the smallest
 * row into a line.
 */
function MonthRow({
  label,
  note,
  now,
  before,
  good,
  colour,
}: {
  label: string;
  note?: string;
  now: number;
  before: number | null;
  good: "up" | "down";
  colour: string;
}) {
  const move = against(now, before, good);
  const scale = Math.max(Math.abs(now), Math.abs(before ?? 0)) * 1.08 || 1;
  const width = (n: number) => `${Math.max(0, Math.min(100, (Math.max(n, 0) / scale) * 100))}%`;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-dim">{label}</p>
          {note ? <p className="text-[0.6875rem] text-ink-faint">{note}</p> : null}
        </div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight">{fmtCAD(now)}</span>
          {move.deltaValue && move.deltaDir ? (
            <Badge tone={move.tone === "neutral" ? "neutral" : move.tone}>
              {move.deltaDir === "up" ? "▲" : "▼"}{" "}
              <span className="tabular-nums">{move.deltaValue}</span>
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-elevated">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: width(now), background: colour }}
        />
        {before !== null && (
          <div
            className="absolute -inset-y-1 w-0.5 rounded-full bg-ink-faint"
            style={{ left: width(before) }}
            title={`The year before: ${fmtCAD(before)}`}
          />
        )}
      </div>
    </div>
  );
}

function WatchRow({ item }: { item: WatchItem }) {
  const Icon = item.tone === "concern" ? CircleAlert : TriangleAlert;
  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-elevated"
    >
      <Icon
        size={16}
        className={cn(
          "mt-0.5 shrink-0",
          item.tone === "concern" ? "text-negative" : "text-amber-500",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        <p className="mt-0.5 text-xs text-ink-faint">{item.detail}</p>
      </div>
      <ArrowRight
        size={14}
        className="mt-1 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

export default function OverviewPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const holdings = useFinance((s) => s.holdings);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const spendGroups = useSpendGroups();
  const [range, setRange] = useRemembered<Range>("aurum.span.dashboard", "all", RANGES);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [rate, setRate] = useRemembered<string>(
    "aurum.fi.rate",
    String(DEFAULT_WITHDRAWAL_RATE),
    ["0.03", "0.035", "0.04"],
  );

  /*
   * Recorded month-end portfolio values, from the store: several pages draw a
   * chart from this history and it is fetched once for all of them.
   */
  const snapshots = useFinance((s) => s.snapshotHistory);
  const loadSnapshotHistory = useFinance((s) => s.loadSnapshotHistory);
  useEffect(() => {
    loadSnapshotHistory();
  }, [loadSnapshotHistory]);

  const data = useMemo(() => {
    const group = (c: string) => groupOf(c, spendGroups);

    /*
     * Whole months only. The month in progress holds a few days of spending
     * and drawn beside whole ones reads as a collapse in both directions.
     */
    const through = lastCompleteMonthKey();
    const from = lastMonthKeys(WINDOW, through)[0];

    /*
     * The line begins where the portfolio record does. A month with no
     * portfolio figure is not a month with no portfolio, and drawing it as
     * zero put net worth below nothing for months when the portfolio was the
     * largest thing owned.
     */
    const starts = [Object.keys(snapshots).sort()[0] ?? null, firstFlowMonth(holdings)].filter(
      (m): m is string => m !== null,
    );
    const historyStart = starts.length > 0 ? starts.sort()[0] : null;
    const portfolio =
      historyStart && Object.keys(snapshots).length > 0
        ? allTimeSeries(holdings, {}, monthsSince(historyStart), snapshots).points
        : portfolioSeries(holdings, 18);
    const netWorth = netWorthOver(accounts, portfolio, usdCadRate);

    const shape = periodShape(transactions, netWorth, from, through, group);
    /* The same stretch a year earlier, on the same rules, for every comparison. */
    const before = periodShape(
      transactions,
      netWorth,
      lastMonthKeys(WINDOW, lastMonthKeys(WINDOW + 1, through)[0])[0],
      lastMonthKeys(WINDOW + 1, through)[0],
      group,
    );

    const byMonth = new Map(netWorth.map((p) => [p.key, p]));
    const closing = byMonth.get(through) ?? netWorth[netWorth.length - 1] ?? null;
    const opening = shape ? (byMonth.get(previousMonthKey(shape.from)) ?? null) : null;

    const flow = shape
      ? yearFlow(
          transactions,
          { from: shape.from, through, label: "These months" },
          {
            accounts,
            holdings,
            openingCash: spendableCashAt(accounts, previousMonthKey(shape.from)),
            closingCash: spendableCashAt(accounts, through),
            spendGroup: group,
          },
        )
      : null;

    const floor = recurringFloor(transactions, spendGroups, WINDOW, through);

    const gaps = snapshotGaps(
      Object.fromEntries(Object.entries(snapshots).map(([m, t]) => [m, Object.keys(t).length])),
      through,
    ).length;

    return { through, shape, before, closing, opening, flow, floor, netWorth, gaps };
  }, [accounts, transactions, holdings, snapshots, usdCadRate, spendGroups]);

  /*
   * Closed on the same month as everything above it. The record reaches into
   * the month in progress, and a line one point past the figures beside it
   * ends on a number the page never mentions.
   */
  const longView = useMemo(() => {
    const closed = data.netWorth.filter((p) => p.key <= data.through);
    if (range === "all") return closed;
    if (range === "ytd") return yearToDate(closed, (r) => r.key, { withBase: true });
    return closed.slice(-(Number(range) + 1));
  }, [data.netWorth, data.through, range]);

  if (!ready) return <PageSkeleton />;

  const monthName = labelMonth(data.through);
  const { shape, before, closing, opening } = data;

  if (!shape || !closing) {
    return (
      <Shell title="Where you stand" subtitle="The last twelve months">
        <EmptyState
          title="Not enough on record yet"
          subtitle="Once there is a balance and a month of transactions, this page tells you where you stand."
        />
      </Shell>
    );
  }

  /* A month of these twelve, and a month of the twelve before. */
  const income = perMonth(shape.income, shape.months);
  const spending = perMonth(shape.expenses, shape.months);
  const saved = perMonth(shape.saved, shape.months);
  const incomeBefore = before ? perMonth(before.income, before.months) : null;
  const spendingBefore = before ? perMonth(before.expenses, before.months) : null;
  const savedBefore = before ? perMonth(before.saved, before.months) : null;
  const rateNow = savingsRate(shape.income, shape.expenses);

  const change = shape.netWorth - shape.openingNetWorth;
  const changePct =
    shape.openingNetWorth > 0 ? (change / shape.openingNetWorth) * 100 : null;
  const phrase = driverPhrase(shape);

  const passive = perMonth(shape.passive, shape.months);
  const covered = coverage(passive, data.floor.total);
  const fi = fiProgress(closing.net, spending, Number(rate) || DEFAULT_WITHDRAWAL_RATE);
  const runway = runwayMonths(closing.assets, spending);

  const watch = watchList({
    runway,
    spending,
    spendingBefore,
    income,
    incomeBefore,
    saved: shape.saved,
    debtOpening: opening?.liabilities ?? closing.liabilities,
    debtClosing: closing.liabilities,
    snapshotGaps: data.gaps,
  });

  const span =
    shape.months === WINDOW
      ? "the last twelve months"
      : `the last ${shape.months} month${shape.months === 1 ? "" : "s"}`;

  return (
    <Shell
      title="Where you stand"
      subtitle={`Everything below reads ${span}, through ${monthName}`}
      action={
        <MonthlyChecklistButton onOpen={() => setChecklistOpen(true)} gaps={data.gaps} />
      }
    >
      <div className="space-y-4">
        {/*
          * The answer first. Everything after it on the page is the working.
          */}
        <Card className="p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-dim">Net worth</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
                {fmtCAD(shape.netWorth)}
              </p>
              <p className="mt-2 text-sm text-ink-dim">
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    change >= 0 ? "text-positive" : "text-negative",
                  )}
                >
                  {change >= 0 ? "Up" : "Down"} {fmtCAD(Math.abs(change))}
                  {changePct !== null ? ` (${Math.abs(changePct).toFixed(1)}%)` : ""}
                </span>{" "}
                over {span}
                {phrase ? `, ${phrase}` : ""}.
              </p>
            </div>
            {/*
              * The parts of the figure beside them, on the same month-end, so
              * they add up to it. A pension is its own line rather than folded
              * into what is invested: it is yours, but it is not money.
              */}
            <div
              className={cn(
                "grid gap-4 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0",
                closing.pension > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
              )}
            >
              <Holding label="Cash" value={fmtCAD(closing.assets)} />
              <Holding label="Invested" value={fmtCAD(closing.portfolio)} />
              {closing.pension > 0 && <Holding label="Pension" value={fmtCAD(closing.pension)} />}
              <Holding
                label="Owed"
                value={closing.liabilities > 0 ? `−${fmtCAD(closing.liabilities)}` : fmtCAD(0)}
                tone={closing.liabilities > 0 ? "negative" : undefined}
              />
            </div>
          </div>
        </Card>

        <Chapter title="What changed it" note={`${labelMonth(shape.from)} to ${monthName}`} />
        {/*
          * The roll-forward beside the months that make it up. The two income
          * and spending bars are twelve months of the three figures on the
          * right, so the chart is the total and the tiles are the rate.
          */}
        {/*
          * Half and half. The roll-forward is five columns, and across two
          * thirds of the page they were either stranded in air or swollen
          * into slabs; at half it is the width five columns want. The months
          * that make up its bars take the other half as one card rather than
          * three tiles, since they are one set of figures read together.
          */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="flex h-full flex-col">
            <CardHeader
              title="From where you started to where you are"
              subtitle="What came in, what went out, and what everything else did"
            />
            <div className="min-h-[300px] flex-1 px-3 pb-4">
              <Waterfall steps={yearWaterfall(shape)} format={(n) => fmtCompact(n)} height="100%" />
            </div>
          </Card>
          <Card className="flex h-full flex-col">
            <CardHeader
              title="A typical month"
              subtitle={
                before
                  ? "These twelve months, against the twelve before"
                  : "These twelve months"
              }
            />
            <div className="flex flex-1 flex-col justify-around divide-y divide-line px-5 pb-2">
              <MonthRow
                label="Income"
                now={income}
                before={incomeBefore}
                good="up"
                colour={accent("positive")}
              />
              <MonthRow
                label="Spending"
                now={spending}
                before={spendingBefore}
                good="down"
                colour={accent("negative")}
              />
              <MonthRow
                label="Saved"
                note={rateNow === null ? undefined : `${rateNow.toFixed(1)}% of income`}
                now={saved}
                before={savedBefore}
                good="up"
                colour={accent("brand")}
              />
            </div>
          </Card>
        </div>

        {data.flow && data.flow.links.length > 0 && (
          <>
            <Chapter title="Where the money went" note="every dollar that entered or left an account" />
            <Card>
              <CardHeader
                title="Sources and uses"
                subtitle="Where it came from, which accounts it passed through, and what it became"
                action={
                  <Link href="/year">
                    <Button variant="ghost" size="sm">
                      By year <ArrowRight size={13} />
                    </Button>
                  </Link>
                }
              />
              <div className="px-3 pb-4">
                <YearSankey
                  nodes={data.flow.nodes}
                  links={data.flow.links}
                  format={(n) => fmtCompact(n)}
                />
              </div>
            </Card>
          </>
        )}

        <Chapter title="What your money does for you" />
        {/*
          * Two readings of one question, deliberately side by side: what the
          * money could pay you if you drew on it, and what it already pays
          * without being touched. The first is a target; the second is the
          * part of it that has already happened.
          *
          * The financial independence meter came here from the old dashboard.
          * It is measured against this page's spending — which leaves a debt
          * repayment out, since a debt cleared is not a cost that retirement
          * inherits.
          */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-ink-dim">Financial independence</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{fi.pct.toFixed(1)}%</p>
                <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                  of the {fmtCAD(fi.target)} that would pay for a month like yours for good
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
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
              Drawing{" "}
              <span className="font-medium text-ink-dim">{(fi.rate * 100).toFixed(1)}% a year</span>{" "}
              from what you have would pay{" "}
              <span className="font-medium tabular-nums text-ink-dim">{fmtCAD(fi.monthly)}</span> a
              month, against{" "}
              <span className="font-medium tabular-nums text-ink-dim">{fmtCAD(spending)}</span> spent
              {fi.shortfall > 0 ? (
                <>
                  {" "}
                  — <span className="font-medium tabular-nums text-ink-dim">{fmtCAD(fi.shortfall)}</span>{" "}
                  short
                </>
              ) : (
                " — covered"
              )}
              .
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs font-medium text-ink-dim">Already paying for itself</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {covered === null ? "—" : `${covered.toFixed(1)}%`}
            </p>
            <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
              of what a month costs before anything is decided
            </p>
            <Progress value={covered ?? 0} max={100} tone="positive" className="mt-4" />
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
              Dividends, interest and pension paid you{" "}
              <span className="font-medium tabular-nums text-ink-dim">{fmtCAD(passive)}</span> a month.
              The{" "}
              <Link href="/expenses" className="text-ink-dim underline-offset-2 hover:underline">
                bills that arrive on their own
              </Link>{" "}
              come to{" "}
              <span className="font-medium tabular-nums text-ink-dim">{fmtCAD(data.floor.total)}</span>.
            </p>
          </Card>
        </div>

        <Chapter title="Worth a look" />
        <Card className="overflow-hidden">
          {watch.length > 0 ? (
            <div className="divide-y divide-line">
              {watch.map((item) => (
                <WatchRow key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-5 py-4">
              <CheckCircle2 size={16} className="shrink-0 text-positive" />
              <p className="text-sm text-ink-dim">
                Nothing stands out. Spending, income, cash and debt all look steady against the year
                before.
              </p>
            </div>
          )}
        </Card>

        <Chapter title="The long view" note="the one chart here that reaches past these twelve months" />
        <Card>
          <CardHeader
            title="Net worth over time"
            subtitle={`Through ${labelMonth(longView[longView.length - 1]?.key ?? data.through)}`}
            action={
              <div className="flex items-center gap-2">
                <Segmented<Range>
                  options={[
                    { value: "ytd", label: "YTD" },
                    { value: "12", label: "1Y" },
                    { value: "60", label: "5Y" },
                    { value: "all", label: "All" },
                  ]}
                  value={range}
                  onChange={setRange}
                />
                <Link href="/year">
                  <Button variant="ghost" size="sm">
                    What it is made of <ArrowRight size={13} />
                  </Button>
                </Link>
              </div>
            }
          />
          <div className="px-3 pb-4">
            <SeriesChart
              data={longView as unknown as Record<string, unknown>[]}
              xKey="label"
              series={[{ key: "net", name: "Net worth", color: "#8b5cf6" }]}
              height={300}
              yFmt={fmtCompact}
            />
          </div>
        </Card>
      </div>

      <MonthlyChecklistModal open={checklistOpen} onClose={() => setChecklistOpen(false)} />
    </Shell>
  );
}
