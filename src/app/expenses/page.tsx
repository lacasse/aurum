"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  Car,
  MousePointerClick,
  Plus,
  Receipt,
  Settings2,
  Award,
  Trash2,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
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
import { PageSkeleton, useReady, useRemembered } from "@/lib/hooks";
import { yearToDate } from "@/lib/spans";
import {
  DEFAULT_SPEND_GROUPS,
  SPEND_GROUP_LABEL_ONE,
  categoryRows,
  expenseMonths,
  groupOf,
  latestExpenseMonth,
  monthSummary,
  monthlySpend,
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
  labelDate,
  labelMonth,
  monthKeyOf,
} from "@/lib/format";
import type { Budget, Transaction } from "@/lib/types";
import { getSettings, saveSettings } from "@/lib/api";
import {
  budgetHistory,
  budgetStreak,
  categoryStreak,
  averageBudgets,
  effectiveLimits,
  judgedMonths,
  personalBests,
  type BudgetMonth,
} from "@/lib/budget-habits";

interface Settings {
  groups: Record<string, SpendGroup>;
  car: {
    start: string;
    categories: string[];
    price?: number | null;
    estimate?: number | null;
  } | null;
  carHidden?: boolean;
  /** Budgets follow each category's 12-month average instead of a set figure. */
  autoBudget?: boolean;
}

