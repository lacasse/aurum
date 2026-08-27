"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import {
  ImportedRow,
  ParseResult,
  parseCsvFile,
  suggestCategory,
  txnKey,
} from "@/lib/csv";
import { fmtCAD } from "@/lib/format";

type Step = "upload" | "review" | "done";

export default function ImportPage() {
  const ready = useReady();
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const merchantRules = useFinance((s) => s.merchantRules);
  const userCategories = useFinance((s) => s.categories);
  const addTransaction = useFinance((s) => s.addTransaction);
  const setMerchantRule = useFinance((s) => s.setMerchantRule);

  const [step, setStep] = useState<Step>("upload");
  const [files, setFiles] = useState<ParseResult[]>([]);
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [accountId, setAccountId] = useState("");
  const [importedCount, setImportedCount] = useState(0);
  const [learnedCount, setLearnedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(
    () => new Set(transactions.map((t) => txnKey(t.date, t.amount, t.payee))),
    [transactions],
  );

  const effectiveAccountId =
    accountId ||
    accounts.find((a) => a.kind === "credit")?.id ||
    accounts[0]?.id ||
    "";

  const totalRows = files.reduce((s, f) => s + f.rows.length, 0);
  const included = rows.filter((r) => r.include);
  const includedExpenses = included
    .filter((r) => r.type === "expense")
    .reduce((s, r) => s + r.amount, 0);
  const includedIncome = included
    .filter((r) => r.type === "income")
    .reduce((s, r) => s + r.amount, 0);
  const dupCount = rows.filter((r) => r.dup).length;

  const handleFiles = async (list: FileList | File[]) => {
    const csvs = Array.from(list).filter(
      (f) => /\.csv$/i.test(f.name) || f.type === "text/csv",
    );
    if (csvs.length === 0) return;
    setBusy(true);
    const results = await Promise.all(
      csvs.map((f) => parseCsvFile(f, existingKeys, merchantRules, userCategories)),
    );
    setFiles((prev) => [...prev, ...results]);
    setRows((prev) => [...prev, ...results.flatMap((r) => r.rows)]);
    setBusy(false);
  };

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.fileName !== name));
    setRows((prev) => prev.filter((r) => r.sourceFile !== name));
  };

  const updateRow = (id: string, patch: Partial<ImportedRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

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
    updateRow(row.id, { type, category: s.category, suggestedCategory: s.category, confident: s.confident });
  };

  const save = () => {
    const valid = included.filter(
      (r) => r.payee.trim() && r.amount > 0 && r.date && effectiveAccountId,
    );
    let learned = 0;
    for (const r of valid) {
      addTransaction({
        date: r.date,
        type: r.type,
        amount: r.amount,
        category: r.category,
        accountId: effectiveAccountId,
        payee: r.payee.trim(),
        note: r.note,
      });
      if (r.category !== r.suggestedCategory) {
        setMerchantRule(r.payee, r.category);
        learned += 1;
      }
    }
    setImportedCount(valid.length);
    setLearnedCount(learned);
    setRows([]);
    setFiles([]);
    setStep("done");
  };

  if (!ready) return <PageSkeleton />;

  return (
    <Shell
      title="Import transactions"
      subtitle="Upload credit card CSV exports — nothing is saved until you review"
    >
      {step === "upload" ? (
        <div className="mx-auto max-w-3xl space-y-4">
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
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center transition-colors",
              dragOver
                ? "border-brand bg-brand/5"
                : "border-line bg-surface hover:border-brand/50",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <Upload size={22} />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {busy ? "Parsing…" : "Drop CSV files here, or click to browse"}
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-ink-faint">
                Multiple files are welcome. Both Amex-style exports and simple{" "}
                <code className="text-[11px]">transaction_date / merchant / amount</code>{" "}
                formats are detected automatically.
              </p>
            </div>
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

          {files.length > 0 ? (
            <Card>
              <CardHeader
                title="Uploaded files"
                subtitle={`${totalRows} transaction${totalRows === 1 ? "" : "s"} ready for review`}
              />
              <ul className="divide-y divide-line/60 px-2 pb-2">
                {files.map((f) => (
                  <li key={f.fileName} className="flex items-center gap-3 px-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-ink-dim">
                      <FileText size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {f.fileName}
                      </span>
                      {f.error ? (
                        <span className="block text-xs text-negative">{f.error}</span>
                      ) : (
                        <span className="block text-[11px] text-ink-faint">
                          {f.format === "amex" ? "Amex-style export" : "Standard format"} ·{" "}
                          {f.rows.length} row{f.rows.length === 1 ? "" : "s"}
                          {f.skippedPayments > 0
                            ? ` · ${f.skippedPayments} card payment${f.skippedPayments === 1 ? "" : "s"} skipped`
                            : ""}
                          {f.skippedInvalid > 0
                            ? ` · ${f.skippedInvalid} unusable row${f.skippedInvalid === 1 ? "" : "s"} skipped`
                            : ""}
                          {f.rows.length === 0 && !f.error ? " · no data rows found" : ""}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${f.fileName}`}
                      onClick={() => removeFile(f.fileName)}
                    >
                      <X size={15} />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-line/60 px-5 py-4">
                <Button disabled={totalRows === 0} onClick={() => setStep("review")}>
                  Review {totalRows} transaction{totalRows === 1 ? "" : "s"}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </Card>
          ) : null}

          <p className="text-center text-[11px] text-ink-faint">
            Card payments to the issuer are skipped automatically. Everything else can be
            adjusted or removed on the next step.
          </p>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-4 pb-24">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-[11px] font-medium text-ink-dim">Ready to import</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {included.length} of {rows.length}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-medium text-ink-dim">Expenses</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-negative">
                {fmtCAD(includedExpenses, 2)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-medium text-ink-dim">Credits / refunds</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-positive">
                {fmtCAD(includedIncome, 2)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-medium text-ink-dim">Possible duplicates</p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold tabular-nums",
                  dupCount > 0 ? "text-amber-500" : undefined,
                )}
              >
                {dupCount}
              </p>
            </Card>
          </div>

          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <p className="mb-1.5 text-xs font-medium text-ink-dim">
                  Import into account
                </p>
                <Select
                  value={effectiveAccountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.institution})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setRows((p) => p.map((r) => ({ ...r, include: true })))}>
                  Include all
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setRows((p) => p.map((r) => ({ ...r, include: false })))}>
                  Exclude all
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setRows((p) => p.filter((r) => r.include));
                  }}
                >
                  Remove excluded
                </Button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Charges post as expenses, refunds as income. Categories are guessed from the
              merchant — fix any you disagree with and Aurum remembers your choice next
              time.
            </p>
          </Card>

          <Card>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Upload size={26} />}
                title="No rows left"
                subtitle="Go back and upload a CSV to continue."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <th className="px-3 py-3 font-medium">In</th>
                      <th className="px-3 py-3 font-medium">Date</th>
                      <th className="px-3 py-3 font-medium">Merchant</th>
                      <th className="px-3 py-3 text-right font-medium">Amount</th>
                      <th className="px-3 py-3 font-medium">Type</th>
                      <th className="px-3 py-3 font-medium">Category</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                      <th className="px-3 py-3 font-medium">Source</th>
                      <th className="px-3 py-3 text-right font-medium">Del</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b border-line/50 last:border-0",
                          !r.include && "opacity-45",
                        )}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={r.include}
                            onChange={(e) => updateRow(r.id, { include: e.target.checked })}
                            aria-label={`Include ${r.payee}`}
                            className="h-4 w-4 accent-[var(--brand-strong)]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            value={r.date}
                            onChange={(e) => updateRow(r.id, { date: e.target.value })}
                            className="h-8 w-36 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            value={r.payee}
                            onChange={(e) => updateRow(r.id, { payee: e.target.value })}
                            className="h-8 w-52 px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.amount}
                            onChange={(e) =>
                              updateRow(r.id, { amount: Number(e.target.value) || 0 })
                            }
                            className="ml-auto h-8 w-24 px-2 py-1 text-right text-xs tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={r.type}
                            onChange={(e) => changeType(r, e.target.value as ImportedRow["type"])}
                            className="h-8 w-28 px-2 py-1 text-xs"
                          >
                            <option value="expense">Expense</option>
                            <option value="income">Refund</option>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={r.category}
                            onChange={(e) => updateRow(r.id, { category: e.target.value })}
                            className="h-8 w-36 px-2 py-1 text-xs"
                          >
                            {[...new Set([...userCategories, r.category])].map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex flex-wrap gap-1">
                            {r.dup ? (
                              <Badge tone="negative">
                                <AlertTriangle size={10} className="mr-1" /> duplicate?
                              </Badge>
                            ) : r.category !== r.suggestedCategory ? (
                              <Badge tone="brand">edited</Badge>
                            ) : r.confident ? (
                              <Badge tone="positive">auto</Badge>
                            ) : (
                              <Badge>guess</Badge>
                            )}
                          </span>
                        </td>
                        <td className="max-w-[140px] px-3 py-2">
                          <span className="block truncate text-[11px] text-ink-faint">
                            {r.sourceFile}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${r.payee}`}
                            onClick={() => setRows((p) => p.filter((x) => x.id !== r.id))}
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

          {/* Sticky action bar */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/90 backdrop-blur-md lg:left-60">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
              <div className="flex-1 text-xs text-ink-dim">
                <span className="font-semibold text-ink">{included.length}</span> selected ·{" "}
                <span className="text-negative">{fmtCAD(includedExpenses, 2)}</span> out ·{" "}
                <span className="text-positive">{fmtCAD(includedIncome, 2)}</span> in
              </div>
              <Button variant="secondary" onClick={() => setStep("upload")}>
                <ArrowLeft size={14} /> Files
              </Button>
              <Button onClick={save} disabled={included.length === 0 || !effectiveAccountId}>
                <CheckCircle2 size={15} />
                Import {included.length} transaction{included.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <div className="mx-auto max-w-md">
          <Card className="p-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-positive/10 text-positive">
              <CheckCircle2 size={28} />
            </span>
            <h2 className="mt-4 text-lg font-semibold">
              Imported {importedCount} transaction{importedCount === 1 ? "" : "s"}
            </h2>
            <p className="mt-2 text-sm text-ink-dim">
              Your dashboard, charts and budgets are up to date.
              {learnedCount > 0
                ? ` ${learnedCount} merchant rule${learnedCount === 1 ? "" : "s"} learned for next time.`
                : ""}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Link href="/transactions">
                <Button variant="secondary">
                  View transactions <ArrowRight size={14} />
                </Button>
              </Link>
              <Button onClick={() => setStep("upload")}>
                <Upload size={14} /> Import more
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </Shell>
  );
}
