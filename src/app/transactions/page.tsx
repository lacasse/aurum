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
  TradeForm,
  TransactionForm,
} from "@/components/forms";
import { allTrades, holdingAfterFlowEdit, type TradeRecord } from "@/lib/flows";
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

/** The filter values that mean trades rather than transactions. */
const TRADE_TYPES = new Set(["trade", "buy", "sell", "dividend"]);

/**
 * One line in the list: something that happened on a date.
 *
 * Transactions and trades are stored quite differently — one is a row of its
 * own, the other an entry in a position's history — but on this page they are
 * the same kind of thing, and merging them here is what lets one set of
 * filters answer for both.
 */
type Row =
  | { kind: "txn"; date: string; txn: Transaction }
  | { kind: "trade"; date: string; trade: TradeRecord };

export default function TransactionsPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const userCategories = useFinance((s) => s.categories);
  const deleteTransaction = useFinance((s) => s.deleteTransaction);
  const recurring = useFinance((s) => s.recurring);
  const deleteRecurring = useFinance((s) => s.deleteRecurring);
  const holdings = useFinance((s) => s.holdings);
  const updateHolding = useFinance((s) => s.updateHolding);

  const [q, setQ] = useState("");
  /*
   * Trades sit alongside the four transaction types rather than in a filter of
   * their own: from here they are one more kind of thing that happened on a
   * date, and asking "everything in March" should not mean asking twice.
   */
  const [type, setType] = useState<
    "all" | "income" | "expense" | "transfer" | "trade" | "buy" | "sell" | "dividend"
  >("all");
  const [category, setCategory] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [month, setMonth] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [deletingRule, setDeletingRule] = useState<RecurringRule | null>(null);
  const [editingTrade, setEditingTrade] = useState<TradeRecord | null>(null);
  const [deletingTrade, setDeletingTrade] = useState<TradeRecord | null>(null);

  /*
   * Every trade recorded against every position, flattened into rows that can
   * sit in the same list as a transaction. The flows themselves have no id, so
   * each row carries the position and the index it came from — which is how a
   * row on screen finds its way back to the record it stands for.
   */
  const trades = useMemo(() => allTrades(holdings), [holdings]);

  const monthOptions = useMemo(() => {
    const seen = new Set([
      ...transactions.map((t) => monthKeyOf(t.date)),
      ...trades.map((t) => monthKeyOf(t.date)),
    ]);
    return [...seen].sort().reverse().slice(0, 24);
  }, [transactions, trades]);

  /*
   * One pass rather than five chained filters, each of which allocated an
   * array of up to fourteen hundred rows to hand to the next. The order of the
   * tests is the order they are cheapest in: a string comparison before a
   * date parse before three lowercased substring searches.
   */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const wantsTrades = type === "all" || TRADE_TYPES.has(type);
    const wantsTransactions = type === "all" || !TRADE_TYPES.has(type);

    const txnRows: Row[] = wantsTransactions
      ? transactions
          .filter((t) => {
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
          })
          .map((t) => ({ kind: "txn" as const, date: t.date, txn: t }))
      : [];

    /*
     * A trade has no category, so the category filter excludes them outright
     * rather than matching nothing — picking "Groceries" is a question about
     * spending, and answering it with a list that silently drops trades is
     * clearer than one that pretends they were considered.
     */
    const tradeRows: Row[] =
      wantsTrades && category === "all"
        ? trades
            .filter((t) => {
              if (TRADE_TYPES.has(type) && type !== "trade" && t.kind !== type) {
                return false;
              }
              if (accountId !== "all" && t.accountId !== accountId) return false;
              if (month !== "all" && monthKeyOf(t.date) !== month) return false;
              if (needle === "") return true;
              return (
                t.ticker.toLowerCase().includes(needle) ||
                t.name.toLowerCase().includes(needle) ||
                t.kind.includes(needle)
              );
            })
            .map((t) => ({ kind: "trade" as const, date: t.date, trade: t }))
        : [];

    if (tradeRows.length === 0) return txnRows;
    if (txnRows.length === 0) return tradeRows;
    return [...txnRows, ...tradeRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, trades, q, type, category, accountId, month]);

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

  /*
   * Money in and out counts transactions only.
   *
   * A buy is not spending and a sell is not income — both move money between
   * things you own — and a dividend recorded against a position is already
   * counted where it lands. Adding trades here would make a rebalance look
   * like a month of enormous earning and enormous spending at once. The trades
   * get a count of their own instead, so a filtered list still says how many
   * of the rows below are trades.
   */
  const totals = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let trades = 0;
    for (const r of filtered) {
      if (r.kind === "trade") {
        trades++;
        continue;
      }
      // Transfers move money between your own accounts, so they belong to
      // neither total.
      if (r.txn.type === "income") income += r.txn.amount;
      else if (r.txn.type === "expense") expenses += r.txn.amount;
    }
    return { income, expenses, net: income - expenses, trades };
  }, [filtered]);

  const monthlyChart = useMemo(() => {
    const keys = lastMonthKeys(12);
    return keys.map((key) => {
      let income = 0;
      let expenses = 0;
      for (const r of filtered) {
        if (r.kind === "trade") continue;
        if (monthKeyOf(r.date) !== key) continue;
        if (r.txn.type === "income") income += r.txn.amount;
        else if (r.txn.type === "expense") expenses += r.txn.amount;
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
      subtitle={`${filtered.length} of ${transactions.length + trades.length} records shown${
        totals.trades > 0
          ? ` · ${totals.trades} trade${totals.trades === 1 ? "" : "s"}`
          : ""
      }`}
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
              <option value="all">Everything</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
              <optgroup label="Trades">
                <option value="trade">Any trade</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
              </optgroup>
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
              title="Nothing matches your filters"
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
                  {visible.map((r) =>
                    r.kind === "trade" ? (
                      <TradeRow
                        key={`${r.trade.holdingId}-${r.trade.index}`}
                        trade={r.trade}
                        accountName={accountName}
                        onEdit={() => setEditingTrade(r.trade)}
                        onDelete={() => setDeletingTrade(r.trade)}
                      />
                    ) : (
                      <TxnRow
                        key={r.txn.id}
                        t={r.txn}
                        accountName={accountName}
                        onEdit={() => {
                          setEditing(r.txn);
                          setFormOpen(true);
                        }}
                        onDelete={() => setDeleting(r.txn)}
                      />
                    ),
                  )}
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
      {/* Mounted only while open, so each opening starts from what is stored. */}
      {editingTrade && (
        <TradeForm
          key={`${editingTrade.holdingId}-${editingTrade.index}`}
          trade={editingTrade}
          onClose={() => setEditingTrade(null)}
        />
      )}
      <ConfirmDelete
        open={deletingTrade !== null}
        onClose={() => setDeletingTrade(null)}
        onConfirm={() => {
          if (!deletingTrade) return;
          const holding = holdings.find((h) => h.id === deletingTrade.holdingId);
          if (!holding) return;
          const next = holdingAfterFlowEdit(holding, deletingTrade.index, null);
          if (!next) return;
          updateHolding(holding.id, {
            ...holding,
            shares: next.shares,
            avgCost: next.avgCost,
            dividendsReceived: next.dividends,
            flows: next.flows,
          });
        }}
        title="Delete trade"
        message={
          deletingTrade
            ? `Delete the ${deletingTrade.kind} of ${deletingTrade.ticker} on ${labelDate(deletingTrade.date)} (${fmtCAD(deletingTrade.amount, 2)})? The position's shares, cost base and dividends are worked out again from what is left. Account balances are not touched.`
            : ""
        }
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

/** One recorded transaction, as a row. */
function TxnRow({
  t,
  accountName,
  onEdit,
  onDelete,
}: {
  t: Transaction;
  accountName: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { from, to } = transactionEndpoints(t, accountName);
  return (
    <tr className="border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60">
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
        <Badge tone={t.type === "income" ? "positive" : "neutral"}>{t.category}</Badge>
      </td>
      <td className="hidden px-4 py-3 text-ink-faint md:table-cell">
        <span className="inline-flex items-center gap-1">
          <span className="max-w-[110px] truncate">{from}</span>
          <ArrowRight size={11} className="shrink-0" />
          <span className="max-w-[110px] truncate">{to}</span>
        </span>
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
        <span className="inline-flex items-center gap-1">
          {t.type === "income" ? (
            <>
              <ArrowDownRight size={13} />+{fmtCAD(t.amount, 2)}
            </>
          ) : t.type === "transfer" ? (
            <>
              <ArrowLeftRight size={13} />
              {fmtCAD(t.amount, 2)}
            </>
          ) : (
            <>
              <ArrowUpRight size={13} />
              {fmtCAD(t.amount, 2)}
            </>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <Button variant="ghost" size="icon" aria-label={`Edit ${t.payee}`} onClick={onEdit}>
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${t.payee}`}
          onClick={onDelete}
          className="hover:text-negative"
        >
          <Trash2 size={14} />
        </Button>
      </td>
    </tr>
  );
}

/** The words a flow's `kind` goes by on screen. */
const TRADE_LABELS: Record<TradeRecord["kind"], string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
};

/**
 * One recorded trade, as a row in the same table.
 *
 * Shaped to the transaction columns rather than given its own: the ticker
 * where a payee goes, the kind of trade where a category goes, and the account
 * it settled in where the endpoints go. A buy leaves the account like an
 * expense and a sell and a dividend arrive like income, so the amounts are
 * signed and coloured the same way, and the row reads without a key.
 */
function TradeRow({
  trade,
  accountName,
  onEdit,
  onDelete,
}: {
  trade: TradeRecord;
  accountName: (id: string) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const incoming = trade.kind !== "buy";
  const units = Math.abs(trade.shares);
  return (
    <tr className="border-b border-line/50 transition-colors last:border-0 hover:bg-elevated/60">
      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-dim">
        {labelDate(trade.date)}
      </td>
      <td className="max-w-[220px] px-4 py-3">
        <span className="block truncate font-medium">{trade.ticker}</span>
        <span className="block truncate text-[0.6875rem] text-ink-faint">
          {trade.kind === "dividend"
            ? trade.name
            : `${units} ${units === 1 ? "unit" : "units"} · ${trade.name}`}
        </span>
      </td>
      <td className="px-4 py-3">
        <Badge tone={trade.kind === "dividend" ? "positive" : "brand"}>
          {TRADE_LABELS[trade.kind]}
        </Badge>
        {trade.awaitingPrice ? (
          <span className="ml-1.5 text-[0.6875rem] text-ink-faint">no value yet</span>
        ) : null}
      </td>
      <td className="hidden px-4 py-3 text-ink-faint md:table-cell">
        <span className="max-w-[230px] truncate">{accountName(trade.accountId)}</span>
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums",
          incoming ? "text-positive" : "text-ink",
        )}
      >
        <span className="inline-flex items-center gap-1">
          {incoming ? (
            <>
              <ArrowDownRight size={13} />+{fmtCAD(trade.amount, 2)}
            </>
          ) : (
            <>
              <ArrowUpRight size={13} />
              {fmtCAD(trade.amount, 2)}
            </>
          )}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Edit ${trade.kind} of ${trade.ticker}`}
          onClick={onEdit}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${trade.kind} of ${trade.ticker}`}
          onClick={onDelete}
          className="hover:text-negative"
        >
          <Trash2 size={14} />
        </Button>
      </td>
    </tr>
  );
}
