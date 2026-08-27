"use client";

import { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import {
  ACCOUNT_KIND_LABELS,
  ACCOUNT_TYPES,
  ASSET_CLASSES,
  CURRENCIES,
  Account,
  AccountKind,
  AssetClass,
  Currency,
  Holding,
  INCOME_CATEGORIES,
  Transaction,
  TxnType,
} from "@/lib/types";
import { todayISO } from "@/lib/format";
import { useFinance } from "@/lib/store";
import { useTickerValidation } from "@/lib/hooks";
import { Button, Field, Input, Modal, Select } from "./ui";

function FormActions({
  onCancel,
  label = "Save",
}: {
  onCancel: () => void;
  label?: string;
}) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit">{label}</Button>
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
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? "");
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");

  const switchType = (t: TxnType) => {
    setType(t);
    if (!initial) setCategory(firstCategory(t));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!payee.trim()) return setError("Please enter a payee or source.");
    if (!Number.isFinite(amt) || amt <= 0)
      return setError("Amount must be greater than zero.");
    if (!accountId) return setError("Please choose an account.");
    const payload = {
      date,
      type,
      amount: Math.round(amt * 100) / 100,
      category,
      accountId,
      payee: payee.trim(),
      note: note.trim() || undefined,
    };
    if (initial) updateTransaction(initial.id, payload);
    else addTransaction(payload);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["expense", "income"] as TxnType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => switchType(t)}
            className={
              "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors " +
              (type === t
                ? t === "income"
                  ? "border-positive/60 bg-positive/10 text-positive"
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
        <Field label={type === "income" ? "Source" : "Payee"}>
          <Input
            placeholder={type === "income" ? "Employer, client…" : "Merchant…"}
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {optionsFor(type).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account" hint="Balance adjusts automatically">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <Input
            placeholder="Anything worth remembering"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>

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
            {(Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]).map((k) => (
              <option key={k} value={k}>
                {ACCOUNT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Current balance"
          hint="For credit cards & loans, enter the amount owed"
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
  const usdCadRate = useFinance((s) => s.usdCadRate);

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
  const [accountType, setAccountType] = useState(initial?.accountType ?? "non-registered");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [error, setError] = useState("");

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
    const payload = {
      ticker: ticker.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      sector: sector.trim() || assetClass,
      shares: sh,
      avgCost: cost,
      price: px,
      dividendsReceived: Number.isFinite(divs) ? Math.max(0, divs) : 0,
      accountType,
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
            step="0.01"
            min="0"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Current price" hint="Used for the latest data point">
          <Input
            type="number"
            step="0.01"
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
        <Field label="Account type">
          <Select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as Holding["accountType"])}
          >
            {ACCOUNT_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
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
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
      <FormActions onCancel={onClose} label={initial ? "Save changes" : "Add holding"} />
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
  accountType: string;
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
    accountType: "non-registered",
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
  const { status, price: fetchedPrice } = useTickerValidation(row.ticker, "US Equity", row.currency as Currency);
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
      </span>
    </div>
  );
}

export function TradeEntry({ onComplete }: { onComplete?: () => void }) {
  const holdings = useFinance((s) => s.holdings);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const usdCadRate = useFinance((s) => s.usdCadRate);

  const [rows, setRows] = useState<TradeRow[]>([emptyRow()]);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const update = (id: string, field: keyof TradeRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        // Auto-fill ticker defaults when changing action
        if (field === "action") {
          if (value === "dividend") {
            next.quantity = "1";
          }
          if (value === "sell") {
            // Pre-fill price from current price if ticker exists
            const h = holdings.find(
              (h) => h.ticker.toUpperCase() === r.ticker.toUpperCase(),
            );
            if (h) next.price = String(h.price);
          }
        }
        // Auto-fill CAD amount when currency is USD and price/qty change
        if (
          r.currency === "USD" &&
          (field === "price" || field === "quantity" || field === "currency")
        ) {
          const qty = Number(field === "quantity" ? value : next.quantity);
          const px = Number(field === "price" ? value : next.price);
          if (qty > 0 && px > 0) {
            next.cadAmount = String(Math.round(qty * px * usdCadRate * 100) / 100);
          }
        }
        if (field === "currency" && value === "CAD") {
          next.cadAmount = "";
        }
        return next;
      }),
    );
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  };

  const process = () => {
    setError("");
    setOk("");
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const ticker = row.ticker.trim().toUpperCase();
      if (!ticker) {
        setError("Ticker is required on every row.");
        return;
      }

      const qty = Number(row.quantity);
      const px = Number(row.price);
      const isUsd = row.currency === "USD";

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
        const existing = holdings.find(
          (h) => h.ticker.toUpperCase() === ticker,
        );
        if (existing) {
          const newShares = existing.shares + qty;
          const newAvgCost =
            existing.shares > 0
              ? (existing.shares * existing.avgCost + costCad) / newShares
              : costCad / qty;
          updateHolding(existing.id, {
            ...existing,
            shares: Math.round(newShares * 1e8) / 1e8,
            avgCost: Math.round(newAvgCost * 10000) / 10000,
            accountType: row.accountType as Holding["accountType"],
            currency: row.currency as Holding["currency"],
          });
          updated++;
        } else {
          addHolding({
            ticker,
            name: ticker,
            assetClass: "US Equity",
            sector: "Other",
            shares: qty,
            avgCost: Math.round((costCad / qty) * 10000) / 10000,
            price: px,
            dividendsReceived: 0,
            accountType: row.accountType as Holding["accountType"],
            currency: row.currency as Holding["currency"],
          });
          created++;
        }
      } else if (row.action === "sell") {
        if (!Number.isFinite(qty) || qty <= 0) {
          setError(`Sell ${ticker}: quantity must be > 0.`);
          return;
        }
        const existing = holdings.find(
          (h) => h.ticker.toUpperCase() === ticker,
        );
        if (!existing) {
          setError(`Sell ${ticker}: no position found.`);
          return;
        }
        if (qty > existing.shares) {
          setError(
            `Sell ${ticker}: cannot sell ${qty} shares, only ${existing.shares} held.`,
          );
          return;
        }
        const newShares = existing.shares - qty;
        updateHolding(existing.id, {
          ...existing,
          shares: Math.round(newShares * 1e8) / 1e8,
        });
        updated++;
      } else if (row.action === "dividend") {
        const cadAmount = isUsd ? Number(row.cadAmount) || 0 : Number(row.price) || 0;
        if (!Number.isFinite(cadAmount) || cadAmount <= 0) {
          setError(`Dividend ${ticker}: amount must be > 0.`);
          return;
        }
        const existing = holdings.find(
          (h) => h.ticker.toUpperCase() === ticker,
        );
        if (existing) {
          updateHolding(existing.id, {
            ...existing,
            dividendsReceived: existing.dividendsReceived + cadAmount,
          });
          updated++;
        } else {
          setError(`Dividend ${ticker}: no position found to credit.`);
          return;
        }
      }
    }

    setOk(
      `Processed ${created + updated} trade${created + updated !== 1 ? "s" : ""}` +
        (created > 0 ? ` (${created} new)` : "") +
        (updated > 0 ? ` (${updated} updated)` : ""),
    );
    setRows([emptyRow()]);
    onComplete?.();
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
              step="0.01"
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
              value={row.accountType}
              onChange={(e) => update(row.id, "accountType", e.target.value)}
            >
              {ACCOUNT_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
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
        <Button type="button" variant="secondary" onClick={() => setRows((prev) => [...prev, emptyRow()])}>
          <Plus size={14} /> Add row
        </Button>
        <Button type="button" onClick={process}>
          Submit trades
        </Button>
      </div>
    </div>
  );
}

/* ---------------- Confirm delete ---------------- */

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
