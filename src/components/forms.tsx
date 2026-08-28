"use client";

import { useState, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
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
  RecurrenceFrequency,
  RecurringRule,
  Registration,
  Transaction,
  TxnType,
  isInvestmentAccount,
  supportsRegistration,
} from "@/lib/types";
import { todayISO } from "@/lib/format";
import { useFinance } from "@/lib/store";
import { useTickerValidation } from "@/lib/hooks";
import { isCoinTicker } from "@/lib/market";
import { Button, Field, Input, Modal, Select } from "./ui";

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
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{label}</Button>
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
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit transaction" : "New transaction"}>
      <TransactionFormInner key={initial?.id ?? "new"} initial={initial ?? null} onClose={onClose} />
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
    t === "income" ? INCOME_CATEGORIES : userCategories;

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
        <p className="mt-3 text-[11px] text-ink-faint">
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
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bal = Number(balance);
    if (!name.trim()) return setError("Please name the account.");
    if (!Number.isFinite(bal)) return setError("Balance must be a number.");
    const payload = {
      name: name.trim(),
      institution: institution.trim() || "—",
      kind,
      balance: Math.round(bal * 100) / 100,
      // Debts and property are never sheltered, so the field is not stored
      // for them at all rather than being stored as a meaningless default.
      registration: supportsRegistration(kind) ? registration : undefined,
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
          label={isInvestmentAccount(kind) ? "Cash balance" : "Current balance"}
          hint={
            isInvestmentAccount(kind)
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
  const updateHolding = useFinance((s) => s.updateHolding);
  const deleteHolding = useFinance((s) => s.deleteHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const accounts = useFinance((s) => s.accounts);
  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));

  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(
    initial?.assetClass ?? "US Equity",
  );
  const [sector, setSector] = useState(initial?.sector ?? "");
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
    const sh = Number(shares);
    const cost = Number(avgCost);
    const px = Number(price);
    const divs = Number(dividendsReceived);
    if (!ticker.trim()) return setError("Ticker is required.");
    if (!name.trim()) return setError("Please give the holding a name.");
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
    const payload = {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      sector: sector.trim() || assetClass,
      shares: sh,
      avgCost: cost,
      price: px,
      dividendsReceived: Number.isFinite(divs) ? Math.max(0, divs) : 0,
      accountId,
      currency,
    };
    if (initial) updateHolding(initial.id, payload);
    else addHolding(payload);
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
                <span className="text-[12px] text-ink-faint">?</span>
              )}
            </span>
          </div>
          {tickerStatus === "valid" && fetchedPrice != null && (
            <p className="mt-1 text-[11px] text-positive">
              Price: {currency === "USD"
                ? `$${(fetchedPrice * usdCadRate).toLocaleString("en-CA", { minimumFractionDigits: 2 })} CAD`
                : `$${fetchedPrice.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`}
            </p>
          )}
          {tickerStatus === "invalid" && ticker.trim() && (
            <p className="mt-1 text-[11px] text-negative">
              Ticker not found — check the symbol and asset class
            </p>
          )}
          {tickerStatus === "unknown" && ticker.trim() && (
            <p className="mt-1 text-[11px] text-ink-faint">
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
        <Field label="Sector / group">
          <Input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Technology"
          />
        </Field>
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
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">
        This records a position you already hold, so the account&rsquo;s cash
        balance is left alone. Use{" "}
        <span className="text-ink-dim">Import trades</span>
        {" "}to enter a purchase, which pays for the shares out of that cash.
      </p>
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      <FormActions
        onCancel={onClose}
        label={initial ? "Save changes" : "Add holding"}
        destructive={
          initial ? (
            confirmingDelete ? (
              <span className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    deleteHolding(initial.id);
                    onClose();
                  }}
                >
                  Delete permanently
                </Button>
                <button
                  type="button"
                  className="text-xs text-ink-faint underline-offset-2 hover:underline"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-ink-faint transition-colors hover:text-negative"
              >
                Delete holding
              </button>
            )
          ) : undefined
        }
      />
    </form>
  );
}

/* ---------------- Trade batch entry ---------------- */

type TradeAction = "buy" | "sell" | "dividend";

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
  const { status, price: fetchedPrice } = useTickerValidation(
    row.ticker,
    assetClass,
    row.currency as Currency,
  );
  const usdCadRate = useFinance((s) => s.usdCadRate);

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
        {status === "valid" && (
          <span className="flex items-center gap-0.5">
            <Check size={12} className="text-positive" />
            {fetchedPrice != null && (
              <span className="text-[10px] text-positive tabular-nums">
                ${row.currency === "USD"
                  ? (fetchedPrice * usdCadRate).toLocaleString("en-CA", { maximumFractionDigits: 0 })
                  : fetchedPrice.toLocaleString("en-CA", { maximumFractionDigits: 0 })}
              </span>
            )}
          </span>
        )}
        {status === "invalid" && row.ticker.trim() && (
          <X size={12} className="text-negative" />
        )}
        {status === "unknown" && row.ticker.trim() && (
          <span
            className="text-[11px] text-ink-faint"
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
  sector: string;
}

/** A trailing row the user has not touched yet is not a trade. */
function isBlankRow(row: TradeRow): boolean {
  return (
    !row.ticker.trim() &&
    !row.quantity.trim() &&
    !row.price.trim() &&
    !row.cadAmount.trim()
  );
}

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
            sector: m.sector.trim() || m.assetClass,
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
              <Field label="Sector / group">
                <Input
                  value={m.sector}
                  onChange={(e) => set(m.ticker, "sector", e.target.value)}
                  placeholder={m.assetClass}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
      <FormActions onCancel={onCancel} label="Record trades" />
    </form>
  );
}

