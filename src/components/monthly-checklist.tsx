"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Upload,
} from "lucide-react";
import { Button, Card, Field, Input, Modal, cn } from "@/components/ui";
import { TradeEntry } from "@/components/forms";
import { useFinance } from "@/lib/store";
import { currentMonthKey, fmtCAD, labelMonth } from "@/lib/format";
import {
  ImportedRow,
  parseCsvFile,
  txnKey,
} from "@/lib/csv";
import { sidesFor, type MonthlySnapshot } from "@/lib/types";

type Step = "income" | "import" | "trades" | "snapshot";

const INCOME_BOXES = [
  { key: "netPay", label: "Net pay", placeholder: "0.00" },
  { key: "pension", label: "Pension", placeholder: "0.00" },
  { key: "additional", label: "Additional income", placeholder: "0.00" },
  { key: "interest", label: "Interest & cashback", placeholder: "0.00" },
] as const;

function StepIndicator({
  steps,
  current,
}: {
  steps: { key: Step; label: string }[];
  current: Step;
}) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              i < idx
                ? "bg-positive/20 text-positive"
                : i === idx
                  ? "bg-brand/20 text-brand"
                  : "bg-elevated text-ink-faint",
            )}
          >
            {i < idx ? "✓" : i + 1}
          </div>
          <span
            className={cn(
              "text-xs font-medium",
              i === idx ? "text-ink" : "text-ink-faint",
            )}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <ChevronRight size={12} className="mx-1 text-ink-faint" />
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Step 1: Income ---------- */

