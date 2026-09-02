"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Anchor,
  Car,
  Receipt,
  Settings2,
  ShoppingBag,
  TrendingDown,
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
import { fmtCAD, fmtCompact, fmtSignedCAD, labelMonth } from "@/lib/format";

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

  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [month, setMonth] = useState<string | null>(null);
  const [window, setWindow] = useState<12 | 24 | 60>(24);
  const [editing, setEditing] = useState<"groups" | "car" | null>(null);

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
    return {
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
  }, [transactions, settings, selected, latest]);

  if (!ready) return <PageSkeleton />;

  if (!selected || !data) {
    return (
      <Shell title="Expenses" subtitle="Where the money goes, month by month">
        <EmptyState
          icon={<Receipt size={20} />}
          title="No spending recorded yet"
          subtitle="Add an expense, or import a statement, and this page fills in."
        />
      </Shell>
    );
  }

  const { summary, floor, car } = data;
  const pct = (now: number, then: number | null) =>
    then !== null && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : undefined;
  const trend = data.trend.slice(-window);
  const spark = data.trend.slice(-13);

  return (
    <Shell
      title="Expenses"
      subtitle="Where the money goes, month by month"
      action={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing("groups")}
            aria-label="Sort categories into necessity and choice"
          >
            <Settings2 size={14} />
            <span className="hidden sm:inline">Categories</span>
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
            label={`Spent · ${labelMonth(selected)}`}
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
            deltaLabel="of the month — the part you choose"
            icon={<ShoppingBag size={16} />}
            spark={spark.map((m) => ({ v: m.discretionary }))}
            sparkKey="v"
            sparkColor="#34d399"
          />
          <StatCard
            label="Monthly floor"
            value={fmtCAD(floor.total)}
            deltaValue={`${floor.items.length} standing costs`}
            deltaLabel={`over the last ${floor.window} months`}
            icon={<TrendingDown size={16} />}
          />
        </div>

        <p className="px-1 text-[0.6875rem] leading-relaxed text-ink-faint">
          {summary.rank !== null && (
            <>
              {labelMonth(selected)} was the{" "}
              <strong className="text-ink-dim">{ordinal(summary.rank)}</strong>{" "}
              most expensive of the {summary.months} months on record.{" "}
            </>
          )}
          {summary.previous !== null && (
            <>
              The month before came to {fmtCAD(summary.previous)}.{" "}
            </>
          )}
          {summary.lastYear !== null && (
            <>A year earlier the same month cost {fmtCAD(summary.lastYear)}.</>
          )}
        </p>

        <Card>
          <CardHeader
            title="Month by month"
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader
              title={`What ${labelMonth(selected)} was made of`}
              subtitle="Consumption only, largest first"
            />
            <div className="px-2 pb-4">
              {data.donut.length > 0 ? (
                <DonutChart
                  data={data.donut}
                  colors={data.colors}
                  centerLabel="Spent"
                  centerValue={fmtCAD(summary.total)}
                  fmt={(n) => fmtCAD(n)}
                  height={260}
                />
              ) : (
                <p className="py-20 text-center text-xs text-ink-faint">
                  Nothing recorded in {labelMonth(selected)}.
                </p>
              )}
            </div>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader
              title="What moved"
              subtitle={`This month against what each category usually costs`}
            />
            <div className="space-y-1 px-3 pb-4">
              {data.movers.length === 0 ? (
                <p className="py-16 text-center text-xs text-ink-faint">
                  Every category came in close to its usual.
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
                    <span className="text-sm">{r.category}</span>
                    <span className="ml-auto text-xs tabular-nums text-ink-faint">
                      {fmtCAD(r.average)} usual
                    </span>
                    <span className="w-24 text-right text-sm tabular-nums">
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
                  <th className="px-3 py-2 text-right font-medium">Usual</th>
                  <th className="px-3 py-2 text-right font-medium">Vs usual</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Months</th>
                  <th className="px-3 py-2 text-right font-medium">Year ago</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Trend</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 text-[0.6875rem] leading-relaxed text-ink-faint">
            <strong className="text-ink-dim">Usual</strong> is the average over
            the months behind this one, which never includes the month being
            read — a month cannot be unusual against an average it is part of.{" "}
            <strong className="text-ink-dim">Months</strong> counts how many of
            them the category appeared in at all: something billed twelve times
            out of twelve is a commitment, and something billed twice is a
            decision.
          </p>
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
        <GroupsModal
          onClose={() => setEditing(null)}
          categories={categories}
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

function GroupsModal({
  onClose,
  categories,
  settings,
  onSave,
}: {
  onClose: () => void;
  categories: string[];
  settings: Settings;
  onSave: (s: Settings) => void;
}) {
  const [draft, setDraft] = useState<Record<string, SpendGroup>>(settings.groups);

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

  return (
    <Modal open onClose={onClose} title="Necessity or choice" size="lg">
      <p className="mb-4 text-xs leading-relaxed text-ink-faint">
        A necessity is something that arrives whether or not the month went
        well. Anything marked{" "}
        <strong className="text-ink-dim">not consumption</strong> is left out of
        every total on this page — debt repayment belongs there, since it moves
        money between your own sides of the ledger rather than spending it.
      </p>
      <div className="space-y-1">
        {[...categories].sort().map((c) => (
          <div key={c} className="flex items-center gap-3 py-1">
            <span className="text-sm">{c}</span>
            <div className="ml-auto">
              <Segmented<SpendGroup>
                options={[
                  { value: "necessity", label: "Need" },
                  { value: "discretionary", label: "Choice" },
                  { value: "excluded", label: "Neither" },
                ]}
                value={groupOf(c, draft)}
                onChange={(g) => set(c, g)}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
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
