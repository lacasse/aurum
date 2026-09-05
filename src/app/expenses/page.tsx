"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Anchor,
  ArrowDownWideNarrow,
  Car,
  Plus,
  Receipt,
  Settings2,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  cn,
} from "@/components/ui";
import {
  ChartLegend,
  DonutChart,
  SeriesChart,
  Sparkline,
  categoryColors,
} from "@/components/charts";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import {
  DEFAULT_SPEND_GROUPS,
  SPEND_GROUP_LABELS,
  categoryRows,
  expenseMonths,
  groupOf,
  monthSummary,
  monthlySpend,
  recurringFloor,
  rollingAverage,
  runningCost,
  type SpendGroup,
} from "@/lib/expenses";
import {
  currentMonthKey,
  daysLeftInMonth,
  fmtCAD,
  fmtCompact,
  fmtSignedCAD,
  labelMonth,
} from "@/lib/format";
import type { Budget } from "@/lib/types";

interface Settings {
  groups: Record<string, SpendGroup>;
  car: { start: string; categories: string[] } | null;
}

const EMPTY: Settings = { groups: {}, car: null };

const GROUP_TONE: Record<SpendGroup, "positive" | "brand" | "neutral"> = {
  necessity: "brand",
  discretionary: "positive",
  excluded: "neutral",
};

/**
 * Where the money goes.
 *
 * Two questions the dashboard's twelve-month averages cannot answer: what a
 * particular month was made of, and whether that month was normal. Everything
 * here is anchored to one month at a time and compared against the eleven
 * behind it — that is the comparison that separates an expensive month from
 * an expensive habit.
 */
