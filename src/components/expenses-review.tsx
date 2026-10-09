"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui";
import { useFinance } from "@/lib/store";
import {
  NO_AVERAGING,
  effectiveLimits,
  yearReview,
  type Averaging,
} from "@/lib/budget-habits";
import { getSettings } from "@/lib/api";
import type { SpendGroup } from "@/lib/expenses";
import { currentMonthKey, fmtCAD, labelMonth } from "@/lib/format";

/**
 * The year's spending read back: the months that kept to the budget and what
 * that left over, the category that improved most, and the months and the
 * category at either end. Facts only — no score, and nothing to be told off by.
 */
export function ExpensesReview({
  year,
  groups,
}: {
  year: number;
  groups: Record<string, SpendGroup>;
}) {
  const transactions = useFinance((s) => s.transactions);
  const budgets = useFinance((s) => s.budgets);
  // Whether budgets follow the 12-month average: the same budgets the
  // expenses page judges against, from the same function.
  const [averaging, setAveraging] = useState<Averaging>(NO_AVERAGING);
  useEffect(() => {
    let cancelled = false;
    getSettings<{ autoBudget?: boolean; averaged?: string[] }>("/api/expense-settings")
      .then((s) => {
        if (!cancelled) {
          setAveraging({ all: s.autoBudget === true, categories: s.averaged ?? [] });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const limits = useMemo(
    () => effectiveLimits(budgets, averaging, transactions, groups, currentMonthKey()),
    [budgets, averaging, transactions, groups],
  );
  const r = useMemo(
    () => yearReview(transactions, year, groups, limits, currentMonthKey()),
    [transactions, year, groups, limits],
  );
  if (r.months === 0) return null;
  const partial = r.months < 12;
  const noBudget = limits.size === 0 || r.judged === 0;

  return (
    <Card>
      <CardHeader
        title="Expenses review"
        subtitle={partial ? `${year} so far · ${r.months} months on record` : `${year}, month by month`}
      />
      <dl className="mx-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        <ReviewTile
          label="Months under budget"
          value={noBudget ? "—" : `${r.monthsUnder} of ${r.judged}`}
          note={limits.size === 0 ? "No budgets set" : "Against today's budgets"}
        />
        <ReviewTile
          label="Kept under budget"
          value={noBudget ? "—" : fmtCAD(r.kept)}
          note="Left over in the months under budget"
        />
        <ReviewTile
          label="Most improved"
          value={r.improved ? r.improved.category : "—"}
          note={
            r.improved
              ? `${fmtCAD(r.improved.before)} → ${fmtCAD(r.improved.after)} a month`
              : `Needs a few months of ${year - 1} to compare with`
          }
        />
        <ReviewTile
          label="Cheapest month"
          value={r.cheapest ? labelMonth(r.cheapest.key) : "—"}
          note={r.cheapest ? fmtCAD(r.cheapest.total) : ""}
        />
        <ReviewTile
          label="Priciest month"
          value={r.priciest ? labelMonth(r.priciest.key) : "—"}
          note={r.priciest ? fmtCAD(r.priciest.total) : ""}
        />
        <ReviewTile
          label="Largest category"
          value={r.largest ? r.largest.category : "—"}
          note={r.largest ? `${fmtCAD(r.largest.total)} ${partial ? "so far" : "over the year"}` : ""}
        />
      </dl>
      <p className="px-5 pb-4 pt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
        Consumption only: debt repayment and anything marked neither is left out.
        Budgets have no history, so past months are judged against the budgets as
        they are today, and a month still running is not judged.
      </p>
    </Card>
  );
}

function ReviewTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 bg-surface p-4">
      <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-ink-dim">{note || " "}</dd>
    </div>
  );
}
