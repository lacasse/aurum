"use client";

import { useMemo } from "react";
import { Banknote, CalendarRange, HandCoins, Wallet } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader, EmptyState, Segmented, cn } from "@/components/ui";
import {
  GroupedBars,
  Sparkline,
  categoryColors,
  spectrumAt,
} from "@/components/charts";
import { accent } from "@/lib/palette";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady, useRemembered } from "@/lib/hooks";
import { monthsToDate } from "@/lib/spans";
import {
  incomeBySource,
  incomeYearOverYear,
  monthlyAverages,
  PASSIVE_INCOME_CATEGORIES,
} from "@/lib/analytics";
import {
  fmtCAD,
  fmtCompact,
  fmtPct,
  labelMonth,
  lastCompleteMonthKey,
} from "@/lib/format";

/** A label and a figure on one line, the way the tiles state a second fact. */
function FactRow({
  label,
  value,
  dim,
}: {
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-ink-dim">{label}</span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          dim ? "text-ink-faint" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Worked for against arrived on its own, as one bar.
 *
 * Passive income is a percent or two of most records, which is a sliver — and
 * a sliver is the honest drawing. It keeps a visible minimum width so the bar
 * says "there is some" rather than "there is none", which are different
 * answers.
 */
function SplitBar({
  active,
  passive,
  passiveColor,
}: {
  active: number;
  passive: number;
  passiveColor: string;
}) {
  const total = active + passive;
  const share = total > 0 ? (passive / total) * 100 : 0;
  const width = passive > 0 ? Math.max(share, 1.5) : 0;
  return (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-elevated">
      <div
        className="h-full rounded-full"
        style={{
          width: `${100 - width}%`,
          backgroundColor: accent("positive"),
        }}
      />
      {width > 0 ? (
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: passiveColor }}
        />
      ) : null}
    </div>
  );
}

type Window = "ytd" | "12" | "24" | "60";
const WINDOWS: Window[] = ["ytd", "12", "24", "60"];

