"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Flag, PiggyBank, Wallet } from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { Badge, Card, CardHeader, EmptyState, Segmented, cn } from "@/components/ui";
import { GroupedBars } from "@/components/charts";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  allTimeSeries,
  firstFlowMonth,
  monthsSince,
  netExternalFlows,
  netWorthOver,
  portfolioSeries,
} from "@/lib/analytics";
import { milestones, yearRows } from "@/lib/year";
import { fmtCAD, fmtCompact, fmtPct, fmtSignedCAD, labelMonth } from "@/lib/format";

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
    return { rows, marks: milestones(netWorth) };
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

  /*
   * One row per month rather than per step: a month that passed several is a
   * single event, and the badge says how many.
   */
  const grouped = [...data.marks]
    .reduce<{ month: string; from: number; to: number; count: number; months: number | null }[]>(
      (acc, m) => {
        const last = acc[acc.length - 1];
        if (last && last.month === m.month) {
          last.to = m.amount;
          last.count++;
          return acc;
        }
        acc.push({
          month: m.month,
          from: m.amount,
          to: m.amount,
          count: 1,
          months: m.monthsFromPrevious,
        });
        return acc;
      },
      [],
    )
    .reverse();

  const bars = [...data.rows]
    .reverse()
    .map((r) => ({ label: r.year, income: r.income, expenses: r.expenses }));

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

        <Card>
          <CardHeader
            title="Income against spending"
            subtitle="Every year on record, side by side"
          />
          <div className="px-3 pb-4">
            <GroupedBars
              data={bars as unknown as Record<string, unknown>[]}
              xKey="label"
              bars={[
                { key: "income", name: "Income", color: "#34d399" },
                { key: "expenses", name: "Expenses", color: "#fb7185" },
              ]}
              height={260}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

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

        {data.marks.length > 0 && (
          <Card>
            <CardHeader
              title="Milestones"
              subtitle="The month each step was first passed, and how long it took"
            />
            {/*
              * Several steps crossed in one month are one event, not several.
              * The record opens partway up — the first month with a portfolio
              * figure in it passes fourteen at once — and fourteen rows saying
              * "same month" describe the gap in the data rather than a year of
              * progress.
              */}
            <ul className="grid gap-1 px-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map((g) => (
                <li
                  key={g.month}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-elevated"
                >
                  <Flag size={14} className="shrink-0 text-brand" />
                  <span className="font-medium tabular-nums">
                    {g.from === g.to
                      ? fmtCompact(g.to)
                      : `${fmtCompact(g.from)}–${fmtCompact(g.to)}`}
                  </span>
                  <span className="text-sm text-ink-dim">{labelMonth(g.month)}</span>
                  <Badge className="ml-auto">
                    {g.months === null
                      ? `${g.count} at once`
                      : g.count > 1
                        ? `${g.count} in ${g.months} mo`
                        : `${g.months} mo`}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
