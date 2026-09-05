"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
  cn,
} from "@/components/ui";
import { useFinance } from "@/lib/store";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { ImportedRow, describeSigns, suggestCategory, txnKey } from "@/lib/csv";
import {
  TradeRow,
  accumulatePositions,
  markAlreadyImported,
  positionToHolding,
  tradeKey,
} from "@/lib/trades";
import { RoutedFile, accountForHint, labelFor, routeFile } from "@/lib/import-router";
import {
  CorporateAction,
  applyAction,
  describeAction,
} from "@/lib/corporate-actions";
import {
  INCOME_CATEGORIES,
  alphabetical,
  REGISTRATION_LABELS,
  Registration,
  TRANSFER_CATEGORY,
  isInvestmentAccount,
  isLiability,
  sidesFor,
} from "@/lib/types";
import { fmtCAD } from "@/lib/format";
import { DEBT_CATEGORY } from "@/lib/expenses";

type Step = "upload" | "review" | "done";

/** Sentinel for "the file says which account each row belongs to". */
const MATCH_THE_FILE = "__match__";

/**
 * One import for every kind of file.
 *
 * There used to be two pages, and the split was the app's problem rather than
 * the user's: a monthly export from a brokerage carries salary, bill payments,
 * transfers, trades and dividends in one file, and there was no door it fit
 * through. Files now say what they are and are read accordingly, so the
 * monthly routine is drop both exports here and look over what came out.
 */
