"use client";

import { useMemo, useState } from "react";
import { Banknote, Coins, HandCoins } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader, EmptyState, Segmented, cn } from "@/components/ui";
import {
  GroupedBars,
  Sparkline,
  categoryColors,
  spectrumAt,
} from "@/components/charts";
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

    return {
      breakdown,
      colors,
      series,
      spendable,
      passive,
      passiveSources,
      passiveMonths,
      passiveBest,
    };
  }, [transactions, window, through]);

  if (!ready) return <PageSkeleton />;

  const { breakdown, colors, series } = data;

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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Income per month"
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
            /*
             * The palette's own single colour — what `spectrumAt` gives a
             * series of one. The green here before came from a categorical set
             * that no longer exists anywhere else in the app, so the two cards
             * were drawn in colours the charts below could never produce.
             */
            sparkColor={spectrumAt(0, 1)}
          />
          <StatCard
            label="Spendable per month"
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
            label="Passive income per month"
            value={fmtCAD(data.passive)}
            deltaValue={
              breakdown.average > 0
                ? `${((data.passive / breakdown.average) * 100).toFixed(1)}%`
                : undefined
            }
            /*
             * A decimal: passive income is a small share of a large number,
             * and "1%" rounded from 1.4 hides the only movement there is to
             * see in it.
             */
            deltaLabel="of all income"
            icon={<Coins size={16} />}
            spark={data.passiveMonths.map((m) => ({
              v: data.passiveSources.reduce(
                (sum, s) => sum + Number(m[s.category] ?? 0),
                0,
              ),
            }))}
            sparkKey="v"
            /* The colour the same figures wear in the chart below. */
            sparkColor={
              data.passiveSources.length > 0
                ? colors[data.passiveSources[0].category]
                : spectrumAt(0, 1)
            }
          />
        </div>

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
                spend from — a pension contribution, or a dividend kept in the
                brokerage that earned it. Money borrowed is not here at all:
                it arrives, but it is a debt appearing at the same moment
                rather than something earned.
              </>
            )}
          </p>
        </Card>
      </div>
    </Shell>
  );
}