export default function ExpensesPage() {
  const ready = useReady();
  const transactions = useFinance((s) => s.transactions);
  const categories = useFinance((s) => s.categories);
  const budgets = useFinance((s) => s.budgets);

  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [month, setMonth] = useState<string | null>(null);
  const [window, setWindow] = useState<12 | 24 | 60>(24);
  const [editing, setEditing] = useState<"groups" | "car" | null>(null);
  /* Which category's budget is being typed into, in the table below. */
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<{
    name: string;
    txnCount: number;
    fallback: string;
  } | null>(null);
  const setBudget = useFinance((s) => s.setBudget);
  const deleteBudget = useFinance((s) => s.deleteBudget);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/expense-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Settings) => {
        if (!cancelled) setSettings({ groups: s.groups ?? {}, car: s.car ?? null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((next: Settings) => {
    setSettings(next);
    fetch("/api/expense-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => {});
  }, []);

  const months = useMemo(() => expenseMonths(transactions), [transactions]);
  /*
   * The newest month with anything in it, not the calendar month. This record
   * is kept by hand and runs a month or two behind, so opening on "now" would
   * show an empty page and report spending as having stopped.
   */
  const latest = months[months.length - 1] ?? null;
  const selected = month && months.includes(month) ? month : latest;

  const data = useMemo(() => {
    if (!selected) return null;
    const g = settings.groups;
    const series = monthlySpend(transactions, g);
    const avg = rollingAverage(series.map((m) => m.total), 12);
    const trend = series.map((m, i) => ({ ...m, average: avg[i] ?? undefined }));
    const rows = categoryRows(transactions, selected, g);
    const summary = monthSummary(transactions, selected, g);
    const floor = recurringFloor(transactions, g, 12, latest ?? undefined);
    const car = settings.car
      ? runningCost(
          transactions,
          settings.car.categories,
          settings.car.start,
          latest ?? selected,
        )
      : null;
    const spent = rows.filter((r) => r.amount > 0 && r.group !== "excluded");

    /*
     * The plan, against the same month as everything else on the page.
     *
     * Budgets were a page of their own that could only ever show the month in
     * progress. A limit is a property of a category, and the useful question
     * is whether a *finished* month kept to it — so it is read here, for
     * whichever month is selected, and the pace figure is the one part that
     * only makes sense while the month is still running.
     */
    const limits = new Map(budgets.map((b) => [b.category, b.limit]));
    const budgeted = budgets.reduce((sum, b) => sum + b.limit, 0);
    const againstPlan = rows
      .filter((r) => limits.has(r.category))
      .reduce((sum, r) => sum + r.amount, 0);

    return {
      limits,
      budgeted,
      againstPlan,
      trend,
      rows,
      summary,
      floor,
      car,
      donut: spent.map((r) => ({ name: r.category, value: r.amount })),
      colors: categoryColors(spent.map((r) => r.category)),
      movers: [...rows]
        .filter((r) => r.group !== "excluded" && Math.abs(r.delta) >= 1)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6),
    };
  }, [transactions, budgets, settings, selected, latest]);

  if (!ready) return <PageSkeleton />;

  if (!selected || !data) {
    return (
      <Shell title="Expenses" subtitle="What you spent, and what you meant to spend">
        <EmptyState
          icon={<Receipt size={20} />}
          title="No spending recorded yet"
          subtitle="Add an expense, or import a statement, and this page fills in."
        />
      </Shell>
    );
  }

  const { summary, floor, car } = data;

  /*
   * How many months on record cost less than this one.
   *
   * The rank alone does not say much — 3rd is alarming out of 26 and
   * unremarkable out of 4 — and a count is easier to picture than either a
   * rank or a percentile. Green once at least half the record is cheaper,
   * which is the median month; above that the tone turns.
   */
  const cheaperMonths =
    summary.rank === null ? null : summary.months - summary.rank;
  const pct = (now: number, then: number | null) =>
    then !== null && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : undefined;
  const trend = data.trend.slice(-window);
  const spark = data.trend.slice(-13);

  return (
    <Shell
      title="Expenses"
      subtitle="What you spent, and what you meant to spend"
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing("groups")}
            aria-label="Edit categories, their kind and their budgets"
          >
            <Settings2 size={14} />
            <span className="hidden sm:inline">Categories &amp; budgets</span>
          </Button>
          <Select
            value={selected}
            onChange={(e) => setMonth(e.target.value)}
            className="w-36"
            aria-label="Month"
          >
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {labelMonth(m)}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <div className="space-y-4">
        {selected !== latest && (
          <p className="px-1 text-[0.6875rem] text-ink-faint">
            Showing {labelMonth(selected)}. The record runs to {labelMonth(latest!)}.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={`Expenses for ${labelMonth(selected)}`}
            value={fmtCAD(summary.total)}
            delta={pct(summary.total, summary.average)}
            deltaLabel={
              summary.averageMonths > 0
                ? `vs the ${summary.averageMonths}-month average`
                : "no months to compare against"
            }
            tone={
              summary.average === null || summary.total <= summary.average
                ? "positive"
                : "negative"
            }
            icon={<Receipt size={16} />}
            spark={spark.map((m) => ({ v: m.total }))}
            sparkKey="v"
            sparkColor="#f472b6"
          />
          <StatCard
            label="Necessities"
            value={fmtCAD(summary.necessity)}
            deltaValue={
              summary.total > 0
                ? `${((summary.necessity / summary.total) * 100).toFixed(0)}%`
                : undefined
            }
            deltaLabel="of the month"
            icon={<Anchor size={16} />}
            spark={spark.map((m) => ({ v: m.necessity }))}
            sparkKey="v"
            sparkColor="#8b5cf6"
          />
          <StatCard
            label="Discretionary"
            value={fmtCAD(summary.discretionary)}
            deltaValue={
              summary.discretionaryShare === null
                ? undefined
                : `${summary.discretionaryShare.toFixed(0)}%`
            }
            deltaLabel="of the month"
            icon={<ShoppingBag size={16} />}
            spark={spark.map((m) => ({ v: m.discretionary }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          {/*
            * How this month compares with every other, in the fourth slot
            * rather than as a line of grey text under the row.
            *
            * The three cards beside it are all this month against itself —
            * what it cost, and how it split. This is the only one that
            * measures it against the record, which is what makes "expensive"
            * mean anything, so it earns a card rather than a footnote.
            *
            * Laid out by hand rather than with StatCard because of the two
            * sentences at the bottom, which that component has no slot for.
            * The classes above them are StatCard's own, so the four cards
            * still line up label to label and figure to figure.
            */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-dim">
                Monthly expenses rank
              </span>
              <span className="text-ink-faint">
                <ArrowDownWideNarrow size={16} />
              </span>
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
              {summary.rank !== null ? (
                <>
                  {ordinal(summary.rank)}
                  <span className="ml-1.5 text-sm font-normal text-ink-faint">
                    of {summary.months}
                  </span>
                </>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {cheaperMonths !== null ? (
                <Badge
                  tone={
                    cheaperMonths * 2 >= summary.months ? "positive" : "negative"
                  }
                >
                  {cheaperMonths === 1
                    ? "1 month cost less"
                    : `${cheaperMonths} months cost less`}
                </Badge>
              ) : null}
            </div>
            {/*
              * Two rows rather than two sentences: they are the same shape of
              * fact — a month, and what it cost — and as prose they wrapped
              * into a grey paragraph nobody reads. Ranged left and right, the
              * figures line up under each other and under the ones on the
              * cards beside this.
              */}
            <dl className="mt-4 space-y-1 border-t border-line pt-3 text-[0.6875rem]">
              {summary.previous !== null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-faint">The month before</dt>
                  <dd className="font-medium tabular-nums text-ink-dim">
                    {fmtCAD(summary.previous)}
                  </dd>
                </div>
              )}
              {summary.lastYear !== null && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-faint">A year earlier</dt>
                  <dd className="font-medium tabular-nums text-ink-dim">
                    {fmtCAD(summary.lastYear)}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Spending month by month"
            subtitle="Necessities under discretion, with the twelve-month average across them"
            action={
              <Segmented<string>
                options={[
                  { value: "12", label: "1y" },
                  { value: "24", label: "2y" },
                  { value: "60", label: "5y" },
                ]}
                value={String(window)}
                onChange={(v) => setWindow(Number(v) as 12 | 24 | 60)}
              />
            }
          />
          <div className="px-3 pb-4">
            <SeriesChart
              data={trend as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              series={[
                { key: "necessity", name: "Necessities", color: "#8b5cf6" },
                { key: "discretionary", name: "Discretionary", color: "#34d399" },
                {
                  key: "average",
                  name: "12-month average",
                  color: "#f59e0b",
                  kind: "line",
                  dashed: true,
                },
              ]}
              height={280}
              yFmt={fmtCompact}
            />
            <div className="px-2 pt-2">
              <ChartLegend
                items={[
                  { label: "Necessities", color: "#8b5cf6" },
                  { label: "Discretionary", color: "#34d399" },
                  { label: "12-month average of the total", color: "#f59e0b" },
                ]}
              />
            </div>
          </div>
          <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
            Debt repayment is left out of every total on this page. It is money
            moving from one side of the balance sheet to the other rather than
            money spent, and counting it makes a year of paying down a loan look
            like a year of living beyond your means.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title={`What ${labelMonth(selected)} was made of`}
              subtitle="Consumption only, largest first"
            />
            <div className="px-4 pb-4">
              {data.donut.length > 0 ? (
                <DonutChart
                  data={data.donut}
                  colors={data.colors}
                  centerLabel="Spent"
                  centerValue={fmtCAD(summary.total)}
                  fmt={(n) => fmtCAD(n)}
                  height={260}
                  /* Two thirds of the row is too wide for a ring alone. */
                  legend="right"
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  Nothing recorded in {labelMonth(selected)}.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="What moved"
              subtitle="This month against each category's average"
            />
            <div className="space-y-1 px-3 pb-4">
              {data.movers.length === 0 ? (
                <p className="py-16 text-center text-xs text-ink-faint">
                  Every category came in close to its average.
                </p>
              ) : (
                data.movers.map((r) => (
                  <div
                    key={r.category}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-elevated"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: data.colors[r.category] ?? "var(--ink-faint)" }}
                    />
                    <span className="truncate text-sm">{r.category}</span>
                    <span className="ml-auto shrink-0 text-sm tabular-nums">
                      {fmtCAD(r.amount)}
                    </span>
                    <Badge tone={r.delta > 0 ? "negative" : "positive"}>
                      {r.delta > 0 ? "▲" : "▼"} {fmtCAD(Math.abs(r.delta))}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {data.budgeted > 0 && (
          /*
           * One strip rather than a page: the four cards, the gauge and the
           * budget-vs-actual chart it replaces all said the same two numbers,
           * and the per-category detail belongs in the table below where the
           * limit sits beside what was actually spent.
           */
          <Card className="p-5">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div>
                <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  Against the budget
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {fmtCAD(data.againstPlan)}
                  <span className="ml-1.5 text-sm font-normal text-ink-faint">
                    of {fmtCAD(data.budgeted)} budgeted
                  </span>
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  {data.budgeted - data.againstPlan >= 0 ? "Under by" : "Over by"}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xl font-semibold tabular-nums",
                    data.budgeted - data.againstPlan >= 0
                      ? "text-positive"
                      : "text-negative",
                  )}
                >
                  {fmtCAD(Math.abs(data.budgeted - data.againstPlan))}
                </p>
              </div>
              {selected === currentMonthKey() && (
                <div>
                  <p className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                    {daysLeftInMonth()} days left
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {fmtCAD(
                      Math.max(0, data.budgeted - data.againstPlan) /
                        Math.max(1, daysLeftInMonth()),
                    )}
                    <span className="ml-1.5 text-sm font-normal text-ink-faint">
                      a day
                    </span>
                  </p>
                </div>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">
                  {data.budgeted > 0
                    ? `${Math.round((data.againstPlan / data.budgeted) * 100)}%`
                    : "—"}
                </span>
                <div className="h-2 w-40 overflow-hidden rounded-full bg-elevated">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      data.againstPlan > data.budgeted
                        ? "bg-negative"
                        : "bg-positive",
                    )}
                    style={{
                      width: `${Math.min(100, (data.againstPlan / data.budgeted) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
              Counts only the {data.limits.size} categor
              {data.limits.size === 1 ? "y that has" : "ies that have"} a budget
              — the rest of the month is above.
            </p>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Every category"
            subtitle={`${labelMonth(selected)} against the ${summary.averageMonths} months before it`}
          />
          <div className="overflow-x-auto px-2 pb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">Kind</th>
                  <th className="px-3 py-2 text-right font-medium">This month</th>
                  <th className="px-3 py-2 text-right font-medium">Budget</th>
                  <th className="px-3 py-2 text-right font-medium">Average</th>
                  <th className="px-3 py-2 text-right font-medium">Vs average</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Months</th>
                  <th className="px-3 py-2 text-right font-medium">Year ago</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Trend</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.category} className="border-t border-line/60 hover:bg-elevated">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: data.colors[r.category] ?? "var(--ink-faint)",
                          }}
                        />
                        {r.category}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={GROUP_TONE[r.group]}>
                        {SPEND_GROUP_LABELS[r.group]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {fmtCAD(r.amount)}
                    </td>
                    {/*
                      * The limit beside what was actually spent, which is the
                      * one place a budget answers anything — and editable
                      * there, since a budget is most often changed by looking
                      * at what the category actually costs.
                      */}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {editingLimit === r.category ? (
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          autoFocus
                          placeholder="none"
                          defaultValue={data.limits.get(r.category) ?? ""}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (e.target.value.trim() === "" || v <= 0) {
                              deleteBudget(r.category);
                            } else if (Number.isFinite(v)) {
                              setBudget(r.category, Math.round(v * 100) / 100);
                            }
                            setEditingLimit(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingLimit(null);
                          }}
                          className="h-7 w-24 py-0 text-right text-[0.8125rem] tabular-nums"
                          aria-label={`Monthly budget for ${r.category}`}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingLimit(r.category)}
                          className="inline-flex items-center justify-end gap-2 rounded px-1 hover:bg-elevated"
                          title={`Set a monthly budget for ${r.category}`}
                        >
                          {data.limits.has(r.category) ? (
                            <>
                              <span
                                className={cn(
                                  "text-[0.6875rem]",
                                  r.amount > data.limits.get(r.category)!
                                    ? "text-negative"
                                    : "text-ink-faint",
                                )}
                              >
                                {Math.round(
                                  (r.amount / data.limits.get(r.category)!) * 100,
                                )}
                                %
                              </span>
                              <span className="text-ink-dim">
                                {fmtCAD(data.limits.get(r.category)!)}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-faint">Set</span>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                      {fmtCAD(r.average)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        r.delta > 0 ? "text-negative" : "text-positive",
                      )}
                    >
                      {fmtSignedCAD(r.delta)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                      {r.group === "excluded" ? "—" : `${r.share.toFixed(0)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-faint">
                      {r.monthsSeen}/{r.monthsInWindow}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-dim">
                      {r.lastYear === null ? "—" : fmtCAD(r.lastYear)}
                    </td>
                    <td className="px-1 py-1">
                      <Sparkline
                        data={r.series}
                        dataKey="value"
                        color={data.colors[r.category] ?? "var(--ink-faint)"}
                        height={30}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${r.category}`}
                        className="hover:text-negative"
                        onClick={() => {
                          const rest = categories.filter((c) => c !== r.category);
                          setDeletingCategory({
                            name: r.category,
                            txnCount: transactions.filter(
                              (t) => t.category === r.category,
                            ).length,
                            fallback: rest.includes("Other")
                              ? "Other"
                              : (rest[0] ?? "nowhere"),
                          });
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
            <strong className="text-ink-dim">Average</strong> is taken over the
            months behind this one, and never includes the month being read — a
            month cannot be unusual against an average it is part of.{" "}
            <strong className="text-ink-dim">Months</strong> counts how many of
            them the category appeared in at all: something billed twelve times
            out of twelve is a commitment, and something billed twice is a
            decision. Click a figure under{" "}
            <strong className="text-ink-dim">Budget</strong> to set or change
            it — clearing it removes the budget rather than setting it to zero.
          </p>
        </Card>

        {/*
          * The cost of a thing you own, rather than of a month.
          *
          * Nothing else on the page can answer it: the categories are what the
          * record has, and "the car" is spread across whichever of them the
          * user says it is. So the question is asked here — from when, and
          * which categories — and the arithmetic follows.
          */}
        <Card>
          <CardHeader
            title="What the car costs"
            subtitle={
              settings.car
                ? `${settings.car.categories.join(", ")} since ${labelMonth(settings.car.start)}`
                : "Pick a starting point and the categories that belong to it"
            }
            action={
              <Button variant="ghost" size="sm" onClick={() => setEditing("car")}>
                <Settings2 size={14} /> {settings.car ? "Change" : "Set up"}
              </Button>
            }
          />
          {car && car.months > 0 ? (
            <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[repeat(4,minmax(0,1fr))_2fr]">
              <Figure
                label="Per month"
                value={fmtCAD(car.perMonth)}
                note={`over ${car.months} months of ownership`}
                strong
              />
              <Figure label="Per year" value={fmtCAD(car.perYear)} note="at that rate" />
              <Figure
                label="Total"
                value={fmtCAD(car.total)}
                note={`since ${labelMonth(settings.car!.start)}`}
              />
              <Figure
                label="Priciest month"
                value={car.largest ? fmtCAD(car.largest.value) : "—"}
                note={car.largest ? labelMonth(car.largest.key) : "nothing recorded"}
              />
              <div className="min-w-0">
                <span className="text-xs font-medium text-ink-dim">Month by month</span>
                <Sparkline data={car.series} dataKey="value" color="#f59e0b" height={72} />
              </div>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <EmptyState
                icon={<Car size={20} />}
                title={settings.car ? "Nothing in those categories yet" : "Not set up"}
                subtitle="Choose the month you bought it and the categories its costs land in."
              />
            </div>
          )}
          {car && car.months > 0 && (
            <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
              Divided by every month of ownership, including the{" "}
              {car.months - car.monthsWithSpend} with no charge at all — a car
              costs what it costs in the months it is not filled up, and
              averaging only over the months with a receipt would price it off
              its expensive ones alone.
            </p>
          )}
        </Card>
        {floor.items.length > 0 && (
          <Card>
            <CardHeader
              title="The floor"
              subtitle="What a month costs before anything is decided"
            />
            <ul className="grid gap-1 px-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {floor.items.map((i) => (
                <li
                  key={i.category}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-elevated"
                >
                  <span className="text-sm">{i.category}</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {fmtCAD(i.typical)}
                  </span>
                  <Badge>{i.months}/{floor.window}</Badge>
                </li>
              ))}
            </ul>
            <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
              The categories that turned up in all but at most one of the last{" "}
              {floor.window} months, each at its median month rather than its
              average — one bad vet bill is not a standing cost.{" "}
              <strong className="text-ink-dim">{fmtCAD(floor.total)}</strong> a
              month is therefore what has to be cleared before a month can be
              called cheap.
            </p>
          </Card>
        )}
      </div>

      {/*
        * Mounted only while open, so each opening starts from what is saved.
        * The alternative — one long-lived component reset by an effect — is a
        * cascading render, and React now says so out loud.
        */}
      {editing === "groups" && (
        <CategoriesModal
          onClose={() => setEditing(null)}
          categories={categories}
          budgets={budgets}
          settings={settings}
          onSave={save}
        />
      )}
      {deletingCategory && (
        <DeleteCategoryModal
          {...deletingCategory}
          onClose={() => setDeletingCategory(null)}
        />
      )}
      {editing === "car" && (
        <CarModal
          onClose={() => setEditing(null)}
          categories={categories}
          months={months}
          settings={settings}
          onSave={save}
        />
      )}
    </Shell>
  );
}

function Figure({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note: string;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0">
      <span className="text-xs font-medium text-ink-dim">{label}</span>
      <div
        className={cn(
          "mt-1 font-semibold tabular-nums",
          strong ? "text-2xl tracking-tight" : "text-lg",
        )}
      >
        {value}
      </div>
      <span className="text-[0.6875rem] text-ink-faint">{note}</span>
    </div>
  );
}

function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Everything a category is, in one dialog.
 *
 * It asked only whether a category was a necessity; the budget for it lived on
 * a page of its own, with a second list of the same names and its own rename
 * and delete. A category has a name, a kind and a monthly figure you mean to
 * keep it under — three attributes of one thing, so they are edited in one
 * place.
 */
function CategoriesModal({
  onClose,
  categories,
  budgets,
  settings,
  onSave,
}: {
  onClose: () => void;
  categories: string[];
  budgets: Budget[];
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const setBudget = useFinance((s) => s.setBudget);
  const deleteBudget = useFinance((s) => s.deleteBudget);
  const addCategory = useFinance((s) => s.addCategory);
  const renameCategory = useFinance((s) => s.renameCategory);
  const transactions = useFinance((s) => s.transactions);

  const [draft, setDraft] = useState<Record<string, SpendGroup>>(settings.groups);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<{
    name: string;
    txnCount: number;
    fallback: string;
  } | null>(null);

  const limits = new Map(budgets.map((b) => [b.category, b.limit]));

  const set = (category: string, group: SpendGroup) =>
    setDraft((d) => {
      const next = { ...d };
      // Storing only the departures keeps a later change to the defaults from
      // being shadowed by a value that was never deliberately chosen.
      if ((DEFAULT_SPEND_GROUPS[category] ?? "discretionary") === group) {
        delete next[category];
      } else {
        next[category] = group;
      }
      return next;
    });

  const saveLimit = (category: string, raw: string) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return;
    // Zero is how a budget is removed: a category with a limit of nothing is a
    // category you are not budgeting, not one you must spend nothing on.
    if (v <= 0) deleteBudget(category);
    else setBudget(category, Math.round(v * 100) / 100);
  };

  const saveRename = () => {
    if (!renaming) return;
    const n = draftName.trim();
    if (!n) return setError("A category needs a name.");
    if (n.toLowerCase() !== renaming.toLowerCase()) {
      if (categories.some((c) => c.toLowerCase() === n.toLowerCase())) {
        return setError(`“${n}” already exists.`);
      }
      renameCategory(renaming, n);
    }
    setRenaming(null);
    setError("");
  };

  const add = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return setError("Enter a name first.");
    if (!addCategory(n)) return setError(`“${n}” already exists.`);
    setNewName("");
    setError("");
  };

  return (
    <Modal open onClose={onClose} title="Categories" size="xl">
      <p className="mb-4 text-xs leading-relaxed text-ink-faint">
        A <strong className="text-ink-dim">need</strong> arrives whether or not
        the month went well. Anything marked{" "}
        <strong className="text-ink-dim">neither</strong> is left out of every
        total on this page — debt repayment belongs there, since it moves money
        between your own sides of the ledger rather than spending it. A{" "}
        <strong className="text-ink-dim">budget</strong> is what you mean to
        keep the category under in a month; leave it empty for the ones you are
        not budgeting.
      </p>

      <div className="max-h-[26rem] overflow-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-[0.625rem] uppercase tracking-wider text-ink-faint">
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Budget</th>
              <th className="w-16 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {[...categories].sort().map((c) => (
              <tr key={c} className="border-b border-line/40 last:border-0">
                <td className="px-3 py-1.5">
                  {renaming === c ? (
                    <span className="flex items-center gap-1.5">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename();
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        autoFocus
                        className="h-7 w-40 py-0 text-[0.8125rem]"
                        aria-label={`Rename ${c}`}
                      />
                      <Button variant="ghost" size="sm" onClick={saveRename}>
                        Save
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(c);
                        setDraftName(c);
                        setError("");
                      }}
                      className="text-left hover:text-brand"
                      title="Rename"
                    >
                      {c}
                    </button>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <Segmented<SpendGroup>
                    options={[
                      { value: "necessity", label: "Need" },
                      { value: "discretionary", label: "Choice" },
                      { value: "excluded", label: "Neither" },
                    ]}
                    value={groupOf(c, draft)}
                    onChange={(g) => set(c, g)}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={limits.get(c) ? String(limits.get(c)) : ""}
                    onBlur={(e) => saveLimit(c, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="h-7 w-24 py-0 text-right text-[0.8125rem] tabular-nums"
                    aria-label={`Monthly budget for ${c}`}
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${c}`}
                    className="hover:text-negative"
                    onClick={() => {
                      const rest = categories.filter((x) => x !== c);
                      setDeleting({
                        name: c,
                        txnCount: transactions.filter((t) => t.category === c).length,
                        fallback: rest.includes("Other") ? "Other" : (rest[0] ?? "nowhere"),
                      });
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="mt-3 flex items-center gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add a category"
          className="h-8 max-w-56"
          aria-label="New category name"
        />
        <Button type="submit" variant="secondary" size="sm">
          <Plus size={14} /> Add
        </Button>
        {error && <span className="text-xs text-negative">{error}</span>}
      </form>

      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onSave({ ...settings, groups: draft });
            onClose();
          }}
        >
          Save
        </Button>
      </div>

      {/*
        * Renames, limits and deletions save as you make them — they are store
        * writes with their own confirmation. Only the need/choice grouping is
        * a draft, because it is one setting held as a whole.
        */}
      {deleting && (
        <DeleteCategoryModal
          {...deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}

function DeleteCategoryModal({
  name,
  txnCount,
  fallback,
  onClose,
}: {
  name: string;
  txnCount: number;
  fallback: string;
  onClose: () => void;
}) {
  const deleteCategory = useFinance((s) => s.deleteCategory);
  return (
    <Modal open onClose={onClose} title="Delete category">
      <p className="text-sm leading-relaxed text-ink-dim">
        Delete <strong className="text-ink">{name}</strong>?
        {txnCount > 0 ? (
          <>
            {" "}
            Its {txnCount} transaction{txnCount === 1 ? "" : "s"} will move to{" "}
            <strong className="text-ink">{fallback}</strong> — nothing is lost,
            it is filed elsewhere.
          </>
        ) : (
          " Nothing is filed under it."
        )}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            deleteCategory(name);
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}

function CarModal({
  onClose,
  categories,
  months,
  settings,
  onSave,
}: {
  onClose: () => void;
  categories: string[];
  months: string[];
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const fallback = months[0] ?? "";
  const [start, setStart] = useState(settings.car?.start ?? fallback);
  const [picked, setPicked] = useState<string[]>(
    () =>
      settings.car?.categories ??
      ["Transport", "Insurance"].filter((c) => categories.includes(c)),
  );

  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  return (
    <Modal open onClose={onClose} title="What the car costs">
      <div className="space-y-4">
        <Field
          label="Owned since"
          hint="Every month from here on is counted, including the quiet ones."
        >
          <Select value={start} onChange={(e) => setStart(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {labelMonth(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Categories that belong to it"
          hint="Fuel, maintenance, insurance and parking, wherever you file them."
        >
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[...categories].sort().map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                  picked.includes(c)
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-line text-ink-faint hover:text-ink-dim",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
          If the car shares a category with anything else — a transit pass under
          Transport, say — this figure carries that too. Splitting it out means
          giving the car its own category.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {settings.car && (
          <Button
            variant="ghost"
            onClick={() => {
              onSave({ ...settings, car: null });
              onClose();
            }}
          >
            Remove
          </Button>
        )}
        <Button
          disabled={picked.length === 0 || !start}
          onClick={() => {
            onSave({ ...settings, car: { start, categories: picked } });
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