export default function IncomePage() {
  const ready = useReady();
  const transactions = useFinance((s) => s.transactions);
  const [window, setWindow] = useRemembered<Window>("aurum.span.income", "12", WINDOWS);

  /*
   * Through the last complete month, like everything else that compares one
   * month with the next. A month in progress drawn beside whole ones reads as
   * a collapse in earnings, which would be a fact about the calendar.
   */
  const through = lastCompleteMonthKey();
  // The year to date counts whole months, like every other window here.
  const months = window === "ytd" ? monthsToDate(through) : Number(window);

  const data = useMemo(() => {
    const breakdown = incomeBySource(transactions, months, through);
    const colors = categoryColors(breakdown.sources.map((s) => s.category));

    /*
     * A series per source, read out of the same monthly rows the chart uses,
     * so a sparkline in the table is the row's own line from the chart above
     * rather than a second calculation that could disagree with it.
     */
    const series = new Map<string, { value: number }[]>(
      breakdown.sources.map((s) => [
        s.category,
        breakdown.months.map((m) => ({ value: Number(m[s.category] ?? 0) })),
      ]),
    );

    /*
     * Dividends and interest, month by month.
     *
     * On its own axis rather than as two bands of the chart above: passive
     * income is a percent and a half of this record, so on a scale that fits
     * a salary it is a line of pixels. Given its own chart the same figures
     * are a shape you can read — which is the point, since this is the part
     * that is supposed to grow.
     */
    const passiveSources = breakdown.sources.filter((s) =>
      PASSIVE_INCOME_CATEGORIES.has(s.category),
    );
    const passive = passiveSources.reduce((sum, s) => sum + s.average, 0);
    const passiveMonths = breakdown.months.map((m) => {
      const row: Record<string, string | number> = {
        key: String(m.key),
        label: String(m.label),
      };
      for (const s of passiveSources) row[s.category] = Number(m[s.category] ?? 0);
      return row;
    });
    const passiveBest = passiveMonths.reduce(
      (best, m) =>
        Math.max(
          best,
          passiveSources.reduce((sum, s) => sum + Number(m[s.category] ?? 0), 0),
        ),
      0,
    );

    const active = breakdown.average - passive;

    /*
     * What lands and stays, over the same window as everything else here.
     *
     * `monthlyAverages` already answers this, and the three figures are taken
     * from the one call so they subtract to each other exactly. Every expense
     * counts, not the recurring ones: a month's dining and travel are as spent
     * as its rent, and treating them as still available is a large monthly
     * overstatement — the mistake that figure's own comment records.
     */
    const avg = monthlyAverages(transactions, months, through);
    const liquidIn = avg.uncommittedLiquid + avg.expenses;

    const yoy = incomeYearOverYear(transactions, through);

    return {
      breakdown,
      colors,
      series,
      passive,
      active,
      avg,
      liquidIn,
      yoy,
      passiveSources,
      passiveMonths,
      passiveBest,
    };
  }, [transactions, months, through]);

  if (!ready) return <PageSkeleton />;

  const { breakdown, colors, series } = data;
  /* The colour passive income wears everywhere on this page. */
  const passiveColor =
    data.passiveSources.length > 0
      ? colors[data.passiveSources[0].category]
      : spectrumAt(0, 1);

  if (breakdown.sources.length === 0) {
    return (
      <Shell title="Income" subtitle="What comes in, and where it comes from">
        <EmptyState
          icon={<HandCoins size={20} />}
          title="No income recorded yet"
          subtitle="Record income by hand, or close a month with the checklist, and this page fills in."
        />
      </Shell>
    );
  }

  return (
    <Shell
      title="Income"
      subtitle="What comes in, and where it comes from"
      action={
        <Segmented<string>
          options={[
            { value: "ytd", label: "YTD" },
            { value: "12", label: "1y" },
            { value: "24", label: "2y" },
            { value: "60", label: "5y" },
          ]}
          value={window}
          onChange={(v) => setWindow(v as Window)}
        />
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/*
            * What came in, and what it was made of.
            *
            * Total first, because that is the question the page is asked, with
            * the monthly rate beside it. The split underneath answers the next
            * one: how much of this arrived because you went to work, and how
            * much arrived on its own.
            */}
          <StatCard
            label="Total income"
            value={fmtCAD(breakdown.total)}
            deltaValue={`${fmtCAD(breakdown.average)} a month`}
            deltaLabel={`over ${breakdown.windowMonths} month${
              breakdown.windowMonths === 1 ? "" : "s"
            }`}
            icon={<Banknote size={16} />}
            footer={
              <div className="space-y-2">
                <SplitBar
                  active={data.active}
                  passive={data.passive}
                  passiveColor={passiveColor}
                />
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: accent("positive") }}
                    />
                    Worked for
                  </span>
                  <span className="tabular-nums text-ink">
                    {fmtCAD(data.active)}
                    <span className="text-ink-faint"> a month</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-ink-dim">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: passiveColor }}
                    />
                    Arrived on its own
                  </span>
                  <span className="tabular-nums text-ink">
                    {fmtCAD(data.passive)}
                    <span className="text-ink-faint">
                      {" "}
                      a month
                      {breakdown.average > 0
                        ? ` · ${((data.passive / breakdown.average) * 100).toFixed(1)}%`
                        : ""}
                    </span>
                  </span>
                </div>
              </div>
            }
          />

          {/*
            * The money that is actually free.
            *
            * Income you can draw on, less everything that went out. It is the
            * only figure here that says what could be saved or spent on
            * something new, which is usually the reason for asking what came
            * in at all.
            */}
          <StatCard
            label="Free each month"
            value={fmtCAD(data.avg.uncommittedLiquid)}
            tone={data.avg.uncommittedLiquid >= 0 ? "positive" : "negative"}
            deltaLabel={`averaged over ${data.avg.months} month${
              data.avg.months === 1 ? "" : "s"
            }`}
            icon={<Wallet size={16} />}
            footer={
              <div className="space-y-2 text-xs">
                <FactRow
                  label="Reaches an account you can spend from"
                  value={fmtCAD(data.liquidIn)}
                />
                <FactRow
                  label="Expenses"
                  value={`−${fmtCAD(data.avg.expenses)}`}
                  dim
                />
                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                  <span className="text-ink-dim">Left over</span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      data.avg.uncommittedLiquid >= 0
                        ? "text-positive"
                        : "text-negative",
                    )}
                  >
                    {fmtCAD(data.avg.uncommittedLiquid)}
                  </span>
                </div>
              </div>
            }
          />

          {/*
            * This year against last, over the same months of each.
            *
            * Fixed to the calendar rather than following the window above,
            * because "this year" is not a length of time you choose — and the
            * comparison is only fair if both sides have had the same number of
            * months to happen in.
            */}
          <StatCard
            label={`${data.yoy.now.year} so far, per month`}
            value={fmtCAD(data.yoy.now.average)}
            delta={data.yoy.change === null ? undefined : data.yoy.change * 100}
            deltaLabel={`vs the same ${data.yoy.months} month${
              data.yoy.months === 1 ? "" : "s"
            } of ${data.yoy.before.year}`}
            icon={<CalendarRange size={16} />}
            footer={
              <div className="space-y-2 text-xs">
                <FactRow
                  label={`${data.yoy.now.year} · ${fmtCAD(data.yoy.now.total)} in total`}
                  value={`${fmtCAD(data.yoy.now.average)} a month`}
                />
                <FactRow
                  label={`${data.yoy.before.year} · ${fmtCAD(data.yoy.before.total)} in total`}
                  value={`${fmtCAD(data.yoy.before.average)} a month`}
                  dim
                />
                <p className="pt-1 text-[0.6875rem] leading-relaxed text-ink-faint">
                  {data.yoy.change === null
                    ? `Nothing recorded in ${data.yoy.before.year} to compare against.`
                    : `${
                        data.yoy.change >= 0 ? "Up" : "Down"
                      } ${fmtCAD(Math.abs(data.yoy.now.average - data.yoy.before.average))} a month on the same stretch of last year.`}
                </p>
              </div>
            }
          />
        </div>

        <Card>
          <CardHeader
            title="Income from every source"
            subtitle={`Against the ${breakdown.windowMonths} months before these`}
          />
          {/*
            * The table is not a legend.
            *
            * Salary is fifty times interest on this record, so the small
            * sources are a hairline in the chart however it is drawn — and
            * they are the ones worth watching, because a source that is
            * growing starts small. The figures say what the chart cannot
            * resolve.
            */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-[0.625rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Per month</th>
                  <th className="px-3 py-2 text-right font-medium">In total</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Months</th>
                  <th className="px-3 py-2 text-right font-medium">
                    vs the window before
                  </th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.sources.map((s) => (
                  <tr
                    key={s.category}
                    className="border-b border-line/40 last:border-0"
                  >
                    <td className="px-5 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: colors[s.category] }}
                        />
                        <span className="truncate">{s.category}</span>
                        {!s.spendable && (
                          <span
                            title="Does not land in an account you can spend from"
                            className="text-ink-faint"
                          >
                            *
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {fmtCAD(s.average)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                      {fmtCAD(s.total)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                      {fmtPct(s.share, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                      {s.months}/{breakdown.windowMonths}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.change === null ? (
                        <span
                          className="text-ink-faint"
                          title="Nothing under this heading in the window before"
                        >
                          new
                        </span>
                      ) : (
                        <span
                          className={cn(
                            s.change >= 0 ? "text-positive" : "text-negative",
                          )}
                        >
                          {s.change >= 0 ? "+" : ""}
                          {fmtPct(s.change * 100, 0)}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <Sparkline
                        data={series.get(s.category) ?? []}
                        dataKey="value"
                        color={colors[s.category]}
                        height={30}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line">
                  <td className="px-5 py-2 font-semibold">All income</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtCAD(breakdown.average)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmtCAD(breakdown.total)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-5 pb-4 pt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
            <strong className="text-ink-dim">Per month</strong> divides by every
            month of the window rather than by the months a source arrived in,
            so a bonus paid once reads as what it adds to a month rather than
            what it was.{" "}
            <strong className="text-ink-dim">Months</strong> is how many of them
            it arrived in at all, which is what tells a salary from a windfall.
            {breakdown.sources.some((s) => !s.spendable) && (
              <>
                {" "}
                An asterisk marks income that never reaches an account you can
                spend from — a pension contribution, or a dividend kept in the
                brokerage that earned it. Money borrowed is not here at all:
                it arrives, but it is a debt appearing at the same moment
                rather than something earned.
              </>
            )}
          </p>
        </Card>

        <Card>
          <CardHeader
            title="Income month by month"
            subtitle={`Every kind of income · ${breakdown.windowMonths} months through ${labelMonth(through)}`}
          />
          <div className="px-3 pb-4">
            {/*
              * Bars, because income arrives in discrete lumps rather than
              * flowing: a month is paid or it is not, and an area chart
              * interpolates between two months as though the money were
              * accruing across the gap. A bar per month says what that month
              * brought in and nothing about the space between.
              *
              * Stacked in dollars, not shares. The spending page draws its
              * mix as a hundred percent because a month's spending is a whole
              * to be divided; income is not — the question is how much
              * arrived as well as what it arrived as, and a share would answer
              * only half of it.
              */}
            <GroupedBars
              data={breakdown.months}
              xKey="label"
              bars={breakdown.sources.map((s) => ({
                key: s.category,
                name: s.category,
                color: colors[s.category],
              }))}
              stacked
              height={300}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        {data.passiveSources.length > 0 && (
          <Card>
            <CardHeader
              title="Passive income"
              subtitle={`Dividends and interest · ${breakdown.windowMonths} months through ${labelMonth(through)}`}
            />
            <div className="px-3 pb-4">
              <GroupedBars
                data={data.passiveMonths}
                xKey="label"
                bars={data.passiveSources.map((s) => ({
                  key: s.category,
                  name: s.category,
                  color: colors[s.category],
                }))}
                stacked
                height={220}
                yFmt={fmtCompact}
              />
            </div>
            <p className="px-5 pb-5 text-[0.6875rem] leading-relaxed text-ink-faint">
              {fmtCAD(data.passive)} a month on average, which is{" "}
              <strong className="text-ink-dim">
                {breakdown.average > 0
                  ? `${((data.passive / breakdown.average) * 100).toFixed(1)}%`
                  : "—"}
              </strong>{" "}
              of everything that came in
              {data.passiveBest > 0 && (
                <> · best month {fmtCAD(data.passiveBest)}</>
              )}
              . This is the part that does not need you to work for it, so what
              matters is the slope rather than the height.
            </p>
          </Card>
        )}
      </div>
    </Shell>
  );
}