export default function ImportPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const transactions = useFinance((s) => s.transactions);
  const merchantRules = useFinance((s) => s.merchantRules);
  const userCategories = useFinance((s) => s.categories);
  const addTransaction = useFinance((s) => s.addTransaction);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const adjustAccountCash = useFinance((s) => s.adjustAccountCash);
  const setMerchantRule = useFinance((s) => s.setMerchantRule);

  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<RoutedFile[]>([]);
  const [cashRows, setCashRows] = useState<ImportedRow[]>([]);
  const [tradeRows, setTradeRows] = useState<TradeRow[]>([]);
  const [actions, setActions] = useState<CorporateAction[]>([]);
  /*
   * Which account each file is about, chosen per file rather than per import.
   * A card statement is one account from end to end; an activity export covers
   * the chequing account and every investment account at once, and says which
   * on each row, so it is left to match itself.
   */
  const [fileAccounts, setFileAccounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{
    transactions: number;
    created: number;
    updated: number;
    transfers: number;
    learned: number;
    actions: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));
  /*
   * The debts a repayment could be paying off. Every other expense ends at a
   * merchant; this one ends at a balance owed, and which one decides whose
   * balance comes down — so it is the one far side that cannot be guessed.
   */
  const debts = accounts.filter((a) => isLiability(a.kind));
  const cashAccountId =
    accounts.find((a) => a.kind === "checking")?.id ??
    accounts.find((a) => !isInvestmentAccount(a.kind) && !isLiability(a.kind))?.id ??
    "";
  const cardAccountId = accounts.find((a) => a.kind === "credit")?.id ?? "";
  const accountIdFor = (registration: Registration): string =>
    investmentAccounts.find((a) => a.registration === registration)?.id ?? "";

  /**
   * The account a file defaults to.
   *
   * A card statement is the credit card; a bank statement — one with debit and
   * credit columns — is the everyday account, which is the opposite side of
   * the ledger. Anything else names its own account row by row.
   */
  const defaultAccountFor = (file: RoutedFile): string => {
    if (file.kind === "card") return cardAccountId || cashAccountId;
    if (file.kind === "bank") return cashAccountId || cardAccountId;
    return MATCH_THE_FILE;
  };
  const accountForFile = (name: string): string => {
    const chosen = fileAccounts[name];
    if (chosen) return chosen;
    const file = files.find((f) => f.fileName === name);
    return file ? defaultAccountFor(file) : cashAccountId;
  };

  /**
   * Where one row lands: what the row itself said, then what the file was set
   * to, then the everyday account.
   */
  const accountForRow = (row: ImportedRow): string => {
    const chosen = accountForFile(row.sourceFile);
    if (chosen !== MATCH_THE_FILE) return chosen;
    // The same rule the monthly checklist uses, so a row lands in the same
    // account whichever door it came through.
    return accountForHint(row.accountHint, accounts) ?? cashAccountId;
  };

  const existingTxnKeys = useMemo(
    () => new Set(transactions.map((t) => txnKey(t.date, t.amount, t.payee))),
    [transactions],
  );

  /*
   * Trades are checked against what is stored, not just against the other rows
   * in the file: the point of dropping the same export twice is that the second
   * one should do nothing.
   */
  const checkedTrades = useMemo(
    () =>
      markAlreadyImported(
        tradeRows,
        accountIdFor,
        holdings,
        transactions.filter((t) => t.type === "transfer"),
        new Set(investmentAccounts.map((a) => a.id)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tradeRows, holdings, transactions, accounts],
  );

  const includedCash = cashRows.filter((r) => r.include);
  /* Repayments still missing the debt they paid, which the save cannot infer. */
  const unassignedDebt = includedCash.filter(
    (r) => r.type === "expense" && r.category === DEBT_CATEGORY && !r.debtAccountId,
  );
  const includedTrades = checkedTrades.filter((r) => r.include);
  const dupCash = cashRows.filter((r) => r.dup).length;
  const dupTrades = checkedTrades.filter((r) => r.duplicate).length;
  const needsAttention = files.flatMap((f) => f.needsAttention);
  const unmatchedRegistrations = [
    ...new Set(
      includedTrades
        .map((r) => r.registration)
        .filter((reg): reg is Registration => reg !== null && !accountIdFor(reg)),
    ),
  ];

  const handleFiles = async (list: FileList | File[]) => {
    const csvs = Array.from(list).filter(
      (f) => /\.csv$/i.test(f.name) || f.type === "text/csv",
    );
    if (csvs.length === 0) return;
    setBusy(true);
    // Keys carry forward across files so an overlap between two exports — the
    // usual case when a month is downloaded twice — is caught, not counted.
    const txnKeys = new Set([...existingTxnKeys, ...cashRows.map((r) => txnKey(r.date, r.amount, r.payee))]);
    const tKeys = new Set(tradeRows.map(tradeKey));
    const routed: RoutedFile[] = [];
    for (const file of csvs) {
      const res = await routeFile(file, txnKeys, tKeys, merchantRules, userCategories);
      for (const r of res.cash) txnKeys.add(txnKey(r.date, r.amount, r.payee));
      for (const t of res.trades) tKeys.add(tradeKey(t));
      routed.push(res);
    }
    setFiles((prev) => [...prev, ...routed]);
    setCashRows((prev) => [...prev, ...routed.flatMap((r) => r.cash)]);
    setTradeRows((prev) => [...prev, ...routed.flatMap((r) => r.trades)]);
    setActions((prev) => [...prev, ...routed.flatMap((r) => r.actions)]);
    setBusy(false);
  };

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.fileName !== name));
    setCashRows((prev) => prev.filter((r) => r.sourceFile !== name));
    setTradeRows((prev) => prev.filter((r) => r.sourceFile !== name));
    setActions((prev) => prev.filter((r) => r.sourceFile !== name));
  };

  const updateCash = (id: string, patch: Partial<ImportedRow>) =>
    setCashRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateTrade = (id: string, patch: Partial<TradeRow>) =>
    setTradeRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const updateAction = (id: string, patch: Partial<CorporateAction>) =>
    setActions((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /*
   * The holding a corporate action starts from, matched in the account the
   * action happened in — the same ticker in another account is a different
   * position with its own cost basis.
   */
  const holdingFor = (ticker: string, registration: Registration | null) => {
    const accountId = registration ? accountIdFor(registration) : "";
    return holdings.find(
      (h) =>
        h.ticker.toUpperCase() === ticker.toUpperCase() &&
        (!accountId || h.accountId === accountId),
    );
  };

  const changeType = (row: ImportedRow, type: ImportedRow["type"]) => {
    const s = suggestCategory(
      row.payee,
      "",
      row.note ?? "",
      row.csvCategory,
      type,
      merchantRules,
      userCategories,
    );
    updateCash(row.id, {
      type,
      category: s.category,
      suggestedCategory: s.category,
      confident: s.confident,
    });
  };

  const save = () => {
    let learned = 0;
    const validCash = includedCash.filter(
      (r) => r.payee.trim() && r.amount > 0 && r.date && accountForRow(r),
    );
    for (const r of validCash) {
      addTransaction({
        date: r.date,
        type: r.type,
        amount: r.amount,
        category: r.category,
        ...sidesFor(r.type, accountForRow(r)),
        /*
         * A repayment has a far side: the debt it paid off. Given one, the
         * balance owed comes down by the amount — the same thing the monthly
         * checklist does, so a loan payment lands the same way whichever door
         * it came through.
         */
        ...(r.debtAccountId ? { destinationAccountId: r.debtAccountId } : {}),
        payee: r.payee.trim(),
        note: r.note,
      });
      /*
       * A category the user corrected is remembered against the merchant, so
       * the same shop is filed correctly next month without being asked again.
       */
      if (r.category !== r.suggestedCategory) {
        setMerchantRule(r.payee, r.category);
        learned += 1;
      }
    }

    /*
     * Corporate actions run first. They decide what the shares cost, and the
     * sale that follows in the same file is measured against that: applied
     * afterwards, the gain would be computed from a basis that did not exist
     * yet.
     */
    let actionsApplied = 0;
    for (const action of actions.filter((a) => a.include)) {
      const parent = holdingFor(action.from, action.registration);
      const applied = applyAction(action, parent);
      if (!applied || !parent) continue;
      if (applied.parent) {
        updateHolding(parent.id, {
          ...parent,
          avgCost: applied.parent.avgCostCAD,
          // The exact CAD figure, not one re-derived from today's rate: this
          // basis was fixed when the parent shares were bought.
          avgCostCADOverride: applied.parent.avgCostCAD,
          shares: action.kind === "merger" ? 0 : parent.shares,
        });
      }
      const existingChild = holdingFor(applied.child.ticker, action.registration);
      if (existingChild) {
        updateHolding(existingChild.id, {
          ...existingChild,
          shares: existingChild.shares + applied.child.shares,
          avgCost: applied.child.avgCostCAD,
          avgCostCADOverride: applied.child.avgCostCAD,
          flows: [...(existingChild.flows ?? []), applied.child.flow],
        });
      } else {
        addHolding({
          ticker: applied.child.ticker,
          name: applied.child.ticker,
          assetClass: parent.assetClass,
          shares: applied.child.shares,
          avgCost: applied.child.avgCostCAD,
          avgCostCADOverride: applied.child.avgCostCAD,
          // No price of its own yet: the feed fills it in on the next refresh,
          // and until then what it cost is the best figure available.
          price: applied.child.avgCostCAD,
          dividendsReceived: 0,
          accountId: parent.accountId,
          currency: parent.currency,
          flows: [applied.child.flow],
        });
      }
      actionsApplied += 1;
    }

    const { positions, cashDeltas, transfers } = accumulatePositions(
      includedTrades,
      accountIdFor,
      holdings,
    );
    let created = 0;
    let updated = 0;
    for (const pos of positions) {
      const input = positionToHolding(pos);
      if (pos.existing) {
        updateHolding(pos.existing.id, input);
        updated++;
      } else if (input.shares > 0 || pos.everHeld) {
        addHolding(input);
        created++;
      }
    }
    for (const t of transfers) {
      const from = t.deposit ? cashAccountId : t.accountId;
      const to = t.deposit ? t.accountId : cashAccountId;
      const label = REGISTRATION_LABELS[t.registration];
      if (from && to && from !== to) {
        addTransaction({
          date: t.date,
          type: "transfer",
          amount: t.amount,
          category: TRANSFER_CATEGORY,
          sourceAccountId: from,
          destinationAccountId: to,
          payee: t.deposit ? `Deposit to ${label}` : `Withdrawal from ${label}`,
          note: `Imported: ${label} ${t.deposit ? "deposit" : "withdrawal"}`,
        });
      }
    }
    for (const [id, delta] of cashDeltas) {
      adjustAccountCash(id, Math.round(delta * 100) / 100);
    }

    setResult({
      transactions: validCash.length,
      created,
      updated,
      transfers: transfers.length,
      learned,
      actions: actionsApplied,
    });
    setFiles([]);
    setCashRows([]);
    setTradeRows([]);
    setActions([]);
    setStep("done");
  };

  if (!ready) return <PageSkeleton />;

  return (
    <Shell
      title="Import"
      subtitle="Card statements, account activity and trade history — one place, any of them"
    >
      <div className="space-y-4">
        {step === "upload" && (
          <Card className="p-6">
            <h3 className="text-sm font-semibold">Drop your exports</h3>
            <p className="mt-1 text-xs text-ink-faint">
              Each file is read for what it holds: a card statement becomes
              spending, an account activity export becomes income, transfers,
              trades and dividends at once.
            </p>

            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              className={cn(
                "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
                dragOver
                  ? "border-brand bg-brand/5"
                  : "border-line bg-surface hover:border-brand/50",
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Upload size={18} />
              </span>
              <p className="text-sm font-medium">
                {busy ? "Reading…" : "Drop CSV files here, or click to browse"}
              </p>
              <p className="text-xs text-ink-faint">
                Several at once is fine — duplicates between them are caught
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {files.length > 0 && (
              <ul className="mt-4 space-y-2">
                {files.map((f) => (
                  <li
                    key={f.fileName}
                    className="flex items-start gap-3 rounded-lg border border-line bg-elevated/40 px-3 py-2"
                  >
                    <FileText size={15} className="mt-0.5 shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{f.fileName}</p>
                      <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                        {f.error ? (
                          <span className="text-negative">{f.error}</span>
                        ) : (
                          <>
                            Read as {labelFor(f.kind)} · {f.cash.length} cash row
                            {f.cash.length === 1 ? "" : "s"}, {f.trades.length} security
                            row{f.trades.length === 1 ? "" : "s"}
                            {f.skipped.map((s) => `, ${s.count} ${s.reason} skipped`)}
                            {/*
                              * Said out loud, because it is a decision the app
                              * made about the file rather than something the
                              * file stated. If it read the signs the wrong way
                              * round every row is inverted, and this line is
                              * where that is visible before anything is saved.
                              */}
                            {f.signs ? (
                              <span className="mt-0.5 block">
                                {describeSigns(f.signs)}
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${f.fileName}`}
                      onClick={() => removeFile(f.fileName)}
                    >
                      <X size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {cashRows.length + tradeRows.length > 0 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-ink-dim">
                  {cashRows.length} cash row{cashRows.length === 1 ? "" : "s"} ·{" "}
                  {tradeRows.length} security row{tradeRows.length === 1 ? "" : "s"}
                </p>
                <Button onClick={() => setStep("review")}>
                  Review <ArrowRight size={14} />
                </Button>
              </div>
            )}
          </Card>
        )}

        {step === "review" && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card className="p-3">
                <p className="text-[0.6875rem] font-medium text-ink-dim">Money in</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-positive">
                  {fmtCAD(
                    includedCash
                      .filter((r) => r.type === "income")
                      .reduce((s, r) => s + r.amount, 0),
                  )}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[0.6875rem] font-medium text-ink-dim">Money out</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-negative">
                  {fmtCAD(
                    includedCash
                      .filter((r) => r.type === "expense")
                      .reduce((s, r) => s + r.amount, 0),
                  )}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[0.6875rem] font-medium text-ink-dim">Trades</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">
                  {includedTrades.filter((r) => r.type === "buy" || r.type === "sell").length}
                </p>
              </Card>
              <Card className="p-3">
                <p className="text-[0.6875rem] font-medium text-ink-dim">Already known</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-ink-faint">
                  {dupCash + dupTrades}
                </p>
              </Card>
            </div>

            {(needsAttention.length > 0 ||
              unmatchedRegistrations.length > 0 ||
              unassignedDebt.length > 0) && (
              <Card className="border-amber-500/40 bg-amber-500/5 p-4">
                <p className="flex items-center gap-2 text-xs font-medium text-amber-400">
                  <AlertTriangle size={14} /> Needs a person
                </p>
                <ul className="mt-2 space-y-1 text-[0.6875rem] text-ink-dim">
                  {unassignedDebt.length > 0 && (
                    <li>
                      {unassignedDebt.length} debt{" "}
                      {unassignedDebt.length === 1 ? "repayment has" : "repayments have"}{" "}
                      no debt chosen — pick one below and the balance owed comes
                      down with the payment. Left blank, the money leaves the
                      account and the debt stays where it is.
                    </li>
                  )}
                  {unmatchedRegistrations.map((r) => (
                    <li key={r}>
                      No account is marked {REGISTRATION_LABELS[r]} — those trades cannot
                      be filed until one is.
                    </li>
                  ))}
                  {needsAttention.map((n) => (
                    <li key={n}>{n} — share counts changed outside a trade, adjust the position by hand.</li>
                  ))}
                </ul>
              </Card>
            )}

            {files.some((f) => f.cash.length > 0) && (
              <Card>
                <CardHeader
                  title="Which account is each file about?"
                  subtitle="A card statement is one account; an activity export names its own"
                />
                <ul className="space-y-2 px-5 pb-5">
                  {files
                    .filter((f) => f.cash.length > 0)
                    .map((f) => (
                      <li
                        key={f.fileName}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-elevated/40 px-3 py-2"
                      >
                        <FileText size={14} className="shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {f.fileName}
                          <span className="ml-2 text-[0.6875rem] text-ink-faint">
                            {labelFor(f.kind)} · {f.cash.length} row
                            {f.cash.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        <Select
                          value={accountForFile(f.fileName)}
                          onChange={(e) =>
                            setFileAccounts((prev) => ({
                              ...prev,
                              [f.fileName]: e.target.value,
                            }))
                          }
                          className="h-8 w-auto py-0 text-xs"
                          aria-label={`Account for ${f.fileName}`}
                        >
                          <option value={MATCH_THE_FILE}>
                            Match the file (chequing and investments)
                          </option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </Select>
                      </li>
                    ))}
                </ul>
              </Card>
            )}

            {cashRows.length > 0 && (
              <Card>
                <CardHeader
                  title="Money in and out"
                  subtitle="Change a category and it is remembered for that merchant"

                />
                <div className="max-h-[28rem] overflow-auto px-3 pb-4">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                      <tr>
                        <th className="px-2 py-2 text-left">Include</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Payee</th>
                        <th className="px-2 py-2 text-left">Type</th>
                        <th className="px-2 py-2 text-left">Category</th>
                        <th className="px-2 py-2 text-left">Account</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashRows.map((r) => (
                        <tr
                          key={r.id}
                          className={cn(
                            "border-b border-line/60 last:border-0",
                            !r.include && "opacity-40",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => updateCash(r.id, { include: e.target.checked })}
                              aria-label={`Include ${r.payee}`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-ink-dim">{r.date}</td>
                          <td className="max-w-[16rem] truncate px-2 py-1.5" title={r.payee}>
                            {r.payee}
                            {r.dup && (
                              <Badge className="ml-2 text-[0.5625rem]">already have it</Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <Select
                              value={r.type}
                              onChange={(e) =>
                                changeType(r, e.target.value as ImportedRow["type"])
                              }
                              className="h-7 w-auto py-0 text-[0.6875rem]"
                              aria-label={`Type for ${r.payee}`}
                            >
                              <option value="expense">Expense</option>
                              <option value="income">Income</option>
                            </Select>
                          </td>
                          <td className="px-2 py-1.5">
                            <Select
                              value={r.category}
                              onChange={(e) => updateCash(r.id, { category: e.target.value })}
                              className={cn(
                                "h-7 w-auto py-0 text-[0.6875rem]",
                                !r.confident && "border-amber-500/50",
                              )}
                              aria-label={`Category for ${r.payee}`}
                            >
                              {/*
                                * The shared list, not a copy of it. The copy
                                * that stood here had already drifted — it was
                                * missing Freelance — so a row suggested as
                                * Freelance could not have been left that way.
                                */}
                              {alphabetical(
                                r.type === "income"
                                  ? INCOME_CATEGORIES
                                  : userCategories,
                              ).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </Select>
                            {r.type === "expense" &&
                            r.category === DEBT_CATEGORY &&
                            debts.length > 0 ? (
                              <Select
                                value={r.debtAccountId ?? ""}
                                onChange={(e) =>
                                  updateCash(r.id, { debtAccountId: e.target.value })
                                }
                                aria-label={`Debt paid by ${r.payee}`}
                                className={cn(
                                  "mt-1 h-7 w-auto py-0 text-[0.6875rem]",
                                  !r.debtAccountId && "border-amber-500/50",
                                )}
                              >
                                <option value="">Which debt?</option>
                                {debts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </Select>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-[0.6875rem] text-ink-faint">
                            {accounts.find((a) => a.id === accountForRow(r))?.name ?? "—"}
                          </td>
                          <td
                            className={cn(
                              "whitespace-nowrap px-2 py-1.5 text-right tabular-nums",
                              r.type === "income" ? "text-positive" : "text-ink",
                            )}
                          >
                            {r.type === "income" ? "+" : "−"}
                            {fmtCAD(r.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {actions.length > 0 && (
              <Card>
                <CardHeader
                  title="Mergers and demergers"
                  subtitle="A share of the parent's cost basis follows the new shares — the company publishes the split"
                />
                <ul className="space-y-3 px-5 pb-5">
                  {actions.map((a) => {
                    const parent = holdingFor(a.from, a.registration);
                    const applied = applyAction(a, parent);
                    return (
                      <li
                        key={a.id}
                        className={cn(
                          "rounded-lg border border-line bg-elevated/40 p-3",
                          !a.include && "opacity-40",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <input
                            type="checkbox"
                            checked={a.include}
                            onChange={(e) =>
                              updateAction(a.id, { include: e.target.checked })
                            }
                            aria-label={`Include ${a.from} ${a.kind}`}
                          />
                          <span className="text-xs font-medium">
                            {a.date} · {a.from} → {a.to}
                          </span>
                          <span className="text-[0.6875rem] text-ink-faint">
                            {a.registration
                              ? REGISTRATION_LABELS[a.registration]
                              : a.registrationRaw}
                          </span>
                          {a.kind === "demerger" && (
                            <label className="ml-auto flex items-center gap-2 text-[0.6875rem] text-ink-dim">
                              Cost basis moving
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={a.allocationPct}
                                onChange={(e) =>
                                  updateAction(a.id, {
                                    allocationPct: Number(e.target.value) || 0,
                                  })
                                }
                                className="h-7 w-20 py-0 text-right text-[0.6875rem]"
                                aria-label={`Percentage of ${a.from} cost basis moving to ${a.to}`}
                              />
                              %
                            </label>
                          )}
                        </div>
                        <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-faint">
                          {parent
                            ? describeAction(a, applied?.movedBasis ?? 0)
                            : `No ${a.from} position in this account to divide — add it first, or leave this out.`}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {checkedTrades.length > 0 && (
              <Card>
                <CardHeader
                  title="Trades and dividends"
                  subtitle="Filed by the account each one settled in"
                />
                <div className="max-h-[28rem] overflow-auto px-3 pb-4">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                      <tr>
                        <th className="px-2 py-2 text-left">Include</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">What</th>
                        <th className="px-2 py-2 text-left">Account</th>
                        <th className="px-2 py-2 text-right">Quantity</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checkedTrades.map((r) => (
                        <tr
                          key={r.id}
                          className={cn(
                            "border-b border-line/60 last:border-0",
                            !r.include && "opacity-40",
                          )}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => updateTrade(r.id, { include: e.target.checked })}
                              aria-label={`Include ${r.ticker}`}
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-ink-dim">{r.date}</td>
                          <td className="px-2 py-1.5">
                            <span className="font-medium">{r.ticker}</span>{" "}
                            <span className="text-ink-faint">{r.type ?? r.typeRaw}</span>
                            {r.duplicate && (
                              <Badge className="ml-2 text-[0.5625rem]">already have it</Badge>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-ink-dim">
                            {r.registration
                              ? REGISTRATION_LABELS[r.registration]
                              : r.registrationRaw || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-ink-dim">
                            {r.quantity || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                            {fmtCAD(r.amountCad)}
                            {r.currency === "USD" && (
                              <span className="ml-1 text-[0.625rem] text-info">USD</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <Button variant="secondary" onClick={() => setStep("upload")}>
                <ArrowLeft size={14} /> Back
              </Button>
              <Button
                onClick={save}
                disabled={includedCash.length + includedTrades.length === 0}
              >
                Import {includedCash.length + includedTrades.length} row
                {includedCash.length + includedTrades.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <Card className="p-8">
            <EmptyState
              icon={<CheckCircle2 size={20} className="text-positive" />}
              title="Imported"
              subtitle={[
                `${result.transactions} transaction${result.transactions === 1 ? "" : "s"}`,
                `${result.created} new position${result.created === 1 ? "" : "s"}`,
                `${result.updated} updated`,
                `${result.transfers} transfer${result.transfers === 1 ? "" : "s"}`,
                result.actions > 0
                  ? `${result.actions} corporate action${result.actions === 1 ? "" : "s"}`
                  : "",
                result.learned > 0
                  ? `${result.learned} categor${result.learned === 1 ? "y" : "ies"} remembered`
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <div className="flex justify-center">
              <Button
                onClick={() => {
                  setResult(null);
                  setStep("upload");
                }}
              >
                Import more
              </Button>
            </div>
          </Card>
        )}

        {step === "upload" && files.length === 0 && (
          <Card className="p-4">
            <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
              <Trash2 size={11} className="mr-1 inline" />
              Nothing is written until you press Import on the review screen, and
              rows that match something already recorded arrive switched off.
            </p>
          </Card>
        )}
      </div>
    </Shell>
  );
}
