"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Pencil,
  Plus,
  Repeat,
  Search,
  Trash2,
} from "lucide-react";
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
  RecurringForm,
  TransactionForm,
} from "@/components/forms";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { fmtCompact, fmtCAD, labelDate, labelMonth, lastMonthKeys, monthKeyOf } from "@/lib/format";
import {
  INCOME_CATEGORIES,
  alphabetical,
  RECURRENCE_LABELS,
  RecurringRule,
  TRANSFER_CATEGORY,
  Transaction,
  touchesAccount,
  transactionEndpoints,
} from "@/lib/types";

/** Rows drawn at once. Enough to fill a tall screen and then some. */
const PAGE = 100;

export default function TransactionsPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const userCategories = useFinance((s) => s.categories);
  const deleteTransaction = useFinance((s) => s.deleteTransaction);
  const recurring = useFinance((s) => s.recurring);
  const deleteRecurring = useFinance((s) => s.deleteRecurring);

  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [category, setCategory] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [month, setMonth] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<RecurringRule | null>(null);

  const monthOptions = useMemo(() => {
    if (transactions.length === 0) return [];
    const seen = new Set(transactions.map((t) => monthKeyOf(t.date)));
    return [...seen].sort().reverse().slice(0, 24);
  }, [transactions]);

  /*
   * One pass rather than five chained filters, each of which allocated an
   * array of up to fourteen hundred rows to hand to the next. The order of the
   * tests is the order they are cheapest in: a string comparison before a
   * date parse before three lowercased substring searches.
   */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return transactions.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      if (category !== "all" && t.category !== category) return false;
      if (accountId !== "all" && !touchesAccount(t, accountId)) return false;
      if (month !== "all" && monthKeyOf(t.date) !== month) return false;
      if (needle === "") return true;
      return (
        t.payee.toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle) ||
        (t.note ?? "").toLowerCase().includes(needle)
      );
    });
  }, [transactions, q, type, category, accountId, month]);

  /*
   * Rows are drawn a page at a time.
   *
   * The table used to render every match — fourteen hundred rows, some ten
   * thousand elements and two buttons apiece — so every keystroke in the
   * search box rebuilt the lot and the page stuttered as you typed. The
   * totals above still count every match, so the figures are unaffected by
   * where the list is cut.
   */
  const filterKey = `${q}|${type}|${category}|${accountId}|${month}`;
  /*
   * The page count is stored against the filters it belongs to, so changing a
   * filter starts again at the first page without an effect to reset it —
   * setting state from an effect costs a second render of the whole table,
   * which is the thing being avoided here.
   */
  const [page, setPage] = useState({ key: filterKey, shown: PAGE });
  const shown = page.key === filterKey ? page.shown : PAGE;
  const visible = useMemo(() => filtered.slice(0, shown), [filtered, shown]);

  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    for (const t of filtered) {
      // Transfers move money between your own accounts, so they belong to
      // neither total.
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") expenses += t.amount;
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
        else if (t.type === "expense") expenses += t.amount;
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
            <p className="text-[0.6875rem] font-medium text-ink-dim">Money in</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-positive">
              +{fmtCAD(totals.income, 2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[0.6875rem] font-medium text-ink-dim">Money out</p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-negative">
              −{fmtCAD(totals.expenses, 2)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[0.6875rem] font-medium text-ink-dim">Net</p>
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

        {/* Recurring rules */}
        <Card>
          <div className="flex items-center justify-between px-5 pt-5">
            <div>
              <h3 className="text-sm font-semibold">Recurring</h3>
              <p className="mt-0.5 text-xs text-ink-faint">
                Rent, salary, subscriptions and contributions post themselves on
                schedule
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingRule(null);
                setRuleFormOpen(true);
              }}
            >
              <Plus size={14} /> New
            </Button>
          </div>
          {recurring.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-ink-faint">
              Nothing recurring yet. Add a rule and its payments appear here
              automatically, including any already due.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-line/60 border-t border-line">
              {recurring.map((r) => {
                const { from, to } = transactionEndpoints(r, accountName);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-5 py-3 text-sm"
                  >
                    <Repeat
                      size={14}
                      className={r.active ? "text-brand" : "text-ink-faint"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.payee}</span>
                      <span className="block truncate text-[0.6875rem] text-ink-faint">
                        {RECURRENCE_LABELS[r.frequency]} · {from} → {to}
                        {r.active
                          ? ` · next ${labelDate(r.nextDate)}`
                          : " · paused"}
                      </span>
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums">
                      {fmtCAD(r.amount, 2)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${r.payee}`}
                      onClick={() => {
                        setEditingRule(r);
                        setRuleFormOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${r.payee}`}
                      onClick={() => setDeletingRule(r)}
                      className="hover:text-negative"
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
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
              <option value="transfer">Transfer</option>
            </Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              <optgroup label="Income">
                {alphabetical(INCOME_CATEGORIES).map((c) => (
                  <option key={`income-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Expense">
                {alphabetical(userCategories).map((c) => (
                  <option key={`expense-${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </optgroup>
              <option value={TRANSFER_CATEGORY}>{TRANSFER_CATEGORY}</option>
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
                  <tr className="border-b border-line text-left text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Payee</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="hidden px-4 py-3 font-medium md:table-cell">
                      From → To
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => (
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
                          <span className="block truncate text-[0.6875rem] text-ink-faint">
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
                        {(() => {
                          const { from, to } = transactionEndpoints(t, accountName);
                          return (
                            <span className="inline-flex items-center gap-1">
                              <span className="truncate max-w-[110px]">{from}</span>
                              <ArrowRight size={11} className="shrink-0" />
                              <span className="truncate max-w-[110px]">{to}</span>
                            </span>
                          );
                        })()}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums",
                          t.type === "income"
                            ? "text-positive"
                            : t.type === "transfer"
                              ? "text-ink-dim"
                              : "text-ink",
                        )}
                      >
                        {t.type === "income" ? (
                          <span className="inline-flex items-center gap-1">
                            <ArrowDownRight size={13} />+
                            {fmtCAD(t.amount, 2)}
                          </span>
                        ) : t.type === "transfer" ? (
                          <span className="inline-flex items-center gap-1">
                            <ArrowLeftRight size={13} />
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
              {filtered.length > visible.length && (
                <div className="border-t border-line px-4 py-3 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => setPage({ key: filterKey, shown: shown + PAGE })}
                  >
                    Show {Math.min(PAGE, filtered.length - visible.length)} more
                    <span className="text-ink-faint">
                      · {visible.length} of {filtered.length}
                    </span>
                  </Button>
                </div>
              )}
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
      <RecurringForm
        open={ruleFormOpen}
        initial={editingRule}
        onClose={() => {
          setRuleFormOpen(false);
          setEditingRule(null);
        }}
      />
      <ConfirmDelete
        open={deletingRule !== null}
        onClose={() => setDeletingRule(null)}
        onConfirm={() => deletingRule && deleteRecurring(deletingRule.id)}
        title="Delete recurring transaction"
        message={`Stop “${deletingRule?.payee ?? ""}” from repeating? Payments it has already posted are kept.`}
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
