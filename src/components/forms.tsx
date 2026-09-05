"use client";

import { useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import { Check, Loader2, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import {
  ACCOUNT_KINDS,
  ACCOUNT_KIND_LABELS,
  ASSET_CLASSES,
  CURRENCIES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_LABELS,
  REGISTRATIONS,
  REGISTRATION_LABELS,
  TRANSFER_CATEGORY,
  Account,
  AccountKind,
  AssetClass,
  Currency,
  CashFlow,
  Holding,
  INCOME_CATEGORIES,
  alphabetical,
  RecurrenceFrequency,
  RecurringRule,
  Registration,
  Transaction,
  TxnType,
  isInvestmentAccount,
  isPension,
  supportsRegistration,
  transactionEndpoints,
} from "@/lib/types";
import { fmtCAD, todayISO } from "@/lib/format";
import { holdingAfterFlowEdit, type TradeRecord } from "@/lib/flows";
import { roundMoney } from "@/lib/money";
import { useFinance } from "@/lib/store";
import { useTickerValidation } from "@/lib/hooks";
import { isCoinTicker } from "@/lib/market";
import {
  isBlankTrade,
  newPositionsNeeded,
  planTrades,
  type TradeBatch,
  type TradeInput,
} from "@/lib/trade-batch";
import { Button, Field, Input, Modal, Segmented, Select } from "./ui";

function FormActions({
  onCancel,
  label = "Save",
  destructive,
}: {
  onCancel: () => void;
  label?: string;
  /** Sits apart on the left, well away from the button people mean to press. */
  destructive?: ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-2">
      <div>{destructive}</div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="whitespace-nowrap">
          Cancel
        </Button>
        <Button type="submit" className="whitespace-nowrap">
          {label}
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Transaction ---------------- */

export function TransactionForm({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Transaction | null;
}) {
  // Modal renders children only when open, so the inner form remounts
  // (fresh state) every time it opens; key guards against stale edits.
  if (initial) {
    return (
      <Modal open={open} onClose={onClose} title="Edit transaction">
        <TransactionFormInner key={initial.id} initial={initial} onClose={onClose} />
      </Modal>
    );
  }
  return <AddTransactionModal open={open} onClose={onClose} />;
}

/**
 * Adding something to the record: once, or on a schedule.
 *
 * The two used to be separate — a button for one and a card further down the
 * page for the other — which put the question "does this repeat?" a scroll
 * away from the moment it is asked. They are the same intention with one
 * detail different, so they are one dialog with the difference at the top of
 * it, and the rules that already exist are listed where they can be changed
 * rather than only where they can be admired.
 *
 * Editing an existing transaction skips all of this: a row that is already
 * recorded cannot become a rule, so offering the choice would be a question
 * with no answer.
 */
function AddTransactionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"once" | "repeat">("once");
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const accounts = useFinance((s) => s.accounts);
  const recurring = useFinance((s) => s.recurring);
  const deleteRecurring = useFinance((s) => s.deleteRecurring);

  if (!open) return null;
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Unknown";

  return (
    <Modal open onClose={onClose} title="Add to the record" size="lg">
      <div className="mb-4">
        <Segmented<"once" | "repeat">
          options={[
            { value: "once", label: "Once" },
            { value: "repeat", label: "Repeating" },
          ]}
          value={mode}
          onChange={(v) => {
            setMode(v);
            setEditingRule(null);
            setConfirming(null);
          }}
        />
      </div>

      {mode === "once" ? (
        <TransactionFormInner initial={null} onClose={onClose} />
      ) : (
        <div className="space-y-4">
          {/*
            * The rules already standing, above the form that writes another.
            * A rule posts payments on its own, so being unable to find one is
            * worse than being unable to write one — this is the only place
            * either can be done.
            */}
          {recurring.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-ink-dim">Already repeating</p>
              {recurring.map((r) => {
                const { from, to } = transactionEndpoints(r, nameOf);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <Repeat size={13} className="shrink-0 text-ink-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.payee}</p>
                      <p className="truncate text-[0.6875rem] text-ink-faint">
                        {RECURRENCE_LABELS[r.frequency]} · {from} → {to}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {fmtCAD(r.amount)}
                    </span>
                    {confirming === r.id ? (
                      <>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            deleteRecurring(r.id);
                            setConfirming(null);
                            if (editingRule?.id === r.id) setEditingRule(null);
                          }}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming(null)}
                        >
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${r.payee}`}
                          onClick={() => setEditingRule(r)}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Stop ${r.payee}`}
                          onClick={() => setConfirming(r.id)}
                          className="hover:text-negative"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-ink-dim">
                {editingRule ? `Editing ${editingRule.payee}` : "New rule"}
              </p>
              {editingRule && (
                <Button variant="ghost" size="sm" onClick={() => setEditingRule(null)}>
                  <Plus size={13} /> New instead
                </Button>
              )}
            </div>
            <RecurringFormInner
              key={editingRule?.id ?? "new"}
              initial={editingRule}
              onClose={() => (editingRule ? setEditingRule(null) : onClose())}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function TransactionFormInner({
  initial,
  onClose,
}: {
  initial: Transaction | null;
  onClose: () => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const addTransaction = useFinance((s) => s.addTransaction);
  const updateTransaction = useFinance((s) => s.updateTransaction);
  const userCategories = useFinance((s) => s.categories);

  const firstCategory = (t: TxnType) =>
    t === "income" ? INCOME_CATEGORIES[0] : userCategories[0] ?? "Other";
  const optionsFor = (t: TxnType): readonly string[] =>
    alphabetical(t === "income" ? INCOME_CATEGORIES : userCategories);

  const [type, setType] = useState<TxnType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [category, setCategory] = useState(
    initial?.category ?? firstCategory(initial?.type ?? "expense"),
  );
  const [sourceAccountId, setSourceAccountId] = useState(
    initial?.sourceAccountId ?? accounts[0]?.id ?? "",
  );
  const [destinationAccountId, setDestinationAccountId] = useState(
    initial?.destinationAccountId ?? accounts[0]?.id ?? "",
  );
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");

  const switchType = (t: TxnType) => {
    setType(t);
    if (initial) return;
    setCategory(t === "transfer" ? TRANSFER_CATEGORY : firstCategory(t));
    // A transfer needs two distinct accounts; nudge the destination off the
    // source so the form does not open in an invalid state.
    if (t === "transfer" && destinationAccountId === sourceAccountId) {
      const other = accounts.find((a) => a.id !== sourceAccountId);
      if (other) setDestinationAccountId(other.id);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0)
      return setError("Amount must be greater than zero.");
    if (type !== "transfer" && !payee.trim())
      return setError("Please enter a payee or source.");
    if (type !== "income" && !sourceAccountId)
      return setError("Please choose the account the money came from.");
    if (type !== "expense" && !destinationAccountId)
      return setError("Please choose the account the money went to.");
    if (type === "transfer" && sourceAccountId === destinationAccountId)
      return setError("A transfer needs two different accounts.");

    const source = accounts.find((a) => a.id === sourceAccountId);
    const destination = accounts.find((a) => a.id === destinationAccountId);
    const payload = {
      date,
      type,
      amount: Math.round(amt * 100) / 100,
      category: type === "transfer" ? TRANSFER_CATEGORY : category,
      sourceAccountId: type === "income" ? undefined : sourceAccountId,
      destinationAccountId: type === "expense" ? undefined : destinationAccountId,
      payee:
        type === "transfer"
          ? payee.trim() ||
            `${source?.name ?? "Account"} → ${destination?.name ?? "Account"}`
          : payee.trim(),
      note: note.trim() || undefined,
    };
    if (initial) updateTransaction(initial.id, payload);
    else addTransaction(payload);
    onClose();
  };

  const accountOptions = (exclude?: string) =>
    accounts
      .filter((a) => a.id !== exclude)
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ));

  return (
    <form onSubmit={submit}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["expense", "income", "transfer"] as TxnType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchType(t)}
            className={
              "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors " +
              (type === t
                ? t === "income"
                  ? "border-positive/60 bg-positive/10 text-positive"
                  : t === "transfer"
                    ? "border-brand/60 bg-brand/10 text-brand"
                    : "border-negative/60 bg-negative/10 text-negative"
                : "border-line bg-elevated text-ink-dim hover:text-ink")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {/* Where the money came from */}
        {type === "income" ? (
          <Field label="From" hint="Outside your accounts">
            <Input
              placeholder="Employer, client…"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="From account" hint="Balance adjusts automatically">
            <Select
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
            >
              {accountOptions()}
            </Select>
          </Field>
        )}

        {/* Where it went */}
        {type === "expense" ? (
          <Field label="To" hint="Outside your accounts">
            <Input
              placeholder="Merchant…"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="To account" hint="Balance adjusts automatically">
            <Select
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
            >
              {accountOptions(type === "transfer" ? sourceAccountId : undefined)}
            </Select>
          </Field>
        )}

        {type === "transfer" ? (
          <Field label="Description (optional)" hint="Defaults to “From → To”">
            <Input
              placeholder="TFSA contribution"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {optionsFor(type).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Note (optional)">
          <Input
            placeholder="Anything worth remembering"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      {type === "transfer" ? (
        <p className="mt-3 text-[0.6875rem] text-ink-faint">
          Transfers move money between your own accounts, so they are left out
          of income, spending and budgets.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      <FormActions onCancel={onClose} label={initial ? "Save changes" : "Add transaction"} />
    </form>
  );
}

/* ---------------- Account ---------------- */

export function AccountForm({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Account | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit account" : "New account"}>
      <AccountFormInner key={initial?.id ?? "new"} initial={initial ?? null} onClose={onClose} />
    </Modal>
  );
}

/** A number if one was typed, and nothing at all if the box was left empty. */
function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function AccountFormInner({
  initial,
  onClose,
}: {
  initial: Account | null;
  onClose: () => void;
}) {
  const addAccount = useFinance((s) => s.addAccount);
  const updateAccount = useFinance((s) => s.updateAccount);

  const [name, setName] = useState(initial?.name ?? "");
  const [institution, setInstitution] = useState(initial?.institution ?? "");
  const [kind, setKind] = useState<AccountKind>(initial?.kind ?? "checking");
  const [registration, setRegistration] = useState<Registration>(
    initial?.registration ?? "non-registered",
  );
  const [balance, setBalance] = useState(initial ? String(initial.balance) : "");
  const [balanceUSD, setBalanceUSD] = useState(
    initial?.balanceUSD ? String(initial.balanceUSD) : "",
  );
  const [pensionAnnual, setPensionAnnual] = useState(
    initial?.pensionAnnual ? String(initial.pensionAnnual) : "",
  );
  const [pensionService, setPensionService] = useState(
    initial?.pensionService ? String(initial.pensionService) : "",
  );
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bal = Number(balance);
    const usd = balanceUSD.trim() === "" ? 0 : Number(balanceUSD);
    if (!name.trim()) return setError("Please name the account.");
    if (!Number.isFinite(bal)) return setError("Balance must be a number.");
    if (!Number.isFinite(usd)) return setError("US balance must be a number.");
    const payload = {
      name: name.trim(),
      institution: institution.trim() || "—",
      kind,
      balance: Math.round(bal * 100) / 100,
      // Only investment accounts settle trades in a second currency; asking
      // every chequing account for a US balance would be noise.
      balanceUSD: isInvestmentAccount(kind) ? Math.round(usd * 100) / 100 : 0,
      // Debts and property are never sheltered, so the field is not stored
      // for them at all rather than being stored as a meaningless default.
      registration: supportsRegistration(kind) ? registration : undefined,
      // Only a pension has these, and only once the statement has been read.
      pensionAnnual: isPension(kind) ? numberOrUndefined(pensionAnnual) : undefined,
      pensionService: isPension(kind) ? numberOrUndefined(pensionService) : undefined,
    };
    if (initial) updateAccount(initial.id, payload);
    else addAccount(payload);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Travel Savings"
            autoFocus
          />
        </Field>
        <Field label="Institution">
          <Input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="e.g. Chase"
          />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        {supportsRegistration(kind) ? (
          <Field label="Registration" hint="Tax treatment of the account">
            <Select
              value={registration}
              onChange={(e) => setRegistration(e.target.value as Registration)}
            >
              {REGISTRATIONS.map((r) => (
                <option key={r} value={r}>
                  {REGISTRATION_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field
          label={
            isPension(kind)
              ? "Transfer value"
              : isInvestmentAccount(kind)
                ? "Cash balance (CAD)"
                : "Current balance"
          }
          hint={
            isPension(kind)
              ? "The lump sum the plan would pay out — update it at month end"
              : isInvestmentAccount(kind)
                ? "Uninvested cash only — holdings are valued separately"
                : "For credit cards & loans, enter the amount owed"
          }
        >
          <Input
            type="number"
            step="0.01"
            min="0"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        {isPension(kind) ? (
          <>
            <Field
              label="Annual pension earned"
              hint="From your statement — the yearly income earned so far"
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={pensionAnnual}
                onChange={(e) => setPensionAnnual(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Pensionable service" hint="Years credited, from your statement">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={pensionService}
                onChange={(e) => setPensionService(e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </>
        ) : null}
        {isInvestmentAccount(kind) ? (
          <Field
            label="Cash balance (USD)"
            hint="Held as US dollars — converted for totals, not on the way in"
          >
            <Input
              type="number"
              step="0.01"
              min="0"
              value={balanceUSD}
              onChange={(e) => setBalanceUSD(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      <FormActions onCancel={onClose} label={initial ? "Save changes" : "Add account"} />
    </form>
  );
}

/* ---------------- Holding ---------------- */

export function HoldingForm({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Holding | null;
}) {
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit holding" : "New holding"}>
      <HoldingFormInner key={initial?.id ?? "new"} initial={initial ?? null} onClose={onClose} />
    </Modal>
  );
}

function HoldingFormInner({
  initial,
  onClose,
}: {
  initial: Holding | null;
  onClose: () => void;
}) {
  const addHolding = useFinance((s) => s.addHolding);
  const updateSecurity = useFinance((s) => s.updateSecurity);
  const deleteHolding = useFinance((s) => s.deleteHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));

  /*
   * Which accounts an edit will reach. Shown rather than assumed: renaming a
   * ticker held in four accounts touches all four, and the form should say so
   * before the save, not after.
   */
  const lotsOfSecurity = initial
    ? holdings.filter(
        (h) => h.ticker.toUpperCase() === initial.ticker.toUpperCase(),
      )
    : [];
  /*
   * Deletion is the one thing on this form that is per-account, so it names
   * the account it will empty and lets you pick a different one. Without the
   * picker the only reachable lot was whichever the row happened to open with.
   */
  const [deleteAccountId, setDeleteAccountId] = useState(initial?.accountId ?? "");
  const deleteTarget =
    lotsOfSecurity.find((h) => h.accountId === deleteAccountId) ?? initial;

  const heldIn = initial
    ? [
        ...new Set(
          holdings
            .filter((h) => h.ticker.toUpperCase() === initial.ticker.toUpperCase())
            .map(
              (h) =>
                accounts.find((a) => a.id === h.accountId)?.name ?? "an account",
            ),
        ),
      ]
    : [];

  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(
    initial?.assetClass ?? "US Equity",
  );
  const [shares, setShares] = useState(initial ? String(initial.shares) : "");
  const [avgCost, setAvgCost] = useState(initial ? String(initial.avgCost) : "");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [dividendsReceived, setDividendsReceived] = useState(
    initial ? String(initial.dividendsReceived ?? 0) : "0",
  );
  const [accountId, setAccountId] = useState(
    initial?.accountId ?? investmentAccounts[0]?.id ?? "",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [error, setError] = useState("");
  /*
   * Deleting asks twice, in place. A holding carries its whole cost basis and
   * dividend history, so this is not something to lose to a stray click — but a
   * nested modal inside this one would be worse than the two-step.
   */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { status: tickerStatus, price: fetchedPrice } = useTickerValidation(
    ticker,
    assetClass,
    currency,
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim()) return setError("Ticker is required.");
    if (!name.trim()) return setError("Please give the holding a name.");

    /*
     * Editing changes what the security *is* — its symbol, its name, the class
     * that decides which price feed quotes it. None of that is per-account, so
     * it is saved for every account holding the ticker at once. Shares and cost
     * stay out of it — they come from the trades — but the price can be set by
     * hand for a security the feed cannot quote.
     */
    if (initial) {
      const manual = Number(price);
      if (price.trim() !== "" && (!Number.isFinite(manual) || manual <= 0)) {
        return setError("Price must be greater than zero.");
      }
      updateSecurity(initial.ticker, {
        ticker: ticker.trim().toUpperCase(),
        name: name.trim(),
        assetClass,
        // Only sent when it actually moved: an untouched field should not
        // count as a manual override of a price the feed just set.
        price: manual !== initial.price && manual > 0 ? manual : undefined,
        currency,
      });
      onClose();
      return;
    }

    const sh = Number(shares);
    const cost = Number(avgCost);
    const px = Number(price);
    const divs = Number(dividendsReceived);
    if (!Number.isFinite(sh) || sh <= 0)
      return setError("Shares must be greater than zero.");
    if (!Number.isFinite(cost) || cost <= 0)
      return setError("Average cost must be greater than zero.");
    if (!Number.isFinite(px) || px <= 0)
      return setError("Price must be greater than zero.");
    if (!accountId)
      return setError(
        "Add an investment account first — every holding belongs to one.",
      );
    addHolding({
      ticker: ticker.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      shares: sh,
      avgCost: cost,
      price: px,
      dividendsReceived: Number.isFinite(divs) ? Math.max(0, divs) : 0,
      accountId,
      currency,
    });
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ticker">
          <div className="relative">
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="VTI"
              autoFocus
              className="uppercase pr-8"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              {tickerStatus === "loading" && (
                <Loader2 size={14} className="animate-spin text-ink-faint" />
              )}
              {tickerStatus === "valid" && (
                <Check size={14} className="text-positive" />
              )}
              {tickerStatus === "invalid" && ticker.trim() && (
                <X size={14} className="text-negative" />
              )}
              {tickerStatus === "unknown" && ticker.trim() && (
                <span className="text-[0.75rem] text-ink-faint">?</span>
              )}
            </span>
          </div>
          {tickerStatus === "valid" && fetchedPrice != null && (
            <p className="mt-1 text-[0.6875rem] text-positive">
              Price: {currency === "USD"
                ? `$${(fetchedPrice * usdCadRate).toLocaleString("en-CA", { minimumFractionDigits: 2 })} CAD`
                : `$${fetchedPrice.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`}
            </p>
          )}
          {tickerStatus === "invalid" && ticker.trim() && (
            <p className="mt-1 text-[0.6875rem] text-negative">
              Ticker not found — check the symbol and asset class
            </p>
          )}
          {tickerStatus === "unknown" && ticker.trim() && (
            <p className="mt-1 text-[0.6875rem] text-ink-faint">
              Could not check right now — the daily lookup allowance is used up
            </p>
          )}
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Vanguard ETF"
          />
        </Field>
        <Field label="Asset class">
          <Select
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          >
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {initial ? (
          <Field
            label={`Current price (${currency})`}
            hint="Replaced the next time the price feed quotes this security"
          >
            <Input
              type="number"
              step="any"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        ) : (
        <>
        <Field label="Shares / units">
          <Input
            type="number"
            step="any"
            min="0"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder="10"
          />
        </Field>
        <Field label="Average cost per share">
          <Input
            type="number"
            /*
             * A per-unit price, not a money total. Averaging buys over
             * fractional shares lands on fractions of a cent, and a 0.01 step
             * makes the browser reject the very value we stored — editing an
             * imported holding failed on its own average cost.
             */
            step="any"
            min="0"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Current price" hint="Used for the latest data point">
          <Input
            type="number"
            step="any"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Dividends received (total)" hint="Total cash dividends over the life of this position">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={dividendsReceived}
            onChange={(e) => setDividendsReceived(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field
          label="Account"
          hint={
            investmentAccounts.length === 0
              ? "No investment accounts yet — add one on the Accounts page"
              : "Its registration decides the tax treatment"
          }
        >
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {investmentAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {/* Only worth appending when it adds something the name does
                    not already say — an account called "TFSA" needs no suffix. */}
                {a.registration &&
                a.registration !== "non-registered" &&
                a.registration !== a.name
                  ? ` · ${a.registration}`
                  : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Holding["currency"])}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        </>
        )}
      </div>
      {initial ? (
        <p className="mt-3 text-[0.6875rem] text-ink-faint">
          {heldIn.length > 1
            ? `Saved for all ${heldIn.length} accounts holding ${initial.ticker}: ${heldIn.join(", ")}. `
            : ""}
          Shares and cost come from your trades — use{" "}
          <span className="text-ink-dim">Log trades</span> to change a position.
        </p>
      ) : (
        <p className="mt-3 text-[0.6875rem] text-ink-faint">
          This records a position you already hold, so the account&rsquo;s cash
          balance is left alone. Use{" "}
          <span className="text-ink-dim">Import trades</span>
          {" "}to enter a purchase, which pays for the shares out of that cash.
        </p>
      )}
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      {/*
        * The confirm step gets its own panel rather than a slot in the footer
        * row: an account picker and two buttons do not fit beside Cancel and
        * Save, and cramming them there wrapped the labels mid-word.
        */}
      {initial && confirmingDelete ? (
        <div className="mt-4 rounded-lg border border-negative/40 bg-negative/5 p-3">
          <p className="text-xs text-ink-dim">
            Delete this position and everything behind it — its cost basis, its
            dividends, its trade history. The security stays in your other
            accounts.
          </p>
          {/*
            * Picker on its own row, buttons below it: at this modal's width
            * the three could not share a line without the last one wrapping
            * away on its own.
            */}
          <div className="mt-2 space-y-2">
            {lotsOfSecurity.length > 1 ? (
              <Select
                value={deleteAccountId}
                onChange={(e) => setDeleteAccountId(e.target.value)}
                className="h-9 w-full py-0 text-xs"
                aria-label="Account to delete this position from"
              >
                {lotsOfSecurity.map((lot) => (
                  <option key={lot.id} value={lot.accountId}>
                    {accounts.find((a) => a.id === lot.accountId)?.name ??
                      "Account"}
                    {lot.shares > 0
                      ? ` · ${lot.shares.toLocaleString("en-US")} share${
                          lot.shares === 1 ? "" : "s"
                        }`
                      : " · closed"}
                  </option>
                ))}
              </Select>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="text-xs text-ink-faint underline-offset-2 hover:underline"
                onClick={() => setConfirmingDelete(false)}
              >
                Keep it
              </button>
              <Button
                type="button"
                variant="danger"
                disabled={!deleteTarget}
                className="whitespace-nowrap"
                onClick={() => {
                  if (!deleteTarget) return;
                  deleteHolding(deleteTarget.id);
                  onClose();
                }}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      <FormActions
        onCancel={onClose}
        label={initial ? "Save changes" : "Add holding"}
        destructive={
          initial && !confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-xs text-ink-faint transition-colors hover:text-negative"
            >
              {/* Everything else on this form is ticker-wide; deletion is not,
                  so it says which account it empties. */}
              {lotsOfSecurity.length > 1
                ? "Delete from one account…"
                : `Delete from ${
                    accounts.find((a) => a.id === initial.accountId)?.name ??
                    "this account"
                  }`}
            </button>
          ) : undefined
        }
      />
    </form>
  );
}

/* ---------------- Trade batch entry ---------------- */

type TradeAction = "buy" | "sell" | "dividend" | "reward";

interface TradeRow {
  id: string;
  date: string;
  action: TradeAction;
  ticker: string;
  quantity: string;
  price: string;
  accountId: string;
  currency: string;
  cadAmount: string; // CAD equivalent for USD trades
}

function emptyRow(): TradeRow {
  return {
    id: crypto.randomUUID(),
    date: todayISO(),
    action: "buy",
    ticker: "",
    quantity: "",
    price: "",
    accountId: "",
    currency: "CAD",
    cadAmount: "",
  };
}

function TradeTickerInput({
  row,
  update,
}: {
  row: TradeRow;
  update: (id: string, field: keyof TradeRow, value: string) => void;
}) {
  /*
   * The asset class picks the price feed, so guessing "US Equity" for a coin
   * sent BTC to the wrong provider and it came back rejected. The symbol is
   * all we have to go on here, and for coins it is enough.
   */
  const assetClass: AssetClass = isCoinTicker(row.ticker) ? "Crypto" : "US Equity";
  // Only the status is used: the tick says the ticker is real, and the price
  // belongs in the row's own price field, not crowded into the input.
  const { status } = useTickerValidation(row.ticker, assetClass, row.currency as Currency);

  return (
    <div className="relative">
      <Input
        value={row.ticker}
        onChange={(e) => update(row.id, "ticker", e.target.value)}
        placeholder="VTI"
        className="uppercase pr-7"
      />
      <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">
        {status === "loading" && (
          <Loader2 size={12} className="animate-spin text-ink-faint" />
        )}
        {status === "valid" && <Check size={12} className="text-positive" />}
        {status === "invalid" && row.ticker.trim() && (
          <X size={12} className="text-negative" />
        )}
        {status === "unknown" && row.ticker.trim() && (
          <span
            className="text-[0.6875rem] text-ink-faint"
            title="Could not check this ticker — the daily lookup allowance is used up. The trade will still record."
          >
            ?
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Details we cannot infer for a ticker nobody has held before. The trade row
 * carries the numbers; this carries the identity, and it is asked for once,
 * on submit, rather than up front in a separate "add holding" form.
 */
interface NewHoldingMeta {
  ticker: string;
  name: string;
  assetClass: AssetClass;
}

/** A trailing row the user has not touched yet is not a trade. */
const isBlankRow = isBlankTrade;

function NewHoldingDetails({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: NewHoldingMeta[];
  onCancel: () => void;
  onConfirm: (meta: NewHoldingMeta[]) => void;
}) {
  const [meta, setMeta] = useState<NewHoldingMeta[]>(pending);

  const set = (ticker: string, field: keyof NewHoldingMeta, value: string) =>
    setMeta((prev) =>
      prev.map((m) => (m.ticker === ticker ? { ...m, [field]: value } : m)),
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(
          meta.map((m) => ({
            ...m,
            name: m.name.trim() || m.ticker,
          })),
        );
      }}
    >
      <p className="text-xs text-ink-dim">
        {meta.length === 1 ? "This ticker is" : "These tickers are"} new to your
        portfolio. The asset class decides which price feed quotes it, so it is
        worth getting right.
      </p>
      <div className="mt-4 space-y-4">
        {meta.map((m) => (
          <div key={m.ticker} className="rounded-lg border border-line bg-elevated/60 p-3">
            <p className="text-sm font-medium">{m.ticker}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input
                  value={m.name}
                  onChange={(e) => set(m.ticker, "name", e.target.value)}
                  placeholder={m.ticker}
                  autoFocus
                />
              </Field>
              <Field label="Asset class">
                <Select
                  value={m.assetClass}
                  onChange={(e) => set(m.ticker, "assetClass", e.target.value)}
                >
                  {ASSET_CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ))}
      </div>
      <FormActions onCancel={onCancel} label="Record trades" />
    </form>
  );
}

/**
 * A trade as it arrives from an import, before it is a form row.
 *
 * Everything is a string here because the form edits strings; the caller does
 * the numbers, and this stays the narrow contract between the two so the
 * importer's row type does not leak into the form.
 */
export interface TradeDraft {
  date: string;
  action: "buy" | "sell" | "dividend";
  ticker: string;
  quantity: string;
  price: string;
  accountId: string;
  currency: string;
  cadAmount: string;
}

export function TradeEntry({
  onComplete,
  initial,
  onStage,
  submitLabel,
  hideSubmit,
  submitRef,
}: {
  onComplete?: () => void;
  /**
   * When given, the batch is handed over instead of being written.
   *
   * The monthly checklist stages every step and applies the lot at the end, so
   * it needs the validated batch rather than its effects. Without this the
   * form is the thing that writes, which is right everywhere else.
   */
  onStage?: (batch: TradeBatch, rows: TradeInput[]) => void;
  /** Overrides the button's wording where "submit" would be a lie. */
  submitLabel?: string;
  /**
   * Drops the form's own submit button and hands the trigger out instead.
   *
   * The monthly checklist wants one row of buttons at the foot of the step,
   * not a submit inside the form and a Next below it — two buttons a step
   * apart, one of which quietly did nothing.
   */
  hideSubmit?: boolean;
  submitRef?: MutableRefObject<(() => void) | null>;
  /**
   * Rows to open with, when something has already been read out of a file.
   * Read once, on mount: they are a starting point to be edited, and
   * re-seeding them under an edit in progress would throw that edit away.
   */
  initial?: TradeDraft[];
}) {
  const holdings = useFinance((s) => s.holdings);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const accounts = useFinance((s) => s.accounts);
  const adjustAccountCash = useFinance((s) => s.adjustAccountCash);
  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));
  const defaultAccountId = investmentAccounts[0]?.id ?? "";

  const [rows, setRows] = useState<TradeRow[]>(() =>
    initial && initial.length > 0
      ? initial.map((d) => ({
          ...emptyRow(),
          ...d,
          accountId: d.accountId || defaultAccountId,
        }))
      : [{ ...emptyRow(), accountId: defaultAccountId }],
  );
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  /** Non-null while the new-position dialog is asking for the missing details. */
  const [pending, setPending] = useState<NewHoldingMeta[] | null>(null);

  const update = (id: string, field: keyof TradeRow, value: string) => {
    setRows((prev) => {
      const next = prev.map((r) => {
        if (r.id !== id) return r;
        const draft = { ...r, [field]: value };
        // Auto-fill ticker defaults when changing action
        if (field === "action") {
          if (value === "dividend") {
            draft.quantity = "1";
          }
          if (value === "sell") {
            // Pre-fill price from current price if ticker exists
            const h = holdings.find(
              (h) => h.ticker.toUpperCase() === r.ticker.toUpperCase(),
            );
            if (h) draft.price = String(h.price);
          }
        }
        // Auto-fill CAD amount when currency is USD and price/qty change
        if (
          r.currency === "USD" &&
          (field === "price" || field === "quantity" || field === "currency")
        ) {
          const qty = Number(field === "quantity" ? value : draft.quantity);
          const px = Number(field === "price" ? value : draft.price);
          if (qty > 0 && px > 0) {
            draft.cadAmount = String(Math.round(qty * px * usdCadRate * 100) / 100);
          }
        }
        if (field === "currency" && value === "CAD") {
          draft.cadAmount = "";
        }
        return draft;
      });
      /*
       * The last row grows a fresh one behind it the moment it stops being
       * empty, so there is always somewhere to type next and never a button to
       * press first. Blank trailing rows are ignored on submit.
       */
      const last = next[next.length - 1];
      if (last && !isBlankRow(last)) {
        next.push({ ...emptyRow(), accountId: last.accountId || defaultAccountId });
      }
      return next;
    });
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const reset = () => {
    setRows([{ ...emptyRow(), accountId: defaultAccountId }]);
    setPending(null);
  };

  /**
   * Works out what the batch would do, then either does it or hands it over.
   *
   * `meta` carries the identity of tickers that have no holding yet, collected
   * by the dialog; it is empty when every row names a position that already
   * exists. The arithmetic itself lives in `planTrades`, so that a caller who
   * wants to know what a batch *would* do — the monthly checklist, which saves
   * nothing until its last step — can ask without doing it.
   */
  const commit = (entered: NewHoldingMeta[]) => {
    setError("");
    setOk("");
    const plan = planTrades(rows, entered, holdings, usdCadRate);
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    setPending(null);

    if (onStage) {
      // Deferred: the caller holds the batch and applies it later.
      onStage(plan.batch, rows.filter((r) => !isBlankRow(r)));
      onComplete?.();
      return;
    }

    apply(plan.batch);
    setOk(
      `Recorded ${plan.batch.trades} trade${plan.batch.trades !== 1 ? "s" : ""}` +
        (plan.batch.created > 0
          ? ` (${plan.batch.created} new position${plan.batch.created !== 1 ? "s" : ""})`
          : ""),
    );
    reset();
    onComplete?.();
  };

  const apply = (batch: TradeBatch) => {
    for (const c of batch.changes) {
      if (c.existing) {
        updateHolding(c.existing.id, {
          ...c.existing,
          shares: c.shares,
          avgCost: c.avgCost,
          dividendsReceived: c.dividendsReceived,
          flows: c.flows,
        });
        continue;
      }
      addHolding({
        ticker: c.ticker,
        name: c.name,
        assetClass: c.assetClass,
        shares: c.shares,
        avgCost: c.avgCost,
        price: c.price,
        dividendsReceived: c.dividendsReceived,
        accountId: c.accountId,
        currency: c.currency,
        flows: c.flows,
      });
    }
    for (const { accountId, delta } of batch.cash) {
      adjustAccountCash(accountId, delta);
    }
  };

  const process = () => {
    setError("");
    setOk("");
    const active = rows.filter((r) => !isBlankRow(r));
    if (active.length === 0) {
      setError("Enter at least one trade.");
      return;
    }
    for (const row of active) {
      if (!row.ticker.trim()) {
        setError("Ticker is required on every row.");
        return;
      }
    }
    const needed = newPositionsNeeded(rows, holdings);
    if (needed.length > 0) {
      setPending(needed);
      return;
    }
    commit([]);
  };

  /*
   * Handed out after each render rather than during it: `process` closes over
   * the current rows, and a trigger captured once would submit the form as it
   * was on mount.
   */
  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = process;
    return () => {
      submitRef.current = null;
    };
  });

  /**
   * What the row is worth, in CAD.
   *
   * A dividend is the one row where quantity is not a multiplier — it is
   * pinned at 1 and the amount is typed into the price — so the arithmetic is
   * the same, but showing it matters most there: "0.42" in a price box is not
   * a figure anyone can check against a statement, and the total is.
   */
  const rowTotalCAD = (row: TradeRow): number => {
    const qty = Number(row.quantity);
    const px = Number(row.price);
    if (!Number.isFinite(qty) || !Number.isFinite(px) || qty <= 0 || px <= 0) {
      return 0;
    }
    if (row.currency === "USD") {
      const typed = Number(row.cadAmount);
      return Number.isFinite(typed) && typed > 0 ? typed : qty * px * usdCadRate;
    }
    return qty * px;
  };

  const active = rows.filter((r) => !isBlankRow(r));
  const bought = active
    .filter((r) => r.action === "buy")
    .reduce((sum, r) => sum + rowTotalCAD(r), 0);
  const sold = active
    .filter((r) => r.action === "sell")
    .reduce((sum, r) => sum + rowTotalCAD(r), 0);
  const received = active
    .filter((r) => r.action === "dividend" || r.action === "reward")
    .reduce((sum, r) => sum + rowTotalCAD(r), 0);

  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div
          key={row.id}
          className="grid items-end gap-2 rounded-lg border border-line bg-elevated/60 p-3"
          style={{
            gridTemplateColumns:
              "minmax(110px,1fr) minmax(80px,100px) minmax(80px,110px) minmax(60px,80px) minmax(60px,90px) minmax(90px,140px) minmax(70px,90px) minmax(80px,110px)" +
              (rows.length > 1 ? " 32px" : ""),
          }}
        >
          <Field label={idx === 0 ? "Date" : undefined}>
            <Input
              type="date"
              value={row.date}
              onChange={(e) => update(row.id, "date", e.target.value)}
            />
          </Field>
          <Field label={idx === 0 ? "Action" : undefined}>
            <Select
              value={row.action}
              onChange={(e) => update(row.id, "action", e.target.value)}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="dividend">Dividend</option>
              <option value="reward">Staking reward</option>
            </Select>
          </Field>
          <Field label={idx === 0 ? "Ticker" : undefined}>
            <TradeTickerInput row={row} update={update} />
          </Field>
          <Field label={idx === 0 ? "Qty" : undefined}>
            <Input
              type="number"
              step="any"
              min="0"
              value={row.quantity}
              onChange={(e) => update(row.id, "quantity", e.target.value)}
              placeholder={row.action === "dividend" ? "1" : "0"}
              disabled={row.action === "dividend"}
            />
          </Field>
          <Field label={idx === 0 ? "Price" : undefined}>
            <Input
              type="number"
              step="any"
              min="0"
              value={row.price}
              onChange={(e) => update(row.id, "price", e.target.value)}
              placeholder={
                row.action === "dividend"
                  ? "Amount"
                  : row.action === "reward"
                    ? "Value each"
                    : row.action === "sell"
                      ? "Market"
                      : "0.00"
              }
            />
          </Field>
          <Field label={idx === 0 ? "Account" : undefined}>
            <Select
              value={row.accountId}
              onChange={(e) => update(row.id, "accountId", e.target.value)}
            >
              {investmentAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={idx === 0 ? "Currency" : undefined}>
            <Select
              value={row.currency}
              onChange={(e) => update(row.id, "currency", e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={idx === 0 ? "Total" : undefined}>
            <p
              className="flex h-9 items-center justify-end px-1 text-sm tabular-nums text-ink-dim"
              aria-label="Row total"
            >
              {rowTotalCAD(row) > 0 ? fmtCAD(rowTotalCAD(row), 2) : "—"}
            </p>
          </Field>
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="mb-1 flex h-8 w-8 items-center justify-center self-end rounded-md text-ink-faint hover:bg-elevated hover:text-negative"
              aria-label="Remove row"
            >
              &times;
            </button>
          )}
        </div>
      ))}

      {/* USD CAD equivalent row */}
      {rows.some((r) => r.currency === "USD") && (
        <p className="text-[0.6875rem] text-ink-faint">
          USD trades use a {usdCadRate.toFixed(2)} CAD/USD rate. Enter the exact CAD amount if you know it.
        </p>
      )}

      {active.length > 0 && (bought > 0 || sold > 0 || received > 0) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-ink-faint">
          {bought > 0 && (
            <span>
              Bought{" "}
              <span className="font-semibold tabular-nums text-ink">
                {fmtCAD(bought, 2)}
              </span>
            </span>
          )}
          {sold > 0 && (
            <span>
              Sold{" "}
              <span className="font-semibold tabular-nums text-ink">
                {fmtCAD(sold, 2)}
              </span>
            </span>
          )}
          {received > 0 && (
            <span>
              Received{" "}
              <span className="font-semibold tabular-nums text-positive">
                {fmtCAD(received, 2)}
              </span>
            </span>
          )}
        </p>
      )}

      {error && <p className="text-xs text-negative">{error}</p>}
      {ok && <p className="text-xs text-positive">{ok}</p>}

      {!hideSubmit && (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={process}>
            {submitLabel ?? "Submit trades"}
          </Button>
        </div>
      )}

      <Modal
        open={pending != null}
        onClose={() => setPending(null)}
        title={
          pending && pending.length > 1 ? "New positions" : "New position"
        }
      >
        {pending && (
          <NewHoldingDetails
            key={pending.map((p) => p.ticker).join(",")}
            pending={pending}
            onCancel={() => setPending(null)}
            onConfirm={(meta) => {
              setPending(null);
              commit(meta);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/* ---------------- Confirm delete ---------------- */

/* ---------------- Recurring rule ---------------- */

function RecurringFormInner({
  initial,
  onClose,
}: {
  initial: RecurringRule | null;
  onClose: () => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const addRecurring = useFinance((s) => s.addRecurring);
  const updateRecurring = useFinance((s) => s.updateRecurring);
  const userCategories = useFinance((s) => s.categories);

  const firstCategory = (t: TxnType) =>
    t === "income" ? INCOME_CATEGORIES[0] : userCategories[0] ?? "Other";
  const optionsFor = (t: TxnType): readonly string[] =>
    alphabetical(t === "income" ? INCOME_CATEGORIES : userCategories);

  const [type, setType] = useState<TxnType>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [category, setCategory] = useState(
    initial?.category ?? firstCategory(initial?.type ?? "expense"),
  );
  const [sourceAccountId, setSourceAccountId] = useState(
    initial?.sourceAccountId ?? accounts[0]?.id ?? "",
  );
  const [destinationAccountId, setDestinationAccountId] = useState(
    initial?.destinationAccountId ?? accounts[0]?.id ?? "",
  );
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    initial?.frequency ?? "monthly",
  );
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState("");

  const switchType = (t: TxnType) => {
    setType(t);
    if (initial) return;
    setCategory(t === "transfer" ? TRANSFER_CATEGORY : firstCategory(t));
    if (t === "transfer" && destinationAccountId === sourceAccountId) {
      const other = accounts.find((a) => a.id !== sourceAccountId);
      if (other) setDestinationAccountId(other.id);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0)
      return setError("Amount must be greater than zero.");
    if (type !== "transfer" && !payee.trim())
      return setError("Please enter a payee or source.");
    if (type !== "income" && !sourceAccountId)
      return setError("Please choose the account the money comes from.");
    if (type !== "expense" && !destinationAccountId)
      return setError("Please choose the account the money goes to.");
    if (type === "transfer" && sourceAccountId === destinationAccountId)
      return setError("A transfer needs two different accounts.");
    if (endDate && endDate < startDate)
      return setError("The end date cannot be before the start date.");

    const source = accounts.find((a) => a.id === sourceAccountId);
    const destination = accounts.find((a) => a.id === destinationAccountId);
    const payload = {
      type,
      amount: Math.round(amt * 100) / 100,
      category: type === "transfer" ? TRANSFER_CATEGORY : category,
      sourceAccountId: type === "income" ? undefined : sourceAccountId,
      destinationAccountId: type === "expense" ? undefined : destinationAccountId,
      payee:
        type === "transfer"
          ? payee.trim() ||
            `${source?.name ?? "Account"} → ${destination?.name ?? "Account"}`
          : payee.trim(),
      note: note.trim() || undefined,
      frequency,
      startDate,
      endDate: endDate || undefined,
      active,
    };
    if (initial) updateRecurring(initial.id, payload);
    else addRecurring(payload);
    onClose();
  };

  const accountOptions = (exclude?: string) =>
    accounts
      .filter((a) => a.id !== exclude)
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ));

  return (
    <form onSubmit={submit}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {(["expense", "income", "transfer"] as TxnType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchType(t)}
            className={
              "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors " +
              (type === t
                ? t === "income"
                  ? "border-positive/60 bg-positive/10 text-positive"
                  : t === "transfer"
                    ? "border-brand/60 bg-brand/10 text-brand"
                    : "border-negative/60 bg-negative/10 text-negative"
                : "border-line bg-elevated text-ink-dim hover:text-ink")
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Repeats">
          <Select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
          >
            {RECURRENCE_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {RECURRENCE_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>

        {type === "income" ? (
          <Field label="From" hint="Outside your accounts">
            <Input
              placeholder="Employer, client…"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="From account">
            <Select
              value={sourceAccountId}
              onChange={(e) => setSourceAccountId(e.target.value)}
            >
              {accountOptions()}
            </Select>
          </Field>
        )}

        {type === "expense" ? (
          <Field label="To" hint="Outside your accounts">
            <Input
              placeholder="Landlord, utility…"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="To account">
            <Select
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
            >
              {accountOptions(type === "transfer" ? sourceAccountId : undefined)}
            </Select>
          </Field>
        )}

        {type === "transfer" ? (
          <Field label="Description (optional)" hint="Defaults to “From → To”">
            <Input
              placeholder="TFSA contribution"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {optionsFor(type).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="First payment"
          hint="A past date posts the payments already due"
        >
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Ends (optional)" hint="Leave empty to repeat indefinitely">
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="Note (optional)">
          <Input
            placeholder="Anything worth remembering"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-ink-dim">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 accent-brand"
        />
        Active — pause this to stop it posting without deleting it
      </label>

      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      <FormActions
        onCancel={onClose}
        label={initial ? "Save changes" : "Create recurring"}
      />
    </form>
  );
}

export function ConfirmDelete({
  open,
  onClose,
  onConfirm,
  title,
  message,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink-dim">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Correcting one recorded trade.
 *
 * Trades are not transactions — they live on the position as flows, with no
 * identity beyond their place in its array — so this edits by reference and
 * lets `holdingAfterFlowEdit` replay the whole history rather than patching
 * the position's numbers. That is what keeps a corrected buy from leaving the
 * cost base priced on the figure it used to have.
 *
 * The date, the money and the share count are all that can be changed. What
 * kind of trade it is, and which position it belongs to, are not: a buy that
 * should have been a sell is two different events, and moving a trade between
 * positions would restate the cost base of both. Delete it and record it
 * properly — which is what the Delete button here is for.
 */
export function TradeForm({
  trade,
  onClose,
}: {
  /**
   * The trade being corrected. Mount this component only while there is one —
   * the fields start from it and are never reset, so opening a second trade
   * means a second mounting rather than an effect copying props into state.
   */
  trade: TradeRecord;
  onClose: () => void;
}) {
  const holdings = useFinance((s) => s.holdings);
  const updateHolding = useFinance((s) => s.updateHolding);
  const [date, setDate] = useState(trade.date);
  const [amount, setAmount] = useState(String(trade.amount));
  const [shares, setShares] = useState(String(Math.abs(trade.shares)));
  const [error, setError] = useState<string | null>(null);

  const holding = holdings.find((h) => h.id === trade.holdingId) ?? null;
  const isDividend = trade.kind === "dividend";

  const save = () => {
    if (!holding) {
      setError("That position is no longer here.");
      return;
    }
    const money = Number(amount);
    if (!Number.isFinite(money) || money < 0) {
      setError("Amount must be a number, and not negative.");
      return;
    }
    const qty = isDividend ? 0 : Number(shares);
    if (!isDividend && (!Number.isFinite(qty) || qty <= 0)) {
      setError("Shares must be greater than zero.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Pick a date.");
      return;
    }
    const edited: CashFlow = {
      date,
      kind: trade.kind,
      amount: roundMoney(money),
      // Sells are stored negative, which is what tells them apart in a replay.
      shares: trade.kind === "sell" ? -Math.abs(qty) : qty,
      ...(trade.kind === "buy" && money === 0 && trade.awaitingPrice
        ? { awaitingPrice: true }
        : {}),
    };
    const next = holdingAfterFlowEdit(holding, trade.index, edited);
    if (!next) {
      setError("That trade is no longer here.");
      return;
    }
    updateHolding(holding.id, {
      ...holding,
      shares: next.shares,
      avgCost: next.avgCost,
      dividendsReceived: next.dividends,
      flows: next.flows,
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Edit ${trade.kind} · ${trade.ticker}`}>
      <div className="space-y-4">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label={isDividend ? "Amount received (CAD)" : "Total value (CAD)"}
          hint={
            isDividend
              ? undefined
              : "What the whole trade came to, not the price per share."
          }
        >
          <Input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {!isDividend && (
          <Field label="Shares">
            <Input
              type="number"
              step="any"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
            />
          </Field>
        )}
        <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
          The position&rsquo;s share count, cost base and dividend total are
          worked out again from its whole history when this is saved. Account
          balances are left alone — the cash moved when the trade did, and
          correcting the record of it does not move any money back.
        </p>
        {error ? <p className="text-xs text-negative">{error}</p> : null}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save}>Save trade</Button>
      </div>
    </Modal>
  );
}
