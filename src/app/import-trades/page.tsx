"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import Papa from "papaparse";
import { Shell } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Input,
  Select,
  cn,
} from "@/components/ui";
import { useFinance } from "@/lib/store";
import {
  TradeRow,
  accumulatePositions,
  parseTradeCsv,
  positionToHolding,
} from "@/lib/trades";
import { PageSkeleton, useReady } from "@/lib/hooks";
import { fmtCAD, todayISO } from "@/lib/format";
import {
  Currency,
  Holding,
  REGISTRATION_LABELS,
  Registration,
  isInvestmentAccount,
  isLiability,
  TRANSFER_CATEGORY,
} from "@/lib/types";

type Step = "upload" | "review" | "done";

export default function ImportTradesPage() {
  const ready = useReady();
  const holdings = useFinance((s) => s.holdings);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const addTransaction = useFinance((s) => s.addTransaction);
  const accounts = useFinance((s) => s.accounts);
  const adjustAccountCash = useFinance((s) => s.adjustAccountCash);

  const investmentAccounts = accounts.filter((a) => isInvestmentAccount(a.kind));
  /**
   * The CSV names a registration ("TFSA"), not an account, so match it to the
   * investment account carrying that registration.
   *
   * Deliberately no fallback to "the first investment account". That fallback
   * silently filed every imported trade into one account when the accounts had
   * no registration set yet — the import looked like it worked and the data was
   * wrong. An unmatched registration is now surfaced for the user to fix.
   */
  const accountIdFor = (registration: Registration): string =>
    investmentAccounts.find((a) => a.registration === registration)?.id ?? "";
  /** The everyday account cash moves in from / out to. */
  const cashAccountId =
    accounts.find((a) => !isInvestmentAccount(a.kind) && !isLiability(a.kind))?.id ?? "";

  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; deposits: number; withdrawals: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const included = rows.filter((r) => r.include);
  const buyCount = included.filter((r) => r.type === "buy").length;
  const sellCount = included.filter((r) => r.type === "sell").length;
  const dividendCount = included.filter((r) => r.type === "dividend").length;
  const depositCount = included.filter((r) => r.type === "deposit").length;
  const withdrawalCount = included.filter((r) => r.type === "withdrawal").length;

  const handleFiles = async (files: FileList | File[]) => {
    const csvs = Array.from(files).filter(
      (f) => /\.csv$/i.test(f.name) || f.type === "text/csv",
    );
    if (csvs.length === 0) return;
    setBusy(true);
    const allRows: TradeRow[] = [];
    for (const file of csvs) {
      const text = await file.text();
      allRows.push(...parseTradeCsv(file.name, text));
    }
    setRows((prev) => [...prev, ...allRows]);
    setBusy(false);
  };

  /*
   * Registrations named by the CSV that no investment account carries. Shown in
   * review so the user can add the account rather than having the trades land
   * somewhere arbitrary.
   */
  const unmatchedRegistrations = [
    ...new Set(
      included
        .map((r) => r.registration)
        .filter((reg): reg is Registration => reg !== null && !accountIdFor(reg)),
    ),
  ];
  const unreadableRows = rows.filter((r) => r.registration === null).length;
  const blocked = unmatchedRegistrations.length > 0;

  const process = async () => {
    setProcessing(true);
    const { positions, cashDeltas, transfers } = accumulatePositions(
      included,
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
      } else if (input.shares > 0) {
        addHolding(input);
        created++;
      }
    }

    for (const t of transfers) {
      // Money moving in or out of a brokerage is a transfer between two of your
      // own accounts, not income or spending: it does not change net worth, it
      // just changes where the money sits.
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
          note: `Historical import: ${label} ${t.deposit ? "deposit" : "withdrawal"}`,
        });
      }
    }

    for (const [accountId, delta] of cashDeltas) {
      adjustAccountCash(accountId, Math.round(delta * 100) / 100);
    }

    setResult({
      created,
      updated,
      deposits: transfers.filter((t) => t.deposit).length,
      withdrawals: transfers.filter((t) => !t.deposit).length,
    });
    setProcessing(false);
    setStep("done");
  };

  if (!ready) return <PageSkeleton />;

  return (
    <Shell
      title="Import historical trades"
      subtitle="Import buy, sell, dividend, deposit & withdrawal data from CSV"
    >
      <div className="space-y-4">
        {step === "upload" && (
          <Card className="p-6">
            <h3 className="text-sm font-semibold">Upload CSV</h3>
            <p className="mt-1 text-xs text-ink-faint">
              Expected columns:{" "}
              <code className="text-[11px]">Date, Type, Ticker, Quantity, Price per unit, Transacted amount, account type, Manual CAD Conversion</code>
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
                {busy ? "Parsing..." : "Drop CSV files here, or click to browse"}
              </p>
              <p className="text-xs text-ink-faint">
                Type can be: buy, sell, dividend, deposit, withdrawal
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

            {rows.length > 0 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-ink-dim">
                  {rows.length} row{rows.length === 1 ? "" : "s"} parsed
                </p>
                <Button onClick={() => setStep("review")}>
                  Review {rows.length} row{rows.length === 1 ? "" : "s"}
                  <ArrowRight size={14} />
                </Button>
              </div>
            )}
          </Card>
        )}

        {step === "review" && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Card className="p-3">
                <p className="text-[11px] font-medium text-ink-dim">Buys</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{buyCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-medium text-ink-dim">Sells</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{sellCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-medium text-ink-dim">Dividends</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{dividendCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-medium text-ink-dim">Deposits</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-positive">{depositCount}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-medium text-ink-dim">Withdrawals</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-negative">{withdrawalCount}</p>
              </Card>
            </div>

            <Card>
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <p className="text-xs font-medium text-ink-dim">
                  {included.length} of {rows.length} selected
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setRows((p) => p.map((r) => ({ ...r, include: true })))}>
                    Include all
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRows((p) => p.map((r) => ({ ...r, include: false })))}>
                    Exclude all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>
                    <X size={14} /> Clear
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                      <th className="px-3 py-2 font-medium">In</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Ticker</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">CAD</th>
                      <th className="px-3 py-2 font-medium">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-line/40 last:border-0",
                          !r.include && "opacity-40",
                        )}
                      >
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2 tabular-nums">{r.date}</td>
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              r.type === "buy"
                                ? "brand"
                                : r.type === "sell"
                                  ? "negative"
                                  : r.type === "dividend"
                                    ? "positive"
                                    : r.type === "deposit"
                                      ? "positive"
                                      : "negative"
                            }
                          >
                            {r.type}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-medium">{r.ticker || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.quantity > 0 ? r.quantity.toLocaleString("en-US") : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.pricePerUnit > 0 ? fmtCAD(r.pricePerUnit, 2) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtCAD(r.transactedAmount, 2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {fmtCAD(r.amountCad, 2)}
                          {r.currency === "USD" && (
                            <span
                              className="ml-1 rounded bg-elevated px-1 py-px text-[9px] font-medium text-amber-400"
                              title="Converted in the export, so this is a US-listed security"
                            >
                              USD
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.registration ? (
                            <Badge
                              tone={accountIdFor(r.registration) ? undefined : "negative"}
                            >
                              {REGISTRATION_LABELS[r.registration]}
                            </Badge>
                          ) : (
                            <span title={r.error}>
                              <Badge tone="negative">unreadable</Badge>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/*
              * Refusing the import beats guessing. The old fallback filed
              * unmatched trades into whichever investment account came first,
              * which is how a whole portfolio ended up in one account.
              */}
            {blocked && (
              <Card className="border-negative/40 bg-negative/5 p-4">
                <p className="text-xs font-semibold text-negative">
                  No account for{" "}
                  {unmatchedRegistrations.map((r) => REGISTRATION_LABELS[r]).join(", ")}
                </p>
                <p className="mt-1 text-xs text-ink-dim">
                  These trades name an account you have not created yet. Add an
                  investment account with the matching registration on the Accounts
                  page, then come back — importing them into another account would
                  put them in the wrong place.
                </p>
              </Card>
            )}
            {unreadableRows > 0 && (
              <Card className="border-amber-500/40 bg-amber-500/5 p-4">
                <p className="text-xs font-semibold text-amber-400">
                  {unreadableRows} row{unreadableRows === 1 ? "" : "s"} have an
                  unreadable account type and are excluded
                </p>
                <p className="mt-1 text-xs text-ink-dim">
                  Check the &ldquo;account type&rdquo; column for those rows.
                  Recognized values include TFSA, RRSP, FHSA, Pension, and taxable
                  or non-registered.
                </p>
              </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setStep("upload")}>
                Back
              </Button>
              <Button
                onClick={process}
                disabled={included.length === 0 || processing || blocked}
              >
                {processing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                Import {included.length} row{included.length === 1 ? "" : "s"}
              </Button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-positive/10 text-positive">
              <CheckCircle2 size={28} />
            </span>
            <h2 className="mt-4 text-lg font-semibold">Import complete</h2>
            <div className="mt-3 flex flex-wrap justify-center gap-3 text-sm text-ink-dim">
              {result.created > 0 && (
                <span>
                  <span className="font-semibold text-ink">{result.created}</span> new holding{result.created !== 1 ? "s" : ""}
                </span>
              )}
              {result.updated > 0 && (
                <span>
                  <span className="font-semibold text-ink">{result.updated}</span> position{result.updated !== 1 ? "s" : ""} updated
                </span>
              )}
              {result.deposits > 0 && (
                <span className="text-positive">
                  <span className="font-semibold">{result.deposits}</span> deposit{result.deposits !== 1 ? "s" : ""}
                </span>
              )}
              {result.withdrawals > 0 && (
                <span className="text-negative">
                  <span className="font-semibold">{result.withdrawals}</span> withdrawal{result.withdrawals !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="mt-6 flex justify-center gap-2">
              <Button onClick={() => { setStep("upload"); setRows([]); setResult(null); }}>
                Import more
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