const EMPTY: Settings = { groups: {}, car: null, carHidden: false, autoBudget: false };

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
  /* Simple or detailed categories card, remembered per browser. */
  const [categoryView, chooseCategoryView] = useRemembered<CategoryView>(
    "aurum.expenses.categories.view",
    "simple",
    ["simple", "detailed"],
  );
  const [window, setWindow] = useRemembered<"ytd" | "12" | "24" | "60">(
    "aurum.span.expenses",
    "24",
    ["ytd", "12", "24", "60"],
  );
  const [editing, setEditing] = useState<"groups" | "car" | null>(null);
  /* The one category whose expenses are open, in either view of the card. */
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const toggleCategory = (c: string) => setOpenCategory((o) => (o === c ? null : c));
  /* Which category's budget is being typed into, in the table below. */
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const setBudget = useFinance((s) => s.setBudget);
  const deleteBudget = useFinance((s) => s.deleteBudget);

  useEffect(() => {
    let cancelled = false;
    getSettings<Settings>("/api/expense-settings")
      .then((s) => {
        if (!cancelled) {
          setSettings({
            groups: s.groups ?? {},
            car: s.car ?? null,
            carHidden: s.carHidden ?? false,
            autoBudget: s.autoBudget ?? false,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings("/api/expense-settings", next).catch(() => {});
  }, []);

  const months = useMemo(() => expenseMonths(transactions), [transactions]);
  /*
   * Where the page opens. The rule is `latestExpenseMonth`, not a line of its
   * own: this used to take the last month in the list, which is the same answer
   * only until a recurring rule fires on the 1st and the month in progress
   * becomes the newest month "with spending in it".
   */
  const latest = useMemo(() => latestExpenseMonth(transactions), [transactions]);
  const selected = month && months.includes(month) ? month : latest;

  const data = useMemo(() => {
    if (!selected) return null;
    const g = settings.groups;
    /*
     * How far the record is worth reading: the month the page opens on, or a
     * later one if that is what was asked for. Everything after it is a month
     * still in progress, which holds a few days of spending and so draws as a
     * cliff at the right-hand edge of every chart while dragging the rolling
     * average and the rankings down with it.
     */
    const readThrough = latest && selected < latest ? latest : selected;
    const series = monthlySpend(transactions, g, readThrough);
    const avg = rollingAverage(series.map((m) => m.total), 12);
    const trend = series.map((m, i) => ({ ...m, average: avg[i] ?? undefined }));
    const rows = categoryRows(transactions, selected, g);
    const summary = monthSummary(transactions, selected, g, 12, readThrough);
    const car = settings.car
      ? runningCost(
          transactions,
          settings.car.categories,
          settings.car.start,
          latest ?? selected,
          settings.car.estimate && months[0]
            ? { recordedFrom: months[0], perMonth: settings.car.estimate }
            : undefined,
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
    const limits = effectiveLimits(
      budgets,
      settings.autoBudget === true,
      transactions,
      g,
      currentMonthKey(),
    );
    const budgeted = [...limits.values()].reduce((sum, v) => sum + v, 0);
    const againstPlan = rows
      .filter((r) => limits.has(r.category))
      .reduce((sum, r) => sum + r.amount, 0);

    /*
     * The finished months up to the one being read, each against today's
     * budgets: the streak in the main card, and the row of dots per category.
     */
    const now = currentMonthKey();
    const history = budgetHistory(
      transactions,
      limits,
      judgedMonths(months, selected, now),
    );

    const expensesOf = new Map<string, Transaction[]>();
    for (const t of transactions) {
      if (t.type !== "expense" || monthKeyOf(t.date) !== selected) continue;
      const list = expensesOf.get(t.category) ?? [];
      list.push(t);
      expensesOf.set(t.category, list);
    }
    for (const list of expensesOf.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
    }

    return {
      limits,
      history,
      expensesOf,
      streak: budgetStreak(history),
      bests: personalBests(transactions, selected, g),
      budgeted,
      againstPlan,
      trend,
      rows,
      summary,
      car,
      donut: spent.map((r) => ({ name: r.category, value: r.amount })),
      // Neither need nor want: drawn in the ring, outside the total.
      neither: rows
        .filter((r) => r.amount > 0 && r.group === "excluded")
        .map((r) => ({ name: r.category, value: r.amount })),
      movers: [...rows]
        .filter((r) => r.group !== "excluded" && Math.abs(r.delta) >= 1)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 6),
    };
  }, [transactions, budgets, settings, selected, latest, months]);

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

  const { summary, car } = data;

  // Spending is a flow, so the year to date is this year's own months.
  const trend =
    window === "ytd"
      ? yearToDate(data.trend, (m) => m.key, { withBase: false })
      : data.trend.slice(-Number(window));

  const inProgress = selected === currentMonthKey();
  const consumption = summary.necessity + summary.discretionary;
  // The bar holds all three; the headline above it counts only needs and wants.
  const barTotal = consumption + summary.excluded;
  const shareOf = (v: number) => (barTotal > 0 ? (v / barTotal) * 100 : 0);
  /*
   * The twelve months the bars show. Anchored to the end of the record, so
   * choosing a month moves the highlight rather than the row; only a month
   * older than the row shifts it back far enough to include it.
   */
  const end = data.trend.findIndex((m) => m.key === selected);
  const last = data.trend.length - 1;
  const upTo = end === -1 || end > last - 12 ? last : end;
  const recent = data.trend.slice(Math.max(0, upTo - 11), upTo + 1);
  // The average of the bars themselves, so it moves only if the row does.
  const recentAverage =
    recent.length > 0 ? recent.reduce((sum, m) => sum + m.total, 0) / recent.length : null;
  const recentMax = Math.max(1, ...recent.map((m) => m.total));
  /*
   * The same ring for the twelve months the bars show: each category's spend
   * over those months, divided by twelve (or however many there are). It is
   * the 12-month average split by category, so its centre matches the line.
   */
  const moverScale = Math.max(1, ...data.movers.map((r) => Math.abs(r.delta)));
  const moreThan = data.movers.filter((r) => r.delta > 0);
  const lessThan = data.movers.filter((r) => r.delta < 0);
  const recentKeys = new Set(recent.map((m) => m.key));
  const averageBy = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "expense" || !recentKeys.has(monthKeyOf(t.date))) continue;
    averageBy.set(t.category, (averageBy.get(t.category) ?? 0) + t.amount);
  }
  const averageDonut = [...averageBy]
    .map(([name, total]) => ({ name, value: Math.round((total / Math.max(1, recent.length)) * 100) / 100 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  // One colour per category across both rings and the table, this month's order first.
  /*
   * Each ring runs the standard gradient in its own order, largest slice
   * first, Neither included — so the colours step smoothly round the ring
   * rather than one category's colour being fixed across both. The table
   * further down takes this month's colours.
   */
  const monthRing = [...data.donut, ...data.neither].sort((a, b) => b.value - a.value);
  const colors = categoryColors(monthRing.map((d) => d.name));
  const averageColors = categoryColors(averageDonut.map((d) => d.name));
  // The main card compares with the same average the bars draw.
  const vsAverage =
    recentAverage !== null && recentAverage > 0
      ? ((summary.total - recentAverage) / recentAverage) * 100
      : null;

  return (
    <Shell
      title="Expenses"
      subtitle={`What ${labelMonth(selected)} cost, and whether that was normal`}
      action={
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setEditing("groups")}
            aria-label="Edit categories, their kind and their budgets"
          >
            <Settings2 size={14} />
            Edit categories
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
        {/*
          * The month first, the way the investments page opens: what it cost
          * and whether that was normal, then the year it sits in, then what
          * made it different. Every question after this row is the working.
          */}
        <div className="grid gap-4 lg:grid-cols-4">
          <Card className="p-5 sm:p-6 lg:col-span-2">
            <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-dim">
              <CalendarDays size={14} className="text-ink-faint" />
              {inProgress ? `${labelMonth(selected)} so far` : `Spent in ${labelMonth(selected)}`}
              {inProgress && <Badge>In progress</Badge>}
            </p>
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {fmtCAD(summary.total)}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-dim">
              {vsAverage !== null ? (
                <>
                  <Badge tone={vsAverage > 0 ? "negative" : "positive"}>
                    {vsAverage > 0 ? "▲" : "▼"} {Math.abs(vsAverage).toFixed(0)}%
                  </Badge>
                  <span>
                    {vsAverage > 0 ? "above" : "below"} the 12-month average of{" "}
                    <span className="tabular-nums text-ink">{fmtCAD(recentAverage!)}</span>
                  </span>
                </>
              ) : (
                <span>Not enough months on record to say what is usual yet.</span>
              )}
            </p>

            {/*
              * How the month split: what arrived regardless (need), what was
              * chosen (want), and in grey what was neither — debt repayment
              * and the like, shown here but outside the total above. The same
              * colours as the chart further down.
              */}
            {barTotal > 0 && (
              <div className="mt-5">
                <div
                  className="flex h-2 gap-0.5 overflow-hidden rounded-full"
                  role="img"
                  aria-label={`${fmtCAD(summary.necessity)} on needs, ${fmtCAD(summary.discretionary)} on wants, ${fmtCAD(summary.excluded)} neither`}
                >
                  {[
                    { v: summary.necessity, c: NEED },
                    { v: summary.discretionary, c: WANT },
                    { v: summary.excluded, c: NEITHER },
                  ]
                    .filter((p) => p.v > 0)
                    .map((p, i, all) => (
                      <span
                        key={p.c}
                        className={cn(i === 0 && "rounded-l-full", i === all.length - 1 && "rounded-r-full")}
                        style={{ width: `${shareOf(p.v)}%`, background: p.c }}
                      />
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
                  <SplitLabel color={NEED} label="Needs" value={summary.necessity} share={shareOf(summary.necessity)} />
                  <SplitLabel color={WANT} label="Wants" value={summary.discretionary} share={shareOf(summary.discretionary)} />
                  {summary.excluded > 0 && (
                    <span title="Neither need nor want, such as debt repayment. Shown, but not counted in the total above.">
                      <SplitLabel color={NEITHER} label="Neither" value={summary.excluded} share={shareOf(summary.excluded)} />
                    </span>
                  )}
                </div>
              </div>
            )}

            <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
              <Fact
                label="Last month"
                value={summary.previous !== null ? fmtCAD(summary.previous) : "—"}
              />
              <Fact
                label="Last year"
                value={summary.lastYear !== null ? fmtCAD(summary.lastYear) : "—"}
                title="The same month a year earlier"
              />
              {/* Every month under budget in a row adds one; a month over ends it. */}
              <Fact
                label="Budget streak"
                value={
                  data.limits.size === 0 || data.streak.judged === 0
                    ? "—"
                    : `${data.streak.run} month${data.streak.run === 1 ? "" : "s"}`
                }
                title="Finished months in a row where the budgeted categories stayed within budget, judged against today's budgets. A month over ends the streak."
              />
            </dl>
          </Card>

          {/*
            * The year the month sits in. Each bar is a month and selects it;
            * the dashed line is the average of the twelve bars shown.
            */}
          <Card className="flex flex-col p-5 sm:p-6">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-ink-dim">The last 12 months</span>
              {/* Says the bars are buttons, where they are. */}
              <span className="flex items-center gap-1 text-[0.625rem] text-ink-faint">
                <MousePointerClick size={11} aria-hidden />
                Pick a month
              </span>
            </div>
            <div className="relative mt-4 flex min-h-[150px] flex-1 items-end gap-1">
              {recentAverage !== null && (
                <span
                  className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-ink-dim"
                  style={{ bottom: `${(recentAverage / recentMax) * 100}%` }}
                  aria-hidden
                />
              )}
              {recent.map((m, i) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => months.includes(m.key) && setMonth(m.key)}
                  aria-label={`${labelMonth(m.key)}: ${fmtCAD(m.total)}`}
                  className="group relative flex h-full flex-1 cursor-pointer items-end focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "w-full rounded-t-[4px] transition-colors",
                      m.key === selected
                        ? "bg-brand-strong"
                        : "bg-ink-faint/30 group-hover:bg-ink-faint/60 group-focus-visible:bg-ink-faint/60",
                    )}
                    style={{ height: `${Math.max(2, (m.total / recentMax) * 100)}%` }}
                  />
                  {/* The value, above the bar, while it is pointed at. */}
                  <span
                    className={cn(
                      "pointer-events-none absolute z-10 mb-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-left opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                      i < 3 ? "left-0" : i > recent.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                    style={{ bottom: `${Math.max(2, (m.total / recentMax) * 100)}%` }}
                  >
                    <span className="block text-[0.625rem] text-ink-faint">{labelMonth(m.key)}</span>
                    <span className="block text-xs font-semibold tabular-nums text-ink">
                      {fmtCAD(m.total)}
                    </span>
                    {m.key !== selected && (
                      <span className="mt-0.5 block text-[0.625rem] text-brand">Click to view</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex gap-1 text-center text-[0.5625rem] text-ink-faint">
              {recent.map((m) => (
                <span key={m.key} className={cn("flex-1", m.key === selected && "font-semibold text-ink")}>
                  {labelMonth(m.key).slice(0, 1)}
                </span>
              ))}
            </div>
            <p className="mt-3 flex items-center gap-1.5 whitespace-nowrap text-[0.6875rem] text-ink-faint">
              <span className="w-3 shrink-0 border-t border-dashed border-ink-dim" /> 12-month average
              {recentAverage !== null && (
                <span className="tabular-nums text-ink-dim">{fmtCAD(recentAverage)}</span>
              )}
            </p>
          </Card>

          {/*
            * What made this month different from usual, in dollars: the
            * categories furthest from their own average, either way.
            */}
          <Card className="p-5 sm:p-6">
            <span className="text-xs font-medium text-ink-dim">Big changes</span>
            {data.movers.length === 0 ? (
              <p className="mt-6 text-xs text-ink-faint">
                Every category came in close to its usual amount.
              </p>
            ) : (
              <div className="-mx-1.5 mt-3 space-y-0.5">
                {moreThan.length > 0 && <MoverHeading>More than usual</MoverHeading>}
                {moreThan.map((r) => (
                  <MoverRow key={r.category} name={r.category} delta={r.delta} scale={moverScale} />
                ))}
                {lessThan.length > 0 && <MoverHeading>Less than usual</MoverHeading>}
                {lessThan.map((r) => (
                  <MoverRow key={r.category} name={r.category} delta={r.delta} scale={moverScale} />
                ))}
              </div>
            )}
          </Card>

        </div>

        <Chapter title="Where it went" note={labelMonth(selected)} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title={`${labelMonth(selected)} by category`}
              subtitle="Neither is shown, but outside the total"
            />
            <div className="px-4 pb-4">
              {data.donut.length > 0 ? (
                <DonutChart
                  data={monthRing}
                  colors={colors}
                  centerValue={fmtCAD(summary.total)}
                  fitCenter
                  fmt={(n) => fmtCAD(n)}
                  height={260}
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
              title="12-month average by category"
              subtitle={
                recent.length > 0
                  ? `${labelMonth(recent[0].key)} to ${labelMonth(recent[recent.length - 1].key)} · neither outside the total`
                  : undefined
              }
            />
            <div className="px-4 pb-4">
              {averageDonut.length > 0 ? (
                <DonutChart
                  data={averageDonut}
                  colors={averageColors}
                  centerValue={fmtCAD(recentAverage ?? 0)}
                  fitCenter
                  fmt={(n) => fmtCAD(n)}
                  height={260}
                  legend="right"
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  Not enough months on record yet.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/*
          * One card for the categories, two ways of reading them — the same
          * arrangement as the holdings on the investments page. Simple is the
          * budget comparison: how the month stands against the plan. Detailed
          * is every category against its own history.
          */}
        {/*
          * One card for the categories, two ways of reading them — the same
          * arrangement as the holdings on the investments page. Simple is the
          * budget comparison: how the month stands against the plan. Detailed
          * is every category against its own history.
          */}
        <Card>
          <CardHeader
            title={categoryView === "simple" ? "Spending against budget" : "Every category in detail"}
            action={
              <Segmented<CategoryView>
                options={CATEGORY_VIEWS}
                value={categoryView}
                onChange={chooseCategoryView}
              />
            }
          />
          {categoryView === "simple" ? (
            data.budgeted > 0 ? (
              <BudgetSummary
                month={selected}
                rows={data.rows}
                limits={data.limits}
                history={data.history}
                categories={categories}
                groups={settings.groups}
                open={openCategory}
                onToggle={toggleCategory}
                expensesOf={data.expensesOf}
                bests={new Map(data.bests.map((b) => [b.category, b.months]))}
              />
            ) : (
              <p className="px-5 pb-8 pt-4 text-center text-xs text-ink-faint">
                No budgets set yet. Use Edit categories above to give a category
                a monthly budget, or switch to Detailed for every category.
              </p>
            )
          ) : (
          <>
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
                  <th className="w-28 px-3 py-2 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Fragment key={r.category}>
                  <tr
                    className={cn(
                      "cursor-pointer border-t border-line/60 hover:bg-elevated",
                      openCategory === r.category && "bg-elevated/60",
                    )}
                    onClick={() => toggleCategory(r.category)}
                    aria-expanded={openCategory === r.category}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <ChevronRight
                          size={13}
                          className={cn(
                            "shrink-0 text-ink-faint transition-transform",
                            openCategory === r.category && "rotate-90",
                          )}
                          aria-hidden
                        />
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: colors[r.category] ?? "var(--ink-faint)",
                          }}
                        />
                        {r.category}
                        {data.bests.some((b) => b.category === r.category) && (
                          <span
                            className="inline-flex items-center gap-1 text-[0.6875rem] font-normal text-brand"
                            title="This category's cheapest month in a while"
                          >
                            <Award size={14} aria-hidden />
                            Lowest in {data.bests.find((b) => b.category === r.category)!.months} months
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={GROUP_TONE[r.group]}>
                        {SPEND_GROUP_LABEL_ONE[r.group]}
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
                    <td
                      className="px-3 py-2 text-right tabular-nums"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                          onClick={() => !settings.autoBudget && setEditingLimit(r.category)}
                          disabled={settings.autoBudget === true}
                          className="inline-flex items-center justify-end gap-2 rounded px-1 hover:bg-elevated disabled:cursor-default disabled:hover:bg-transparent"
                          title={
                            settings.autoBudget
                              ? "Following the 12-month average. Change this in Edit categories."
                              : `Set a monthly budget for ${r.category}`
                          }
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
                    <td className="px-1 py-1">
                      <Sparkline
                        data={r.series}
                        dataKey="value"
                        color={colors[r.category] ?? "var(--ink-faint)"}
                        height={30}
                      />
                    </td>
                  </tr>
                  {openCategory === r.category && (
                    <tr className="bg-elevated/30">
                      <td colSpan={9} className="px-3 pb-3 pt-1">
                        <CategoryExpenses
                          category={r.category}
                          items={data.expensesOf.get(r.category) ?? []}
                          month={selected}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
          </>
          )}
        </Card>

        <Chapter title="Over time" />
        <Card>
          <CardHeader
            title="Spending month by month"
            subtitle="Needs, wants and neither, with the twelve-month average of needs and wants"
            action={
              <Segmented<string>
                options={[
                  { value: "ytd", label: "YTD" },
                  { value: "12", label: "1Y" },
                  { value: "24", label: "2Y" },
                  { value: "60", label: "5Y" },
                ]}
                value={window}
                onChange={(v) => setWindow(v as "ytd" | "12" | "24" | "60")}
              />
            }
          />
          <div className="px-3 pb-4">
            <SeriesChart
              data={trend as unknown as Record<string, unknown>[]}
              xKey="label"
              stacked
              series={[
                { key: "necessity", name: "Needs", color: NEED },
                { key: "discretionary", name: "Wants", color: WANT },
                { key: "excluded", name: "Neither", color: NEITHER },
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
                  { label: "Needs", color: NEED },
                  { label: "Wants", color: WANT },
                  { label: "Neither", color: NEITHER },
                  { label: "12-month average of needs and wants", color: "#f59e0b" },
                ]}
              />
            </div>
          </div>
          <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
            Neither — debt repayment and the like — is shown in grey but left
            out of every total on this page: it moves money between your own
            accounts rather than spending it.
          </p>
        </Card>

        {!settings.carHidden && (
          <>
        <Chapter title="Things you own" />
        {/*
          * The cost of a thing you own, rather than of a month: what it cost
          * to buy, and what it has cost to run in every month since, quiet
          * ones included. Months before the record began are the owner's own
          * estimate, and the card says so.
          */}
        <Card>
          <CardHeader
            title="What the car costs"
            subtitle={
              settings.car
                ? `${settings.car.categories.join(", ")} since ${labelMonth(settings.car.start)}`
                : "What it cost to buy, and what it costs to run"
            }
            action={
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing("car")}>
                  <Settings2 size={14} /> {settings.car ? "Change" : "Set up"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Hide this card"
                  title="Hide this card. Bring it back from Settings."
                  onClick={() => save({ ...settings, carHidden: true })}
                >
                  <X size={14} />
                </Button>
              </div>
            }
          />
          {car && car.months > 0 ? (
            (() => {
              const price = settings.car?.price ?? 0;
              const owned = price + car.total;
              return (
                <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[repeat(4,minmax(0,1fr))_2fr]">
                  <Figure
                    label="To run, per month"
                    value={fmtCAD(car.perMonth)}
                    note={`over ${car.months} months of ownership`}
                    strong
                  />
                  {price > 0 ? (
                    <Figure
                      label="All in, per month"
                      value={fmtCAD(owned / car.months)}
                      note="with the purchase spread over those months"
                    />
                  ) : (
                    <Figure label="Per year" value={fmtCAD(car.perYear)} note="at that rate" />
                  )}
                  <Figure
                    label={price > 0 ? "Cost of owning it" : "Total"}
                    value={fmtCAD(owned)}
                    note={
                      price > 0
                        ? `${fmtCAD(price)} to buy, ${fmtCAD(car.total)} to run`
                        : `since ${labelMonth(settings.car!.start)}`
                    }
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
              );
            })()
          ) : (
            <div className="px-5 pb-5">
              <EmptyState
                icon={<Car size={20} />}
                title={settings.car ? "Nothing in those categories yet" : "Not set up"}
                subtitle="Tell it when you got the car, what you paid, and which categories its costs land in."
              />
            </div>
          )}
          {car && car.months > 0 && (
            <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
              Divided by every month of ownership, including the quiet ones — a
              car costs what it costs in the months it is not filled up.
              {car.estimatedMonths > 0 &&
                ` The ${car.estimatedMonths} months before your records begin are counted at your estimate of ${fmtCAD(settings.car!.estimate ?? 0)} a month.`}
              {!settings.car?.price && " Add what you paid for it to include the purchase."}
            </p>
          )}
        </Card>
          </>
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

const NEED = "#8b5cf6";
const WANT = "#34d399";
/** Neither need nor want — debt repayment and the like: shown, in grey, but never totalled. */
const NEITHER = "#71717a";

/** A heading between the groups of a list, in the page's quietest voice. */
function Chapter({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 px-1 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-dim">{title}</h2>
      {note ? <span className="text-[0.6875rem] text-ink-faint">{note}</span> : null}
    </div>
  );
}

function Fact({
  label,
  value,
  note,
  title,
}: {
  label: string;
  value: string;
  note?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-semibold tabular-nums">{value}</dd>
      {note ? <dd className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">{note}</dd> : null}
    </div>
  );
}

/** One dot per month: filled when the category kept to its budget, hollow when it did not. */
function MonthDots({ category, months }: { category: string; months: BudgetMonth[] }) {
  const dots = categoryStreak(months, category);
  if (dots.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {dots.map((c) => {
        return (
          <span
            key={c.key}
            data-under={c.under}
            title={`${labelMonth(c.key)}: ${fmtCAD(c.spent)} of ${fmtCAD(c.limit)}`}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              !c.under && "border border-negative",
            )}
            style={c.under ? { background: "var(--positive)", opacity: 0.75 } : undefined}
          />
        );
      })}
    </span>
  );
}

function SplitLabel({
  color,
  label,
  value,
  share,
}: {
  color: string;
  label: string;
  value: number;
  share: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-ink-dim">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
      <span className="font-medium tabular-nums text-ink">{fmtCAD(value)}</span>
      <span className="tabular-nums text-ink-faint">{share.toFixed(0)}%</span>
    </span>
  );
}

function MoverHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 pb-0.5 pt-2 text-[0.625rem] uppercase tracking-wider text-ink-faint first:pt-0">
      {children}
    </div>
  );
}

/** A category's distance from its usual month, drawn over a bar of that size. */
function MoverRow({ name, delta, scale }: { name: string; delta: number; scale: number }) {
  return (
    <div className="relative flex items-baseline gap-2 rounded px-1.5 py-1">
      <span
        className="absolute inset-y-0 left-0 rounded bg-elevated"
        style={{ width: `${Math.max(2, (Math.abs(delta) / scale) * 100)}%` }}
        aria-hidden
      />
      <span className="relative min-w-0 flex-1 truncate text-[0.6875rem] text-ink-dim">{name}</span>
      <span
        className={cn(
          "relative shrink-0 text-[0.6875rem] font-medium tabular-nums",
          delta > 0 ? "text-negative" : "text-positive",
        )}
      >
        {fmtSignedCAD(delta)}
      </span>
    </div>
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

  /*
   * Budgets can follow each category's 12-month average instead of a set
   * figure, recomputed as months finish. While they do, the boxes show the
   * average and cannot be typed in. Turning it off writes the averages in as
   * ordinary budgets, so nothing moves at the moment it is switched off.
   */
  const auto = settings.autoBudget === true;
  const averages = useMemo(
    () => averageBudgets(transactions, draft, currentMonthKey()),
    [transactions, draft],
  );
  const limits = auto ? averages : new Map(budgets.map((b) => [b.category, b.limit]));
  const setAuto = (on: boolean) => {
    if (!on) {
      for (const [c, v] of averages) if (categories.includes(c)) setBudget(c, v);
    }
    onSave({ ...settings, autoBudget: on });
  };

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
        the month went well; a <strong className="text-ink-dim">want</strong> is
        chosen one purchase at a time. Anything marked{" "}
        <strong className="text-ink-dim">neither</strong> is shown in the charts but
        left out of every total on this page — debt repayment belongs there, since it moves money
        between your own sides of the ledger rather than spending it. A{" "}
        <strong className="text-ink-dim">budget</strong> is what you mean to
        keep the category under in a month; leave it empty for the ones you are
        not budgeting.
      </p>

      <label className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3">
        <span>
          <span className="block text-sm font-medium">Keep budgets at the 12-month average</span>
          <span className="block text-xs text-ink-faint">
            {auto
              ? "Each budget is what the category cost a month over the last 12 finished months, and updates as each month ends. Turning it off keeps today's figures."
              : "Set every budget to what the category cost a month over the last 12 finished months, and keep it updated as each month ends."}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          disabled={averages.size === 0}
          onClick={() => setAuto(!auto)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0 transition-colors disabled:opacity-50",
            auto ? "bg-brand" : "bg-elevated ring-1 ring-inset ring-line",
          )}
        >
          <span
            className={cn(
              "absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
              auto ? "translate-x-[1.125rem]" : "translate-x-0.5",
            )}
          />
          <span className="sr-only">Keep budgets at the 12-month average</span>
        </button>
      </label>

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
                      { value: "necessity", label: SPEND_GROUP_LABEL_ONE.necessity },
                      { value: "discretionary", label: SPEND_GROUP_LABEL_ONE.discretionary },
                      { value: "excluded", label: SPEND_GROUP_LABEL_ONE.excluded },
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
                    // Keyed on the value, so a budget set from elsewhere — the
                    // button above — shows here at once.
                    key={`${c}:${auto}:${limits.get(c) ?? ""}`}
                    defaultValue={limits.get(c) ? String(limits.get(c)) : ""}
                    disabled={auto}
                    title={auto ? "Following the 12-month average" : undefined}
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
        * writes with their own confirmation. Only the need/want grouping is
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
  const firstRecorded = months[0] ?? currentMonthKey();
  const [start, setStart] = useState(settings.car?.start ?? firstRecorded);
  const [picked, setPicked] = useState<string[]>(
    () =>
      settings.car?.categories ??
      ["Transport", "Insurance"].filter((c) => categories.includes(c)),
  );
  const [price, setPrice] = useState(settings.car?.price ? String(settings.car.price) : "");
  const [estimate, setEstimate] = useState(
    settings.car?.estimate ? String(settings.car.estimate) : "",
  );

  const toggle = (c: string) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  /*
   * A car bought before the first month on record has months with nothing to
   * count. Only then is the monthly estimate asked for, and it is used only
   * for those months: from the first record on, the real figures take over.
   */
  const validStart = /^\d{4}-\d{2}$/.test(start) && start <= currentMonthKey();
  const before = validStart && start < firstRecorded;
  const gap = before ? monthsBetween(start, firstRecorded) : 0;
  const amount = (v: string) => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };

  return (
    <Modal open onClose={onClose} title="What the car costs">
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-elevated/50 p-3 text-xs leading-relaxed text-ink-dim">
          <p className="font-medium text-ink">For this to be accurate, it needs:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>The month you got the car, so every month since is counted.</li>
            <li>
              The categories its costs land in, holding only the car&rsquo;s costs. If
              one is shared — a transit pass under Transport, say — give the car a
              category of its own.
            </li>
            <li>What you paid for it, so the total is the cost of owning it.</li>
            <li>
              If you got it before your records begin, what it usually cost a month,
              to fill in the months with nothing recorded.
            </li>
          </ul>
          <p className="mt-1.5 text-ink-faint">
            Loan payments are left out: they are debt repayment, and the price
            already counts the car once.
          </p>
        </div>

        <Field label="Owned since" hint="Every month from here on is counted, including the quiet ones.">
          <Input
            type="month"
            value={start}
            max={currentMonthKey()}
            onChange={(e) => setStart(e.target.value)}
          />
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

        <Field label="What you paid for it" hint="Optional. Leave it empty to count running costs only.">
          <Input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            placeholder="—"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>

        {before && (
          <Field
            label={`A month's running cost before ${labelMonth(firstRecorded)}`}
            hint={`Your records begin in ${labelMonth(firstRecorded)}, so the ${gap} month${gap === 1 ? "" : "s"} before have nothing to count. Enter what the car usually cost a month — fuel, insurance and upkeep together. Without it, those months count as nothing.`}
          >
            <Input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              placeholder="—"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
            />
          </Field>
        )}
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
          disabled={picked.length === 0 || !validStart}
          onClick={() => {
            onSave({
              ...settings,
              car: {
                start,
                categories: picked,
                price: amount(price),
                estimate: before ? amount(estimate) : null,
              },
            });
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

/** Whole months from `from` up to, but not including, `to` (both YYYY-MM). */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/* ---------------- Budget comparison ---------------- */

type CategoryView = "simple" | "detailed";
const CATEGORY_VIEWS: { value: CategoryView; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "detailed", label: "Detailed" },
];

/**
 * The month read against the plan: one total, then each budgeted category on
 * its own bar, the ones that broke their limit first. While the month is still
 * running, a tick on every bar marks where an even pace would be by today, so
 * "ahead of plan" reads before it becomes "over".
 */
/** Name, the six months centred, spent of budget: equal sides, so both lists line up. */
const COLUMNS = "minmax(0,1fr) auto minmax(0,1fr)";

function BudgetSummary({
  month,
  rows,
  limits,
  history,
  categories,
  groups,
  open,
  onToggle,
  expensesOf,
  bests,
}: {
  month: string;
  rows: ReturnType<typeof categoryRows>;
  limits: Map<string, number>;
  history: BudgetMonth[];
  categories: string[];
  groups: Record<string, SpendGroup>;
  /** The category whose expenses are showing, and how to open or close one. */
  open: string | null;
  onToggle: (category: string) => void;
  expensesOf: Map<string, Transaction[]>;
  /** Categories having their cheapest month in a while, and how many months back. */
  bests: Map<string, number>;
}) {
  // The last six finished months, oldest first, for the dots on each line.
  const recentMonths = history.slice(-6);
  const spentBy = new Map(rows.map((r) => [r.category, r.amount]));
  const lines = [...limits]
    .map(([category, limit]) => {
      const spent = spentBy.get(category) ?? 0;
      return { category, limit, spent, used: limit > 0 ? spent / limit : 0 };
    })
    .sort((a, b) => b.used - a.used);
  /*
   * Spending in categories with no budget still counts toward the month, so
   * this card's total is the same as the one at the top of the page. Those
   * categories are drawn grey, since there is nothing to be over or under.
   */
  // Every category without a budget, spent in or not, largest first.
  const unbudgeted = [...new Set([...categories, ...rows.map((r) => r.category)])]
    .filter((c) => !limits.has(c) && groupOf(c, groups) !== "excluded")
    .map((c) => ({ category: c, limit: 0, spent: spentBy.get(c) ?? 0, used: 1, noBudget: true }))
    .sort((a, b) => b.spent - a.spent || a.category.localeCompare(b.category));

  const budgeted = lines.reduce((s, l) => s + l.limit, 0);
  // The headline compares like with like: budgeted spending against the budget.
  const spent = lines.reduce((s, l) => s + l.spent, 0);
  const outside = unbudgeted.reduce((s, l) => s + l.spent, 0);
  // A grey bar has no budget to fill, so it is drawn against the largest of them.
  const outsideMax = Math.max(1, ...unbudgeted.map((l) => l.spent));
  const used = budgeted > 0 ? spent / budgeted : 0;

  const running = month === currentMonthKey();
  const now = new Date();
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysLeftInMonth(now);
  const pace = running ? (daysIn - daysLeft + 1) / daysIn : null;

  /*
   * Green within budget, red over — at the same muted strength as the monthly
   * gain bars on the investments page, so neither shouts.
   */
  const fill = (u: number) => ({
    background: u > 1 ? "var(--negative)" : "var(--positive)",
    opacity: 0.75,
  });
  const pct = (u: number) => `${Math.min(100, u * 100)}%`;
  type Line = (typeof lines)[number] & { noBudget?: boolean };
  let overLines: Line[] = lines.filter((l) => l.spent > l.limit);
  let underLines: Line[] = lines.filter((l) => l.spent <= l.limit);
  // The grey lines go in whichever column is shorter, so the two stay balanced.
  if (overLines.length <= underLines.length) overLines = [...overLines, ...unbudgeted];
  else underLines = [...underLines, ...unbudgeted];


  const group = (title: string, items: Line[], empty: string) => (
    <section className="min-w-0">
      {/* Column headings, so the dots and figures explain themselves. */}
      <p className="mb-2 text-xs font-medium text-ink-dim">
        {title}{" "}
        <span className="tabular-nums text-ink-faint">
          · {items.filter((l) => !l.noBudget).length}
        </span>
      </p>
      <div
        className="grid items-baseline gap-x-3 border-b border-line/60 pb-2 text-[0.625rem] uppercase tracking-wider text-ink-faint"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Category</span>
        <span className="whitespace-nowrap text-center" title="The last six finished months, oldest first">
          {recentMonths.length > 0 ? "Monthly streak" : ""}
        </span>
        <span className="text-right">Spent of budget</span>
      </div>
      {items.filter((l) => !l.noBudget).length === 0 && (
        <p className="py-4 text-xs text-ink-faint">{empty}</p>
      )}
      {items.length === 0 ? null : (
        <ul className="mt-3 space-y-1.5">
          {items.map((l) => (
            <li key={l.category}>
              <button
                type="button"
                onClick={() => onToggle(l.category)}
                aria-expanded={open === l.category}
                className={cn(
                  "group -mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 pt-1 text-left focus-visible:outline-2 focus-visible:outline-brand",
                  // A personal best lights the whole line, bar and all.
                  bests.has(l.category)
                    ? "bg-brand/10 ring-1 ring-inset ring-brand/30 hover:bg-brand/15"
                    : "hover:bg-elevated/60",
                )}
              >
              {/*
                * A personal best is said only when it happens — a category's
                * cheapest month in a while — so it stays worth noticing.
                */}
              {bests.has(l.category) && (
                <span
                  className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-medium text-brand"
                  title={`This category's cheapest month in ${bests.get(l.category)} months`}
                >
                  <Award size={14} aria-hidden />
                  Lowest in {bests.get(l.category)} months
                </span>
              )}
              <div
                className="grid items-center gap-x-3 text-sm"
                style={{ gridTemplateColumns: COLUMNS }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <ChevronRight
                    size={13}
                    className={cn(
                      "shrink-0 text-ink-faint transition-transform group-hover:text-ink-dim",
                      open === l.category && "rotate-90",
                    )}
                    aria-hidden
                  />
                  <span className="truncate">{l.category}</span>
                </span>
                <span className="flex justify-center">
                  {!l.noBudget && <MonthDots category={l.category} months={recentMonths} />}
                </span>
                <span className="whitespace-nowrap text-right tabular-nums">
                  {fmtCAD(l.spent)}
                  <span className="text-ink-faint">
                    {l.noBudget ? " · no budget" : ` of ${fmtCAD(l.limit)}`}
                  </span>
                </span>
              </div>
              <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
                <div
                  className="h-full rounded-full"
                  style={
                    l.noBudget
                      ? { width: pct(l.spent / outsideMax), background: "var(--ink-faint)", opacity: 0.45 }
                      : { width: pct(l.used), ...fill(l.used) }
                  }
                />
                {pace !== null && !l.noBudget && (
                  <div
                    className="absolute inset-y-0 w-px bg-ink/50"
                    style={{ left: pct(pace) }}
                  />
                )}
              </div>
              {/*
                * Only what needs attention gets words: the overage. The line
                * is kept, empty, on the rest, so every row is the same height
                * and the bars line up across the two columns.
                */}
              <p className="mt-1 flex h-4 items-center justify-end text-[0.6875rem] tabular-nums">
                {!l.noBudget && l.spent > l.limit && (
                  <span className="text-negative">{fmtCAD(l.spent - l.limit)} over</span>
                )}
              </p>
              </button>
              {open === l.category && (
                <CategoryExpenses
                  category={l.category}
                  items={expensesOf.get(l.category) ?? []}
                  month={month}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="px-5 pb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">{fmtCAD(spent)}</span>
        <span className="text-sm text-ink-dim">
          spent against your {fmtCAD(budgeted)} budget
        </span>
        <span className="text-xs tabular-nums text-ink-faint">
          {Math.round(used * 100)}% used
        </span>
      </p>
      {outside > 0 && (
        <p className="text-xs text-ink-dim">
          <span className="tabular-nums text-ink">{fmtCAD(spent + outside)}</span> in total,
          including <span className="tabular-nums text-ink">{fmtCAD(outside)}</span> not in the
          budget
        </p>
      )}
      </div>

      <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: pct(used), ...fill(used) }}
        />
        {pace !== null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-ink/60"
            style={{ left: pct(pace) }}
            title="Where an even pace would be today"
          />
        )}
      </div>

      <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
        {group("Over budget", overLines, "Nothing over budget this month.")}
        {group("Within budget", underLines, "Every category went over.")}
      </div>

      <p className="mt-5 text-[0.6875rem] leading-relaxed text-ink-faint">
        {pace !== null &&
          "The thin line marks how far through the month today is. "}
        Months are judged against today&rsquo;s budgets.
      </p>
    </div>
  );
}


/**
 * Every expense behind a category's figure for the month, opened from either
 * view of the categories card. A month kept as one total per category shows
 * that single row, labelled as such, rather than pretending to be receipts.
 */
function CategoryExpenses({
  category,
  items,
  month,
}: {
  category: string;
  items: Transaction[];
  month: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /*
   * Opening a category near the bottom of the card would otherwise unfold its
   * list below the screen with nothing to say it happened. So on opening, the
   * page scrolls just enough to show the category and its list — or, when the
   * list is taller than the screen, brings the category to the top.
   */
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const row = panel.closest("tr")?.previousElementSibling ?? panel.previousElementSibling;
    const top = (row ?? panel).getBoundingClientRect().top;
    const bottom = panel.getBoundingClientRect().bottom;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
    if (bottom - top > window.innerHeight - 32) {
      (row ?? panel).scrollIntoView({ block: "start", behavior });
    } else if (bottom > window.innerHeight || top < 0) {
      panel.scrollIntoView({ block: "nearest", behavior });
    }
  }, []);

  if (items.length === 0) {
    return (
      <div
        ref={ref}
        className="mb-2 mt-1 rounded-lg bg-elevated/50 px-3 py-2.5 text-xs text-ink-faint"
      >
        Nothing recorded under {category} in {labelMonth(month)}.
      </div>
    );
  }
  const total = items.reduce((s, t) => s + t.amount, 0);
  return (
    <div ref={ref} className="mb-2 mt-1 scroll-mt-4 rounded-lg bg-elevated/50 px-3 py-2">
      <ul className="divide-y divide-line/50">
        {items.map((t) => (
          <li key={t.id} className="flex items-baseline gap-3 py-1.5 text-xs">
            <span className="w-20 shrink-0 tabular-nums text-ink-faint">
              {labelDate(t.date).replace(/, \d{4}$/, "")}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-dim">
              {t.payee || "—"}
              {t.granularity === "monthly" && (
                <span className="ml-1.5 text-ink-faint">· month total</span>
              )}
              {t.note ? <span className="ml-1.5 text-ink-faint">· {t.note}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-ink">{fmtCAD(t.amount)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t border-line pt-1.5 text-[0.6875rem] text-ink-faint">
        <span>
          {items.length} {items.length === 1 ? "expense" : "expenses"}
        </span>
        <span className="tabular-nums text-ink-dim">{fmtCAD(total)}</span>
      </p>
    </div>
  );
}
