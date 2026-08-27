"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Shell } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  cn,
} from "@/components/ui";
import { GroupedBars } from "@/components/charts";
import {
  ConfirmDelete,
  TransactionForm,
} from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { fmtCompact, fmtCAD, labelDate, labelMonth, lastMonthKeys, monthKeyOf } from "@/lib/format";
import { INCOME_CATEGORIES, Transaction } from "@/lib/types";

export default function TransactionsPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const userCategories = useFinance((s) => s.categories);
  const deleteTransaction = useFinance((s) => s.deleteTransaction);

  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "income" | "expense">("all");
  const [category, setCategory] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [month, setMonth] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);

  const monthOptions = useMemo(() => {
    if (transactions.length === 0) return [];
    const seen = new Set(transactions.map((t) => monthKeyOf(t.date)));
    return [...seen].sort().reverse().slice(0, 24);
  }, [transactions]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return transactions
      .filter((t) => type === "all" || t.type === type)
      .filter((t) => category === "all" || t.category === category)
      .filter((t) => accountId === "all" || t.accountId === accountId)
      .filter((t) => month === "all" || monthKeyOf(t.date) === month)
      .filter(
        (t) =>
          needle === "" ||
          t.payee.toLowerCase().includes(needle) ||
          t.category.toLowerCase().includes(needle) ||
          (t.note ?? "").toLowerCase().includes(needle),
      );
  }, [transactions, q, type, category, accountId, month]);

  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    for (const t of filtered) {
      if (t.type === "income") income += t.amount;
      else expenses += t.amount;
    }
    return { income, expenses, net: income - expenses };
  }, [filtered]);

  const monthlyChart = useMemo(() => {
    const keys = lastMonthKeys(12);
    return keys.map((key) => {
      let income = 0;
      let expenses = 0;
      for (const t of filtered) {
        if (monthKeyOf(t.date) !== key) continue;
        if (t.type === "income") income += t.amount;
        else expenses += t.amount;
      }
      return { label: labelMonth(key), income, expenses };
    });
  }, [filtered]);

  if (!ready) return <PageSkeleton />;

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.name ?? "Unknown";

  return (
    <Shell
      title="Transactions"
      subtitle={`${filtered.length} of ${transactions.length} transactions shown`}
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={15} /> Add
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Summary chips */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="p-4">
            <p className="text-[11px] font-medium text-ink-dim">Money in</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-positive">
              +{fmtCAD(totals.income, 2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-medium text-ink-dim">Money out</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-negative">
              −{fmtCAD(totals.expenses, 2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] font-medium text-ink-dim">Net</p>
            <p
              className={cn(
                "mt-1 text-lg font-semibold tabular-nums",
                totals.net >= 0 ? "text-positive" : "text-negative",
              )}
            >
              {fmtCAD(totals.net, 2)}
            </p>
          </Card>
        </div>

        {/* Filtered cash flow */}
        <Card>
          <div className="px-5 pt-5 pb-2">
            <h3 className="text-sm font-semibold">Filtered cash flow</h3>
            <p className="mt-0.5 text-xs text-ink-faint">
              Income vs expenses for the current selection · last 12 months
            </p>
          </div>
          <div className="px-3 pb-4">
            <GroupedBars
              data={monthlyChart as unknown as Record<string, unknown>[]}
              xKey="label"
              bars={[
                { key: "income", name: "Income", color: "#34d399" },
                { key: "expenses", name: "Expenses", color: "#fb7185" },
              ]}
              height={220}
              yFmt={fmtCompact}
            />
          </div>
        </Card>

        {/* Filters */}
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search payee, note…"
                className="pl-8"
              />
            </div>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="all">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              <optgroup label="Income">
                {INCOME_CATEGORIES.map((c) => (
                  <option key={`income-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Expense">
                {userCategories.map((c) => (
                  <option key={`expense-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
            </Select>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="all">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="all">All months</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        {/* Table */}
        <Card>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search size={28} />}
              title="No transactions match your filters"
              subtitle="Try widening the date range or clearing the search."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Payee</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">
                      Account
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60"
                    >
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-dim">
                        {labelDate(t.date)}
                      </td>
                      <td className="max-w-[220px] px-4 py-3">
                        <span className="block truncate font-medium">{t.payee}</span>
                        {t.note ? (
                          <span className="block truncate text-[11px] text-ink-faint">
                            {t.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={t.type === "income" ? "positive" : "neutral"}>
                          {t.category}
                        </Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-ink-faint md:table-cell">
                        {accountName(t.accountId)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums",
                          t.type === "income" ? "text-positive" : "text-ink",
                        )}
                      >
                        {t.type === "income" ? (
                          <span className="inline-flex items-center gap-1">
                            <ArrowDownRight size={13} />+
                            {fmtCAD(t.amount, 2)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <ArrowUpRight size={13} />
                            {fmtCAD(t.amount, 2)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${t.payee}`}
                          onClick={() => {
                            setEditing(t);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${t.payee}`}
                          onClick={() => setDeleting(t)}
                          className="hover:text-negative"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <TransactionForm
        open={formOpen}
        initial={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />
      <ConfirmDelete
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteTransaction(deleting.id)}
        title="Delete transaction"
        message={`Delete “${deleting?.payee ?? ""}" (${fmtCAD(deleting?.amount ?? 0, 2)})? The linked account balance will be adjusted.`}
      />
    </Shell>
  );
}
