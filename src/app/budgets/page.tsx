"use client";

import { useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Progress,
  cn,
} from "@/components/ui";
import { BudgetVsActual, RadialGauge } from "@/components/charts";
import { ConfirmDelete } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { budgetRows, monthTotals } from "@/lib/analytics";
import { currentMonthKey, daysLeftInMonth, fmtCAD, monthKeyOf } from "@/lib/format";

interface ManageRow {
  name: string;
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
}

export default function BudgetsPage() {
  const ready = useReady();
  const budgets = useFinance((s) => s.budgets);
  const categories = useFinance((s) => s.categories);
  const transactions = useFinance((s) => s.transactions);
  const setBudget = useFinance((s) => s.setBudget);
  const deleteBudget = useFinance((s) => s.deleteBudget);
  const addCategory = useFinance((s) => s.addCategory);
  const renameCategory = useFinance((s) => s.renameCategory);
  const deleteCategory = useFinance((s) => s.deleteCategory);

  const monthKey = currentMonthKey();

  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [draftLimit, setDraftLimit] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [newLimit, setNewLimit] = useState("");
  const [rowError, setRowError] = useState("");
  const [deleting, setDeleting] = useState<{ name: string; txnCount: number; fallback: string } | null>(null);

  const rows = useMemo(
    () => budgetRows(budgets, transactions, monthKey),
    [budgets, transactions, monthKey],
  );
  const totals = useMemo(() => monthTotals(transactions, monthKey), [transactions, monthKey]);

  const spentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.type !== "expense" || monthKeyOf(t.date) !== monthKey) continue;
      m.set(t.category, (m.get(t.category) ?? 0) + t.amount);
    }
    return m;
  }, [transactions, monthKey]);

  const manageRows = useMemo<ManageRow[]>(() => {
    const limitMap = new Map(budgets.map((b) => [b.category, b.limit]));
    const list = categories.map((name) => {
      const limit = limitMap.get(name) ?? 0;
      const spent = spentMap.get(name) ?? 0;
      return {
        name,
        limit,
        spent,
        remaining: limit - spent,
        pct: limit > 0 ? (spent / limit) * 100 : 0,
      };
    });
    list.sort(
      (a, b) =>
        (a.limit > 0 ? 0 : 1) - (b.limit > 0 ? 0 : 1) ||
        b.pct - a.pct ||
        a.name.localeCompare(b.name),
    );
    return list;
  }, [categories, budgets, spentMap]);

  const totalBudget = rows.reduce((s, r) => s + r.limit, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
  const remaining = totalBudget - totalSpent;
  const utilization = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const overCount = rows.filter((r) => r.pct >= 100).length;

  const saveLimit = (cat: string) => {
    const v = Number(draftLimit);
    if (!Number.isFinite(v) || v < 0) return;
    if (v <= 0) deleteBudget(cat);
    else setBudget(cat, Math.round(v * 100) / 100);
    setEditingLimit(null);
  };

  const startRename = (cat: string) => {
    setRenaming(cat);
    setDraftName(cat);
    setRowError("");
  };

  const saveRename = () => {
    if (!renaming) return;
    const n = draftName.trim();
    if (!n) return setRowError("Category name can’t be empty.");
    if (n.toLowerCase() === renaming.toLowerCase()) {
      setRenaming(null);
      return;
    }
    if (categories.some((c) => c.toLowerCase() === n.toLowerCase())) {
      return setRowError(`“${n}” already exists.`);
    }
    renameCategory(renaming, n);
    setRenaming(null);
    setRowError("");
  };

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const n = newName.trim();
    if (!n) return setRowError("Enter a category name first.");
    if (categories.some((c) => c.toLowerCase() === n.toLowerCase())) {
      return setRowError(`“${n}” already exists.`);
    }
    const v = Number(newLimit);
    const ok = addCategory(n, Number.isFinite(v) && v > 0 ? v : undefined);
    if (!ok) return setRowError(`“${n}” already exists.`);
    setNewName("");
    setNewLimit("");
    setRowError("");
  };

  const requestDelete = (name: string) => {
    const txnCount = transactions.filter((t) => t.category === name).length;
    const rest = categories.filter((c) => c !== name);
    const fallback = rest.includes("Other") ? "Other" : rest[0] ?? "nowhere";
    setDeleting({ name, txnCount, fallback });
  };

  if (!ready) return <PageSkeleton />;

  return (
    <Shell
      title="Budgets"
      subtitle={`${manageRows.length} categories · ${overCount} over budget`}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-dim">Total budgeted</span>
              <Wallet size={15} className="text-ink-faint" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {fmtCAD(totalBudget)}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">for this month</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-dim">Spent so far</span>
              <PiggyBank size={15} className="text-ink-faint" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {fmtCAD(totalSpent)}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">
              {fmtCAD(totals.expenses)} tracked expenses
            </p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-dim">Remaining</span>
              <Badge tone={remaining >= 0 ? "positive" : "negative"}>
                {remaining >= 0 ? "on track" : "over"}
              </Badge>
            </div>
            <p
              className={cn(
                "mt-2 text-2xl font-semibold tabular-nums",
                remaining < 0 && "text-negative",
              )}
            >
              {fmtCAD(remaining)}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">
              {fmtCAD(Math.max(0, remaining))} left to spend
            </p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-dim">Days left</span>
              <CalendarClock size={15} className="text-ink-faint" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {daysLeftInMonth()}
            </p>
            <p className="mt-1 text-[11px] text-ink-faint">
              ≈ {fmtCAD(Math.max(0, remaining) / Math.max(1, daysLeftInMonth()))}/day pace
            </p>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Overall utilization" subtitle="Spent vs total budget" />
            <div className="px-5 pb-6">
              <RadialGauge
                pct={utilization}
                label="of budget used"
                sublabel={`${fmtCAD(totalSpent)} of ${fmtCAD(totalBudget)}`}
                height={210}
              />
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Budget vs actual"
              subtitle="Per-category comparison for this month"
            />
            <div className="px-3 pb-4">
              <BudgetVsActual
                data={rows.map((r) => ({
                  category: r.category,
                  budgeted: r.limit,
                  spent: r.spent,
                }))}
                height={300}
                fmt={(n) => fmtCAD(n)}
              />
            </div>
          </Card>
        </div>

        {/* Category manager */}
        <Card>
          <CardHeader
            title="Categories & budgets"
            subtitle="Rename, delete, or add categories — these power budgets, CSV import, and filters"
          />
          <ul className="divide-y divide-line/60 px-2 pb-2">
            {manageRows.map((r) => (
              <li key={r.name} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 sm:w-48">
                  {renaming === r.name ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveRename();
                          }
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        className="h-8 py-1 text-xs"
                        autoFocus
                      />
                      <Button size="icon" aria-label={`Save name for ${r.name}`} onClick={saveRename} className="h-8 w-8">
                        <Check size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Cancel renaming ${r.name}`}
                        onClick={() => setRenaming(null)}
                        className="h-8 w-8"
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-[11px] text-ink-faint">
                        {r.limit > 0 ? (
                          <>
                            {fmtCAD(r.spent, 0)} spent ·{" "}
                            {r.pct >= 100 ? (
                              <span className="text-negative">over by {fmtCAD(-r.remaining, 0)}</span>
                            ) : (
                              <span>{fmtCAD(r.remaining, 0)} left</span>
                            )}
                          </>
                        ) : (
                          "no budget set"
                        )}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex-1">
                  {r.limit > 0 ? (
                    <Progress value={r.spent} max={r.limit} />
                  ) : (
                    <div className="h-1.5 w-full rounded-full bg-elevated" />
                  )}
                </div>

                <div className="flex items-center gap-2 sm:w-64 sm:justify-end">
                  {editingLimit === r.name ? (
                    <>
                      <Input
                        type="number"
                        min="0"
                        step="10"
                        value={draftLimit}
                        onChange={(e) => setDraftLimit(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveLimit(r.name);
                          }
                          if (e.key === "Escape") setEditingLimit(null);
                        }}
                        className="h-8 w-24 py-1"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => saveLimit(r.name)}>
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Cancel editing limit for ${r.name}`}
                        onClick={() => setEditingLimit(null)}
                      >
                        <X size={14} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs tabular-nums text-ink-dim">
                        {r.limit > 0 ? `limit ${fmtCAD(r.limit)}` : "—"}
                      </span>
                      {r.limit > 0 ? (
                        <span
                          className={cn(
                            "w-12 text-right text-xs font-semibold tabular-nums",
                            r.pct >= 100
                              ? "text-negative"
                              : r.pct >= 80
                                ? "text-amber-500"
                                : "text-positive",
                          )}
                        >
                          {Math.round(r.pct)}%
                        </span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Rename ${r.name}`}
                        onClick={() => startRename(r.name)}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit limit for ${r.name}`}
                        onClick={() => {
                          setEditingLimit(r.name);
                          setDraftLimit(r.limit > 0 ? String(r.limit) : "200");
                        }}
                      >
                        <Wallet size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${r.name}`}
                        onClick={() => requestDelete(r.name)}
                        className="hover:text-negative"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {rowError ? (
            <p className="px-5 pb-1 text-xs text-negative">{rowError}</p>
          ) : null}

          <div className="border-t border-line/60 p-4">
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={submitAdd}
            >
              <div className="flex-1">
                <p className="mb-1.5 text-xs font-medium text-ink-dim">New category</p>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Pets, Childcare, Coffee"
                />
              </div>
              <div className="sm:w-44">
                <p className="mb-1.5 text-xs font-medium text-ink-dim">
                  Monthly limit (optional)
                </p>
                <Input
                  type="number"
                  min="0"
                  step="10"
                  placeholder="200"
                  value={newLimit}
                  onChange={(e) => setNewLimit(e.target.value)}
                />
              </div>
              <Button type="submit">
                <Plus size={14} /> Add category
              </Button>
            </form>
          </div>
        </Card>
      </div>

      <ConfirmDelete
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteCategory(deleting.name)}
        title="Delete category"
        message={
          deleting
            ? `Delete “${deleting.name}”? Its budget is removed${
                deleting.txnCount > 0
                  ? ` and ${deleting.txnCount} transaction${deleting.txnCount === 1 ? "" : "s"} will move to “${deleting.fallback}”.`
                  : "."
              }`
            : ""
        }
      />
    </Shell>
  );
}