export function TradeEntry({ onComplete }: { onComplete?: () => void }) {
  const holdings = useFinance((s) => s.holdings);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const accounts = useFinance((s) => s.accounts);
  const adjustAccountCash = useFinance((s) => s.adjustAccountCash);
  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));
  const defaultAccountId = investmentAccounts[0]?.id ?? "";

  const [rows, setRows] = useState<TradeRow[]>([
    { ...emptyRow(), accountId: defaultAccountId },
  ]);
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
   * Applies the batch. `meta` carries the identity of tickers that have no
   * holding yet, collected by the dialog; it is empty when every row names a
   * position that already exists.
   */
  const commit = (entered: NewHoldingMeta[]) => {
    setError("");
    setOk("");
    const meta = new Map(entered.map((m) => [m.ticker, m]));
    const active = rows.filter((r) => !isBlankRow(r));

    // Netted per account and applied once at the end, so a batch that buys and
    // sells in the same account does not race itself through the API.
    const cashDeltas = new Map<string, number>();

    /*
     * A batch can touch the same position on several rows, but `holdings` is a
     * render-time snapshot that does not move between them. Rows are replayed
     * onto this working copy and each position is written back exactly once, so
     * a second buy of the same ticker builds on the first rather than
     * overwriting it — or, for a ticker that is new, opening a duplicate.
     *
     * Keyed by ticker *and* account, because one ticker held in two accounts is
     * two positions with their own cost bases.
     */
    interface WorkingLot {
      ticker: string;
      existing: Holding | null;
      accountId: string;
      currency: string;
      shares: number;
      avgCost: number;
      dividends: number;
      price: number;
      flows: CashFlow[];
    }
    const lots = new Map<string, WorkingLot>();
    const lotFor = (ticker: string, row: TradeRow): WorkingLot => {
      const key = `${ticker} ${row.accountId}`;
      const found = lots.get(key);
      if (found) return found;
      const existing =
        holdings.find(
          (h) =>
            h.ticker.toUpperCase() === ticker && h.accountId === row.accountId,
        ) ?? null;
      const lot: WorkingLot = {
        ticker,
        existing,
        accountId: row.accountId,
        currency: existing?.currency ?? row.currency,
        shares: existing?.shares ?? 0,
        avgCost: existing?.avgCost ?? 0,
        dividends: existing?.dividendsReceived ?? 0,
        price: existing?.price ?? 0,
        flows: [...(existing?.flows ?? [])],
      };
      lots.set(key, lot);
      return lot;
    };

    for (const row of active) {
      const ticker = row.ticker.trim().toUpperCase();
      const qty = Number(row.quantity);
      const px = Number(row.price);
      const isUsd = row.currency === "USD";
      const lot = lotFor(ticker, row);
      const held = lot.existing != null || lot.shares > 0;

      if (row.action === "buy") {
        if (!Number.isFinite(qty) || qty <= 0) {
          setError(`Buy ${ticker}: quantity must be > 0.`);
          return;
        }
        if (!Number.isFinite(px) || px <= 0) {
          setError(`Buy ${ticker}: price must be > 0.`);
          return;
        }
        const costCad = isUsd ? Number(row.cadAmount) || qty * px * usdCadRate : qty * px;
        // The cash that paid for the shares leaves the account's balance; the
        // shares themselves are valued from the holding.
        cashDeltas.set(
          row.accountId,
          (cashDeltas.get(row.accountId) ?? 0) - Math.abs(costCad),
        );
        const newShares = lot.shares + qty;
        lot.avgCost =
          lot.shares > 0
            ? (lot.shares * lot.avgCost + costCad) / newShares
            : costCad / qty;
        lot.shares = newShares;
        if (lot.price <= 0) lot.price = px;
        // Recorded so this trade counts towards the realized gain and the
        // money-weighted return, same as an imported one.
        lot.flows.push({
          date: row.date,
          kind: "buy",
          amount: Math.abs(costCad),
          shares: qty,
        });
      } else if (row.action === "sell") {
        if (!Number.isFinite(qty) || qty <= 0) {
          setError(`Sell ${ticker}: quantity must be > 0.`);
          return;
        }
        if (!held) {
          setError(`Sell ${ticker}: no position found.`);
          return;
        }
        if (qty > lot.shares) {
          setError(
            `Sell ${ticker}: cannot sell ${qty} shares, only ${lot.shares} held.`,
          );
          return;
        }
        const proceedsCad = isUsd
          ? Number(row.cadAmount) || qty * px * usdCadRate
          : qty * px;
        cashDeltas.set(
          row.accountId,
          (cashDeltas.get(row.accountId) ?? 0) + Math.abs(proceedsCad),
        );
        lot.shares -= qty;
        lot.flows.push({
          date: row.date,
          kind: "sell",
          amount: Math.abs(proceedsCad),
          shares: -qty,
        });
      } else if (row.action === "dividend") {
        const cadAmount = isUsd ? Number(row.cadAmount) || 0 : Number(row.price) || 0;
        if (!Number.isFinite(cadAmount) || cadAmount <= 0) {
          setError(`Dividend ${ticker}: amount must be > 0.`);
          return;
        }
        if (!held) {
          setError(`Dividend ${ticker}: no position found to credit.`);
          return;
        }
        cashDeltas.set(
          row.accountId,
          (cashDeltas.get(row.accountId) ?? 0) + cadAmount,
        );
        lot.dividends += cadAmount;
        lot.flows.push({
          date: row.date,
          kind: "dividend",
          amount: cadAmount,
          shares: 0,
        });
      }
    }

    // Nothing below can fail, so the writes and the cash only happen once every
    // row has validated: an early `return` above aborts the whole batch, and
    // the cash must not move for a batch that never posted its trades.
    let created = 0;
    for (const lot of lots.values()) {
      const shares = Math.round(lot.shares * 1e8) / 1e8;
      const avgCost = Math.round(lot.avgCost * 10000) / 10000;
      if (lot.existing) {
        updateHolding(lot.existing.id, {
          ...lot.existing,
          shares,
          avgCost,
          dividendsReceived: Math.round(lot.dividends * 100) / 100,
          flows: lot.flows,
        });
        continue;
      }
      // A ticker already held in another account keeps that position's
      // identity; only one nobody has held before goes through the dialog.
      const sibling = holdings.find((h) => h.ticker.toUpperCase() === lot.ticker);
      const m = meta.get(lot.ticker);
      if (!m && !sibling) {
        // Unreachable: every unknown ticker is collected before commit runs.
        // Guessing an asset class here would send it to the wrong price feed.
        setError(`${lot.ticker}: missing position details.`);
        return;
      }
      addHolding({
        ticker: lot.ticker,
        name: m?.name ?? sibling?.name ?? lot.ticker,
        assetClass: m?.assetClass ?? sibling?.assetClass ?? "US Equity",
        sector: m?.sector ?? sibling?.sector ?? "Other",
        shares,
        avgCost,
        price: lot.price,
        dividendsReceived: Math.round(lot.dividends * 100) / 100,
        accountId: lot.accountId,
        currency: lot.currency as Holding["currency"],
        flows: lot.flows,
      });
      created++;
    }

    for (const [accountId, delta] of cashDeltas) {
      adjustAccountCash(accountId, Math.round(delta * 100) / 100);
    }

    setOk(
      `Recorded ${active.length} trade${active.length !== 1 ? "s" : ""}` +
        (created > 0 ? ` (${created} new position${created !== 1 ? "s" : ""})` : ""),
    );
    reset();
    onComplete?.();
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

    /*
     * Buying a ticker with no holding behind it opens a position, and a
     * position needs a name and an asset class that no trade row carries. Ask
     * for them here, once per ticker, instead of guessing.
     */
    const needed: NewHoldingMeta[] = [];
    const seen = new Set<string>();
    for (const row of active) {
      const ticker = row.ticker.trim().toUpperCase();
      if (row.action !== "buy" || seen.has(ticker)) continue;
      if (holdings.some((h) => h.ticker.toUpperCase() === ticker)) continue;
      seen.add(ticker);
      needed.push({
        ticker,
        name: "",
        // A coin is never an equity, and routing it as one sends it to the
        // wrong price feed — so start from what the symbol already tells us.
        assetClass: isCoinTicker(ticker) ? "Crypto" : "US Equity",
        sector: "",
      });
    }

    if (needed.length > 0) {
      setPending(needed);
      return;
    }
    commit([]);
  };

  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <div
          key={row.id}
          className="grid items-end gap-2 rounded-lg border border-line bg-elevated/60 p-3"
          style={{
            gridTemplateColumns:
              "minmax(110px,1fr) minmax(80px,100px) minmax(80px,110px) minmax(60px,80px) minmax(60px,90px) minmax(90px,120px) minmax(70px,90px)" +
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
        <p className="text-[11px] text-ink-faint">
          USD trades use a {usdCadRate.toFixed(2)} CAD/USD rate. Enter the exact CAD amount if you know it.
        </p>
      )}

      {error && <p className="text-xs text-negative">{error}</p>}
      {ok && <p className="text-xs text-positive">{ok}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={process}>
          Submit trades
        </Button>
      </div>

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

export function RecurringForm({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: RecurringRule | null;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit recurring transaction" : "New recurring transaction"}
    >
      <RecurringFormInner
        key={initial?.id ?? "new"}
        initial={initial ?? null}
        onClose={onClose}
      />
    </Modal>
  );
}

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
    t === "income" ? INCOME_CATEGORIES : userCategories;

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
