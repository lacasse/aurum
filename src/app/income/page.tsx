"use client";

import { useMemo, useState } from "react";
import { Banknote, Coins, HandCoins, Landmark } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader, EmptyState, Segmented, cn } from "@/components/ui";
import { SeriesChart, Sparkline, categoryColors } from "@/components/charts";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { incomeBySource, PASSIVE_INCOME_CATEGORIES } from "@/lib/analytics";
import {
  fmtCAD,
  fmtCompact,
  fmtPct,
  labelMonth,
  lastCompleteMonthKey,
} from "@/lib/format";

type Window = 12 | 24 | 60;

export default function IncomePage() {
  const ready = useReady();
  const transactions = useFinance((s) => s.transactions);
  const [window, setWindow] = useState<Window>(12);

  /*
   * Through the last complete month, like everything else that compares one
   * month with the next. A month in progress drawn beside whole ones reads as
   * a collapse in earnings, which would be a fact about the calendar.
   */
  const through = lastCompleteMonthKey();

  const data = useMemo(() => {
    const breakdown = incomeBySource(transactions, window, through);
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

    const spendable = breakdown.sources
      .filter((s) => s.spendable)
      .reduce((sum, s) => sum + s.average, 0);
    const passive = breakdown.sources
      .filter((s) => PASSIVE_INCOME_CATEGORIES.has(s.category))
      .reduce((sum, s) => sum + s.average, 0);

    return { breakdown, colors, series, spendable, passive };
  }, [transactions, window, through]);

  if (!ready) return <PageSkeleton />;

  const { breakdown, colors, series } = data;
  const largest = breakdown.sources[0];

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
            { value: "12", label: "1y" },
            { value: "24", label: "2y" },
            { value: "60", label: "5y" },
          ]}
          value={String(window)}
          onChange={(v) => setWindow(Number(v) as Window)}
        />
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Income a month"
            value={fmtCAD(breakdown.average)}
            deltaValue={fmtCAD(breakdown.total)}
            deltaLabel={`over ${breakdown.windowMonths} months`}
            icon={<Banknote size={16} />}
            spark={breakdown.months.map((m) => ({
              v: breakdown.sources.reduce(
                (sum, s) => sum + Number(m[s.category] ?? 0),
                0,
              ),
            }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Spendable a month"
            value={fmtCAD(data.spendable)}
            deltaValue={
              breakdown.average > 0
                ? `${Math.round((data.spendable / breakdown.average) * 100)}%`
                : undefined
            }
            deltaLabel="reaches an account you can draw on"
            icon={<HandCoins size={16} />}
          />
          <StatCard
            label="Passive a month"
            value={fmtCAD(data.passive)}
            deltaValue={
              breakdown.average > 0
                ? `${Math.round((data.passive / breakdown.average) * 100)}%`
                : undefined
            }
            deltaLabel="dividends and interest"
            icon={<Coins size={16} />}
          />
          <StatCard
            label="Largest source"
            value={largest?.category ?? "—"}
            deltaValue={
              largest ? `${fmtCAD(largest.average)}/mo` : undefined
            }
            deltaLabel={largest ? `${largest.share.toFixed(0)}% of everything` : ""}
            icon={<Landmark size={16} />}
          />
        </div>

        <Card>
          <CardHeader
            title="Month by month"
            subtitle={`Every kind of income · ${breakdown.windowMonths} months through ${labelMonth(through)}`}
          />
          <div className="px-3 pb-4">
            {/*
              * Stacked in dollars, not shares. The spending page draws its
              * mix as a hundred percent because a month's spending is a whole
              * to be divided; income is not — the question is how much
              * arrived as well as what it arrived as, and a share would answer
              * only half of it.
              */}
            <SeriesChart
              data={breakdown.months}
              xKey="label"
              series={breakdown.sources.map((s) => ({
                key: s.category,
                name: s.category,
                color: colors[s.category],
                kind: "area" as const,
              }))}
              stacked
              fadeAtZero
              height={300}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Every source"
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
                spend from — a pension contribution, a dividend kept in the
                brokerage that earned it, or money borrowed.
              </>
            )}
          </p>
        </Card>
      </div>
    </Shell>
  );
}