function IncomeStep({ onNext }: { onNext: () => void }) {
  const addTransaction = useFinance((s) => s.addTransaction);
  const accounts = useFinance((s) => s.accounts);
  const [values, setValues] = useState<Record<string, string>>({
    netPay: "",
    pension: "",
    additional: "",
    interest: "",
  });

  const total = Object.values(values).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );

  const submit = () => {
    const date = `${currentMonthKey()}-01`;
    const defaultAccount = accounts[0]?.id ?? "";
    for (const box of INCOME_BOXES) {
      const amt = Number(values[box.key]) || 0;
      if (amt > 0) {
        addTransaction({
          date,
          type: "income",
          amount: Math.round(amt * 100) / 100,
          category: "Salary",
          ...sidesFor("income", defaultAccount),
          payee: box.label,
        });
      }
    }
    onNext();
  };

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold">Step 1 · Record income</h3>
      <p className="mt-1 text-xs text-ink-faint">
        Enter your income for the month. Each box creates an income transaction.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {INCOME_BOXES.map((box) => (
          <Field key={box.key} label={box.label}>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder={box.placeholder}
              value={values[box.key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [box.key]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-ink-faint">
          Total:{" "}
          <span className="font-semibold text-positive tabular-nums">
            {fmtCAD(total, 2)}
          </span>
        </p>
        <Button onClick={submit}>
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Step 2: CSV Import ---------- */

function ImportStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const merchantRules = useFinance((s) => s.merchantRules);
  const userCategories = useFinance((s) => s.categories);
  const addTransaction = useFinance((s) => s.addTransaction);
  const setMerchantRule = useFinance((s) => s.setMerchantRule);

  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(
    () => new Set(transactions.map((t) => txnKey(t.date, t.amount, t.payee))),
    [transactions],
  );

  const creditCard = accounts.find((a) => a.kind === "credit")?.id ?? accounts[0]?.id ?? "";
  const included = rows.filter((r) => r.include);

  const handleFiles = async (list: FileList | File[]) => {
    const csvs = Array.from(list).filter(
      (f) => /\.csv$/i.test(f.name) || f.type === "text/csv",
    );
    if (csvs.length === 0) return;
    setBusy(true);
    const results = await Promise.all(
      csvs.map((f) => parseCsvFile(f, existingKeys, merchantRules, userCategories)),
    );
    setRows((prev) => [...prev, ...results.flatMap((r) => r.rows)]);
    setBusy(false);
  };

  const save = () => {
    let learned = 0;
    for (const r of included) {
      if (!r.payee.trim() || r.amount <= 0) continue;
      addTransaction({
        date: r.date,
        type: r.type,
        amount: r.amount,
        category: r.category,
        ...sidesFor(r.type, creditCard),
        payee: r.payee.trim(),
        note: r.note,
      });
      if (r.category !== r.suggestedCategory) {
        setMerchantRule(r.payee, r.category);
        learned += 1;
      }
    }
    onNext();
  };

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold">Step 2 · Import credit card CSV</h3>
      <p className="mt-1 text-xs text-ink-faint">
        Drag and drop your credit card CSV export below.
      </p>

      {rows.length === 0 ? (
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
            "mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver
              ? "border-brand bg-brand/5"
              : "border-line bg-surface hover:border-brand/50",
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Upload size={18} />
          </span>
          <p className="text-sm font-medium">
            {busy ? "Parsing…" : "Drop CSV files here, or click to browse"}
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
      ) : (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-dim">
              {included.length} of {rows.length} transactions ready
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows([])}
                className="text-ink-faint"
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                  <th className="px-2 py-1.5 font-medium">In</th>
                  <th className="px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Merchant</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-2 py-1.5 font-medium">Category</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r) => (
                  <tr
                    key={r.id}
                    className={cn(
                      "border-b border-line/40 last:border-0",
                      !r.include && "opacity-40",
                    )}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((x) =>
                              x.id === r.id ? { ...x, include: e.target.checked } : x,
                            ),
                          )
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand-strong)]"
                      />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{r.date}</td>
                    <td className="px-2 py-1.5 truncate max-w-[150px]">{r.payee}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmtCAD(r.amount, 2)}
                    </td>
                    <td className="px-2 py-1.5">{r.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && (
              <p className="px-2 py-1.5 text-center text-[10px] text-ink-faint">
                …and {rows.length - 20} more rows
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <Button variant="secondary" onClick={onSkip}>
          Skip import
        </Button>
        <Button onClick={save} disabled={rows.length === 0}>
          Save & next <ArrowRight size={14} />
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Step 3: Trade Entry ---------- */

function TradesStep({ onNext }: { onNext: () => void }) {
  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold">Step 3 · Log any trades</h3>
      <p className="mt-1 text-xs text-ink-faint">
        Record any buys, sells, or dividends from the past month.
      </p>
      <div className="mt-4">
        <TradeEntry onComplete={onNext} />
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onNext}>
          Skip <ArrowRight size={14} />
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Step 4: Portfolio Snapshot ---------- */

function SnapshotStep({ onComplete }: { onComplete: () => void }) {
  const holdings = useFinance((s) => s.holdings);
  const loadSnapshots = useFinance((s) => s.loadSnapshots);
  const saveSnapshots = useFinance((s) => s.saveSnapshots);
  const snapshots = useFinance((s) => s.snapshots);
  const snapshotMonth = useFinance((s) => s.snapshotMonth);

  const month = currentMonthKey();
  const [editValues, setEditValues] = useState<Record<string, Partial<MonthlySnapshot>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSnapshots(month);
  }, [month, loadSnapshots]);

  const existing = useMemo(
    () => new Map(snapshots.map((s) => [s.holdingId, s])),
    [snapshots],
  );

  const rows = useMemo(() => {
    return holdings.map((h) => {
      const edit = editValues[h.id] ?? {};
      const existingRow = existing.get(h.id);
      const price = edit.price ?? existingRow?.price ?? h.price;
      const shares = edit.shares ?? existingRow?.shares ?? h.shares;
      const avgCost = edit.avgCost ?? existingRow?.avgCost ?? h.avgCost;
      const value = price * shares;
      return {
        holdingId: h.id,
        ticker: h.ticker,
        name: h.name,
        price,
        shares,
        avgCost,
        value,
      };
    });
  }, [holdings, editValues, existing]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const hasExisting = snapshots.length > 0 && snapshotMonth === month;

  const save = async () => {
    setSaving(true);
    const payload: MonthlySnapshot[] = rows.map((r) => ({
      month,
      holdingId: r.holdingId,
      ticker: r.ticker,
      price: r.price,
      avgCost: r.avgCost,
      shares: r.shares,
      value: r.value,
      valueCAD: r.value,
    }));
    await saveSnapshots(payload);
    setSaving(false);
    onComplete();
  };

  const updateField = (id: string, field: string, value: string) => {
    const num = Number(value);
    setEditValues((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: Number.isFinite(num) ? num : 0 },
    }));
  };

  return (
    <Card className="p-6">
      <h3 className="text-sm font-semibold">
        Step 4 · Portfolio snapshot
      </h3>
      <p className="mt-1 text-xs text-ink-faint">
        Record your portfolio as of the 1st of {labelMonth(month)}. You can adjust
        the pre-filled values before saving.
      </p>

      {holdings.length === 0 ? (
        <p className="mt-4 text-xs text-ink-faint">
          No holdings yet — add investments first, then come back for the snapshot.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-2 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 text-right font-medium">Price</th>
                <th className="px-2 py-2 text-right font-medium">Shares</th>
                <th className="px-2 py-2 text-right font-medium">Avg Cost</th>
                <th className="px-2 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.holdingId} className="border-b border-line/40 last:border-0">
                  <td className="px-2 py-2 font-medium">{r.ticker}</td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.price}
                      onChange={(e) =>
                        updateField(r.holdingId, "price", e.target.value)
                      }
                      className="h-8 w-24 px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={r.shares}
                      onChange={(e) =>
                        updateField(r.holdingId, "shares", e.target.value)
                      }
                      className="h-8 w-24 px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.avgCost}
                      onChange={(e) =>
                        updateField(r.holdingId, "avgCost", e.target.value)
                      }
                      className="h-8 w-24 px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2 text-right text-xs font-semibold tabular-nums">
                    {fmtCAD(r.value, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td colSpan={4} className="px-2 py-2 text-right text-xs font-semibold">
                  Total
                </td>
                <td className="px-2 py-2 text-right text-sm font-bold tabular-nums">
                  {fmtCAD(totalValue, 2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] text-ink-faint">
          {hasExisting
            ? "Snapshot already saved — editing will update it."
            : "No snapshot for this month yet."}
        </p>
        <Button onClick={save} disabled={holdings.length === 0 || saving}>
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {hasExisting ? "Update snapshot" : "Save snapshot"}
        </Button>
      </div>
    </Card>
  );
}

/* ---------- Main Component ---------- */

const STEPS: { key: Step; label: string }[] = [
  { key: "income", label: "Income" },
  { key: "import", label: "Import" },
  { key: "trades", label: "Trades" },
  { key: "snapshot", label: "Snapshot" },
];

export function MonthlyChecklistButton({
  onOpen,
}: {
  onOpen: () => void;
}) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      <CheckCircle2 size={14} /> Monthly checklist
    </Button>
  );
}

export function MonthlyChecklistModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("income");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Monthly checklist · ${labelMonth(currentMonthKey())}`}
      wide
    >
      <div className="px-5 pb-5 pt-3">
        <div className="mb-4 flex items-center justify-between">
          <StepIndicator steps={STEPS} current={step} />
          <p className="text-[11px] text-ink-faint">
            Complete these steps to keep your finances up to date.
          </p>
        </div>

        {step === "income" && (
          <IncomeStep onNext={() => setStep("import")} />
        )}
        {step === "import" && (
          <ImportStep
            onNext={() => setStep("trades")}
            onSkip={() => setStep("trades")}
          />
        )}
        {step === "trades" && (
          <TradesStep onNext={() => setStep("snapshot")} />
        )}
        {step === "snapshot" && (
          <SnapshotStep onComplete={onClose} />
        )}
      </div>
    </Modal>
  );
}
