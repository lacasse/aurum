"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Upload,
} from "lucide-react";
import { Badge, Button, Field, Input, Modal, Select, cn } from "@/components/ui";
import { TradeEntry, type TradeDraft } from "@/components/forms";
import {
  clearAnswered,
  contributionRoom,
  deferAsks,
  roomAsks,
  type ContributionLimits,
  type RoomAsk,
  type RoomDeferrals,
} from "@/lib/contributions";
import type { TradeBatch, TradeInput } from "@/lib/trade-batch";
import { useFinance } from "@/lib/store";
import {
  fmtCAD,
  labelMonth,
  lastCompleteMonthKey,
  previousMonthKey,
} from "@/lib/format";
import {
  ImportedRow,
  CARD_PAYMENT_PAYEE,
  cashRowSides,
  chooseCategory,
  chooseDebt,
  countKeys,
  describeSigns,
  isUnnamedDebit,
  nameFromHistory,
  reconcileCardPayments,
  txnKey,
} from "@/lib/csv";
import { CHEQUING_HINT } from "@/lib/activities";
import {
  TradeRow,
  accumulatePositions,
  markAlreadyImported,
  tradeKey,
  transferFor,
} from "@/lib/trades";
import { RoutedFile, accountForHint, labelFor, routeFile } from "@/lib/import-router";
import {
  incomeBoxes,
  describeTrim,
  partitionByMonth,
  previousMonthIncome,
  type IncomeBox,
  tradeDraftFrom,
  unconvertedPrices,
} from "@/lib/checklist";
import {
  INCOME_CATEGORIES,
  alphabetical,
  REGISTRATION_LABELS,
  type Registration,
  isInvestmentAccount,
  isLiability,
  isPension,
  sidesFor,
  conflictingGranularity,
} from "@/lib/types";
import { DEBT_CATEGORY } from "@/lib/expenses";
import {
  CorporateAction,
  applyAction,
  describeAction,
} from "@/lib/corporate-actions";
import { planTrades } from "@/lib/trade-batch";
import { contributionsByMonth, estimateValue } from "@/lib/pension";
import { getSettings, saveSettings } from "@/lib/api";
import { GoalComposer, useGoals } from "./goals";
import { describe as describeGoal } from "@/lib/goals";

type Step =
  | "import"
  | "income"
  | "expenses"
  | "actions"
  | "trades"
  | "pension"
  | "room"
  | "goals"
  | "review";

/**
 * Everything the checklist intends to write, and has not written.
 *
 * Each step used to save as you left it, which meant abandoning the checklist
 * halfway left half a month in the database — income recorded against a month
 * whose spending was never reviewed, or trades posted before the snapshot that
 * was supposed to value them. Now every step fills in part of this and the
 * last step writes the lot, so the month either lands whole or not at all.
 */
interface Draft {
  /** Box key to the figure typed in it. */
  income: Record<string, string>;
  /** Which boxes existed when income was filled in, for their categories. */
  incomeBoxes: IncomeBox[];
  trades: { batch: TradeBatch; rows: TradeInput[] } | null;
  pension: { values: Record<string, string>; estimate: boolean } | null;
}

const EMPTY_DRAFT: Draft = {
  income: {},
  incomeBoxes: [],
  trades: null,
  pension: null,
};

/**
 * What the checklist carries from step to step.
 *
 * The import used to save its rows and forget them, which is why the income
 * step could only ask. Now the file is read once at the top and every step
 * after it works on what came out — income totals it, expenses reviews it,
 * trades opens on it — and each writes only its own share.
 */
interface Loaded {
  files: RoutedFile[];
  cash: ImportedRow[];
  trades: TradeRow[];
  /*
   * Mergers and demergers found in the files. They were parsed and thrown away
   * here — only the import page could apply one — so a month closed through
   * the checklist recorded the sale of shares whose cost base the action had
   * never moved, and the gain came out of thin air.
   */
  actions: CorporateAction[];
  trimmedCash: { older: number; newer: number };
  trimmedTrades: { older: number; newer: number };
  /**
   * The card each card statement belongs to, chosen by hand.
   *
   * A card statement does not name its card. The save used to file every one
   * against the first card on record, so with two cards one statement's
   * purchases all landed on the other.
   */
  cardFor: Record<string, string>;
}

const EMPTY_LOAD: Loaded = {
  files: [],
  cash: [],
  trades: [],
  actions: [],
  trimmedCash: { older: 0, newer: 0 },
  trimmedTrades: { older: 0, newer: 0 },
  cardFor: {},
};

function StepIndicator({
  steps,
  current,
  onJump,
}: {
  steps: { key: Step; label: string }[];
  current: Step;
  onJump: (step: Step) => void;
}) {
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <nav aria-label="Checklist progress" className="flex items-center gap-1">
      {steps.map((s, i) => {
        const done = i < idx;
        const here = i === idx;
        return (
          <div key={s.key} className="flex min-w-0 items-center">
            <button
              type="button"
              // Only steps already passed are reachable: jumping forward would
              // skip the one that was meant to record something.
              disabled={!done}
              onClick={() => onJump(s.key)}
              aria-current={here ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-xs font-medium transition-colors",
                done && "text-positive hover:bg-elevated",
                here && "bg-brand/10 text-brand",
                !done && !here && "text-ink-faint",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold",
                  done
                    ? "bg-positive/20 text-positive"
                    : here
                      ? "bg-brand/20 text-brand"
                      : "bg-elevated text-ink-faint",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              {/*
                * Only the step you are on is named at every width. Five labels
                * and four chevrons do not fit the dialog, and the ones that
                * did not fit were simply clipped off its right edge.
                */}
              <span className={cn("truncate", here ? "inline" : "hidden sm:inline")}>
                {s.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <ChevronRight size={12} className="shrink-0 text-ink-faint" />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * One step's frame: its heading, its explanation, and the row of buttons that
 * leaves it.
 *
 * Every step used to build its own, as a `Card` inside the dialog — a second
 * border and a second set of padding drawn on top of the first, and five
 * slightly different footer layouts. This is the frame; the steps supply
 * what goes in it.
 */
function StepBody({
  number,
  total,
  title,
  lead,
  children,
  note,
  onBack,
  actions,
}: {
  number: number;
  total: number;
  title: string;
  lead: ReactNode;
  children?: ReactNode;
  note?: ReactNode;
  onBack?: () => void;
  actions: ReactNode;
}) {
  return (
    <section>
      <h3 className="text-sm font-semibold">
        <span className="text-ink-faint">
          Step {number} of {total}
        </span>{" "}
        · {title}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{lead}</p>
      {children ? <div className="mt-4">{children}</div> : null}
      {note ? (
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">{note}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {onBack ? (
          <Button variant="ghost" onClick={onBack} className="mr-auto">
            <ArrowLeft size={14} /> Back
          </Button>
        ) : null}
        {actions}
      </div>
    </section>
  );
}

/* ---------- Step 1: Income ---------- */

interface StepProps {
  number: number;
  total: number;
  /** The month being closed. Everything before the pension step is about it. */
  month: string;
  onNext: () => void;
  onBack?: () => void;
}

/* ---------- Step 1: Import ---------- */

/**
 * The file, read once, for everything it holds.
 *
 * This used to parse card statements only and save them on the spot. It now
 * routes each file the way the Import page does — a statement, an activity
 * export or a trade log — and hands the result to the steps that follow
 * instead of writing anything itself. Nothing reaches the database until the
 * step responsible for it says so.
 */
function ImportStep({
  number,
  total,
  month,
  onNext,
  onBack,
  loaded,
  onLoaded,
}: StepProps & {
  loaded: Loaded;
  onLoaded: (l: Loaded) => void;
}) {
  const transactions = useFinance((s) => s.transactions);
  const accounts = useFinance((s) => s.accounts);
  const merchantRules = useFinance((s) => s.merchantRules);
  const userCategories = useFinance((s) => s.categories);
  const holdings = useFinance((s) => s.holdings);

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingKeys = useMemo(
    () => countKeys(transactions.map((t) => txnKey(t.date, t.amount, t.payee))),
    [transactions],
  );
  const existingTradeKeys = useMemo(
    () =>
      new Set(
        holdings.flatMap((h) =>
          h.flows.map((f) =>
            tradeKey({
              date: f.date,
              type: f.kind,
              ticker: h.ticker,
              quantity: Math.abs(f.shares),
              transactedAmount: f.amount,
              registrationRaw: "",
            }),
          ),
        ),
      ),
    [holdings],
  );

  const handleFiles = async (list: FileList | File[]) => {
    const csvs = Array.from(list).filter(
      (f) => /\.csv$/i.test(f.name) || f.type === "text/csv",
    );
    if (csvs.length === 0) return;
    setBusy(true);

    // Keys carry across the files of one import as well as across months, so
    // a statement downloaded twice is caught rather than counted twice.
    // Counted, not just collected: a key stored once covers one row. Only rows
    // that are new add to it — a row matched to a stored one is that row.
    const txnKeys = new Map(existingKeys);
    const carry = (rows: ImportedRow[]) => {
      for (const r of rows.filter((x) => !x.dup)) {
        const k = txnKey(r.date, r.amount, r.payee);
        txnKeys.set(k, (txnKeys.get(k) ?? 0) + 1);
      }
    };
    carry(loaded.cash);
    const tKeys = new Set([...existingTradeKeys, ...loaded.trades.map(tradeKey)]);
    const routed: RoutedFile[] = [];
    for (const file of csvs) {
      const res = await routeFile(file, txnKeys, tKeys, merchantRules, userCategories);
      carry(res.cash);
      for (const t of res.trades) tKeys.add(tradeKey(t));
      routed.push(res);
    }

    /*
     * Trimmed to the month being closed before anything else sees it. A
     * statement downloaded on the 3rd carries three days of the month still
     * running, and one downloaded late carries the month before — neither
     * belongs in this close, and both would land silently in the totals.
     */
    const cash = partitionByMonth(routed.flatMap((r) => r.cash), month);
    const trades = partitionByMonth(routed.flatMap((r) => r.trades), month);
    /*
     * Trimmed like everything else. An export covers several months, so an
     * action from an earlier one was offered again at every close after it —
     * a demerger already applied would be applied a second time.
     */
    const actions = partitionByMonth(routed.flatMap((r) => r.actions), month);

    const kinds = new Map([...loaded.files, ...routed].map((f) => [f.fileName, f.kind]));
    onLoaded({
      ...loaded,
      files: [...loaded.files, ...routed],
      // Across every file loaded so far: the bank's side of a card payment
      // usually arrives in a different export from the card's.
      cash: nameFromHistory(
        reconcileCardPayments(
          [...loaded.cash, ...cash.kept],
          transactions,
          accounts,
          (r) => r.accountHint === CHEQUING_HINT || kinds.get(r.sourceFile) === "bank",
        ),
        transactions,
        accounts,
      ),
      trades: [...loaded.trades, ...trades.kept],
      actions: [...loaded.actions, ...actions.kept],
      trimmedCash: {
        older: loaded.trimmedCash.older + cash.older.length,
        newer: loaded.trimmedCash.newer + cash.newer.length,
      },
      trimmedTrades: {
        older: loaded.trimmedTrades.older + trades.older.length + actions.older.length,
        newer: loaded.trimmedTrades.newer + trades.newer.length + actions.newer.length,
      },
    });
    setBusy(false);
  };

  const cards = accounts.filter((a) => a.kind === "credit");
  /*
   * A statement has to be put on a card before the month can move on. With
   * one card there is nothing to choose; with two, guessing is how one card's
   * purchases ended up on the other.
   */
  const unplaced =
    cards.length > 1
      ? loaded.files.filter((f) => f.kind === "card" && !f.error && !loaded.cardFor[f.fileName])
      : [];

  const label = labelMonth(month);
  const cashTrim = describeTrim(
    loaded.trimmedCash.older,
    loaded.trimmedCash.newer,
    label,
    "transactions",
  );
  const income = loaded.cash.filter((r) => r.type === "income").length;
  const expenses = loaded.cash.filter((r) => r.type === "expense").length;

  const picker = (
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
  );

  return (
    <StepBody
      number={number}
      total={total}
      title={`Import ${label}`}
      lead={
        <>
          Drop the statements and exports for {label}. Each file is read for
          what it holds — spending, income, trades and dividends — and only the
          rows dated inside {label} are kept. Nothing is saved until the steps
          that follow.
        </>
      }
      onBack={onBack}
      note={
        unplaced.length > 0
          ? `Choose the card for ${unplaced.length === 1 ? "this statement" : "each statement"} before going on.`
          : cashTrim || undefined
      }
      actions={
        <>
          <Button variant="ghost" onClick={onNext}>
            Skip import
          </Button>
          <Button onClick={onNext} disabled={loaded.files.length === 0 || unplaced.length > 0}>
            Next <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      {loaded.files.length === 0 ? (
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
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragOver
              ? "border-brand bg-brand/5"
              : "border-line bg-elevated/40 hover:border-brand/50",
          )}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          </span>
          <p className="text-sm font-medium">
            {busy ? "Reading…" : "Drop CSV files here, or click to browse"}
          </p>
          <p className="text-[0.6875rem] text-ink-faint">
            Whichever way your bank signs its amounts, the sign is worked out
            from the file. For anything older than {label}, use{" "}
            <Link
              href="/transactions"
              className="text-brand underline-offset-2 hover:underline"
            >
              Import, on Transactions
            </Link>
            .
          </p>
          {picker}
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {loaded.files.map((f) => (
              <li
                key={f.fileName}
                className="rounded-lg border border-line bg-elevated/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{f.fileName}</p>
                    <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                      {f.error ? (
                        <span className="text-negative">{f.error}</span>
                      ) : (
                        <>
                          Read as {labelFor(f.kind)}
                          {f.signs ? <> · {describeSigns(f.signs)}</> : null}
                        </>
                      )}
                    </p>
                  </div>
                  {f.kind === "card" && !f.error && cards.length > 1 ? (
                    <Select
                      value={loaded.cardFor[f.fileName] ?? ""}
                      onChange={(e) =>
                        onLoaded({
                          ...loaded,
                          cardFor: { ...loaded.cardFor, [f.fileName]: e.target.value },
                        })
                      }
                      aria-label={`Card for ${f.fileName}`}
                      className={cn(
                        "h-7 w-44 py-0 text-[0.6875rem]",
                        !loaded.cardFor[f.fileName] && "border-amber-500/50",
                      )}
                    >
                      <option value="">Which card?</option>
                      {cards.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 text-xs text-ink-dim">
            <span>
              <strong className="text-ink">{income}</strong> income
            </span>
            <span>
              <strong className="text-ink">{expenses}</strong> expense
            </span>
            <span>
              <strong className="text-ink">{loaded.trades.length}</strong> trade
            </span>
            <span className="text-ink-faint">rows in {label}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => inputRef.current?.click()}
            >
              <Upload size={13} /> Add file
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-ink-faint"
              onClick={() => onLoaded(EMPTY_LOAD)}
            >
              Clear
            </Button>
          </div>
          {picker}
        </div>
      )}
    </StepBody>
  );
}

/* ---------- Step 2: Income ---------- */

/**
 * The month's income, taken from the file where the file had it — and shown
 * row by row, because detection is a guess.
 *
 * Each box opens at what the import found under its category and stays
 * editable, because a statement is not always the whole story — a payment in
 * cash, or a deposit that has not cleared, is a number only the person knows.
 * Categories that were found but are not among the four always asked for get
 * their own box, so nothing detected is quietly folded into "additional" or
 * dropped.
 *
 * Under the boxes sits every row the import read as income. A deposit filed
 * under the wrong heading, or one that is not income at all — a transfer
 * between your own accounts reads exactly like pay — can be recategorised or
 * dropped here, and the boxes above follow. A box typed into by hand stops
 * following, since a correction should not be undone by the next edit below.
 */
function IncomeStep({
  number,
  total,
  month,
  onNext,
  onBack,
  boxes,
  draft,
  onDraft,
  rows,
  onRows,
}: StepProps & {
  boxes: IncomeBox[];
  draft: Record<string, string>;
  onDraft: (values: Record<string, string>, boxes: IncomeBox[]) => void;
  rows: ImportedRow[];
  onRows: (rows: ImportedRow[]) => void;
}) {
  const detectedValue = (b: IncomeBox) => {
    if (b.detected > 0) return b.detected.toFixed(2);
    return b.carried !== undefined ? b.carried.toFixed(2) : "";
  };

  /*
   * Only what was typed by hand is held here; everything else is read off the
   * detection each render. That is what lets the boxes follow a row being
   * re-filed below without a hand-typed correction being undone by it.
   *
   * On a return visit which is which cannot be known directly, so it is
   * inferred: a saved figure that differs from what the import found was typed.
   */
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      boxes
        .filter(
          (b) => draft[b.key] !== undefined && draft[b.key] !== detectedValue(b),
        )
        .map((b) => [b.key, draft[b.key]]),
    ),
  );

  const values: Record<string, string> = Object.fromEntries(
    boxes.map((b) => [b.key, typed[b.key] ?? detectedValue(b)]),
  );

  const entered = boxes.reduce((sum, b) => sum + (Number(values[b.key]) || 0), 0);
  const detected = boxes.reduce((sum, b) => sum + b.detected, 0);
  const found = boxes.filter((b) => b.rows > 0);

  const earned = rows.filter((r) => r.type === "income");
  const kept = earned.filter((r) => r.include);

  const patch = (id: string, change: Partial<ImportedRow>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const submit = () => {
    onDraft(values, boxes);
    onNext();
  };

  return (
    <StepBody
      number={number}
      total={total}
      title={`Income for ${labelMonth(month)}`}
      lead={
        found.length > 0
          ? "Filled in from the import. Check the rows it read as income, then change anything the file got wrong or add what it never saw."
          : "Nothing was imported, so these are yours to enter. Each box with a figure in it becomes one income transaction."
      }
      onBack={onBack}
      note={
        <>
          Total{" "}
          <span className="font-semibold text-positive tabular-nums">
            {fmtCAD(entered, 2)}
          </span>
          , to be dated {monthEnd(month)} — the last day of the month being
          closed, whatever day the checklist is done on.
          {earned.length > 0 && (
            <>
              {" "}
              The import found {fmtCAD(detected, 2)} across {kept.length} of{" "}
              {earned.length} rows.
            </>
          )}
        </>
      }
      actions={
        <Button onClick={submit}>
          Next <ArrowRight size={14} />
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {boxes.map((box) => (
          <Field
            key={box.key}
            label={box.label}
            hint={
              box.rows > 0
                ? `${box.rows} row${box.rows === 1 ? "" : "s"} imported`
                : box.carried !== undefined
                  ? `same as ${labelMonth(previousMonthKey(month))}`
                  : undefined
            }
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={values[box.key] ?? ""}
              onChange={(e) =>
                setTyped((prev) => ({ ...prev, [box.key]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>

      {earned.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 text-[0.6875rem] text-ink-faint">
            Rows the import read as income. Uncheck anything that is not income
            — a transfer between your own accounts looks much like pay — or
            move it to the right heading.
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-[0.625rem] uppercase tracking-wider text-ink-faint">
                  <th className="w-8 px-2 py-1.5 font-medium">Keep</th>
                  <th className="px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Category</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {earned.map((r) => (
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
                        aria-label={`Keep ${r.payee}`}
                        onChange={(e) =>
                          patch(r.id, { include: e.target.checked })
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand-strong)]"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                      {r.date}
                    </td>
                    <td className="max-w-[170px] truncate px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{r.payee}</span>
                        {r.dup ? <Badge>seen before</Badge> : null}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select
                        value={r.category}
                        onChange={(e) =>
                          patch(r.id, { category: e.target.value })
                        }
                        aria-label={`Category for ${r.payee}`}
                        className={cn(
                          "h-7 w-auto py-0 text-[0.6875rem]",
                          !r.confident && "border-amber-500/50",
                        )}
                      >
                        {alphabetical(INCOME_CATEGORIES).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-positive">
                      {fmtCAD(r.amount, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </StepBody>
  );
}

/* ---------- Step 3: Expenses ---------- */

/**
 * Every expense the import found, before any of it is kept.
 *
 * The categories are guesses — a keyword match, or the statement's own
 * taxonomy translated — and a guess corrected here is remembered for the
 * merchant, so the same statement next month arrives already right. Rows can
 * also simply be dropped: a reimbursed lunch or a charge already recorded by
 * hand is not this month's spending.
 */
function ExpensesStep({
  number,
  total,
  month,
  onNext,
  onBack,
  rows,
  onRows,
  files,
  cardFor,
}: StepProps & {
  rows: ImportedRow[];
  onRows: (rows: ImportedRow[]) => void;
  files: RoutedFile[];
  cardFor: Record<string, string>;
}) {
  const userCategories = useFinance((s) => s.categories);
  /*
   * Selected as the whole array and filtered here, not filtered inside the
   * selector.
   *
   * A selector runs on every store read and its result is compared by
   * identity, so one that builds a new array hands back something different
   * every time — the store looks changed, the component re-renders, the
   * selector runs again. React caught that as "maximum update depth exceeded"
   * and took the whole page down with it, which is what this step did between
   * the day the debt question was added and the day someone reached step three
   * of the checklist.
   */
  const allAccounts = useFinance((s) => s.accounts);
  const debts = useMemo(
    () => allAccounts.filter((a) => isLiability(a.kind)),
    [allAccounts],
  );
  const debtName = (id: string) => allAccounts.find((a) => a.id === id)?.name;

  /*
   * The month's money out, as one list. A card payment is shown as itself —
   * the payment, to the card — in place of the bank's debit for it, which says
   * only "Pre-authorized Debit" and is left out so the payment counts once.
   */
  const isPayment = (r: ImportedRow) => r.type === "transfer" && r.payee === CARD_PAYMENT_PAYEE;
  const spend = rows.filter(
    (r) => (r.type === "expense" && !r.paysCard) || isPayment(r),
  );
  /*
   * A row already in the record is part of this month all the same. It used
   * to arrive unticked and marked as seen, which read as the import refusing a
   * real payment — an export downloaded on the 1st carries that day, so the
   * rent paid on the 1st was stored a month early and the close then appeared
   * to be missing it. It is shown ticked and counted, and the save does not
   * write it a second time.
   */
  const counts = (r: ImportedRow) => r.include || r.dup;
  const cardName = (r: ImportedRow) => {
    const id =
      cardFor[r.sourceFile] ||
      (files.find((f) => f.fileName === r.sourceFile)?.kind === "card"
        ? allAccounts.find((a) => a.kind === "credit")?.id
        : undefined);
    return allAccounts.find((a) => a.id === id)?.name ?? "the card";
  };
  /*
   * A repayment is the one row whose far side cannot be guessed. Every other
   * expense ends at the merchant; this one ends at a debt, and which debt
   * decides whose balance goes down.
   */
  const repayments = spend.filter(
    (r) => r.type === "expense" && r.include && r.category === DEBT_CATEGORY,
  );
  const unassigned = repayments.filter((r) => !r.debtAccountId);
  const included = spend.filter(counts);
  const totalSpend = included
    .filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + r.amount, 0);
  const willLearn = included.filter(
    (r) => r.include && r.category !== r.suggestedCategory,
  ).length;

  const patch = (id: string, change: Partial<ImportedRow>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  return (
    <StepBody
      number={number}
      total={total}
      title={`Review ${labelMonth(month)}'s spending`}
      lead={
        spend.length > 0
          ? "Uncheck anything that should not count, and correct any category that is wrong. A correction is remembered for that merchant when the month is saved."
          : "Nothing to review — no spending was imported for this month."
      }
      onBack={onBack}
      note={
        spend.length > 0 ? (
          <>
            {included.length} of {spend.length} rows kept,{" "}
            <span className="font-semibold tabular-nums">{fmtCAD(totalSpend, 2)}</span>{" "}
            spent
            {willLearn > 0 ? (
              <>
                , with {willLearn}{" "}
                {willLearn === 1 ? "correction" : "corrections"} to be
                remembered for next month
              </>
            ) : null}
            .
            {unassigned.length > 0 && debts.length > 0 ? (
              <>
                {" "}
                <span className="text-amber-500">
                  {unassigned.length}{" "}
                  {unassigned.length === 1 ? "repayment has" : "repayments have"}{" "}
                  no debt chosen
                </span>{" "}
                — they will be recorded as spending, and no balance will go
                down.
              </>
            ) : null}
          </>
        ) : undefined
      }
      actions={
        <Button onClick={onNext}>
          Next <ArrowRight size={14} />
        </Button>
      }
    >
      {spend.length === 0 ? (
        <p className="text-xs text-ink-faint">
          Import a statement on the previous step, or record spending by hand
          from the Transactions page.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border border-line">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-[0.625rem] uppercase tracking-wider text-ink-faint">
                <th className="w-8 px-2 py-1.5 font-medium">Keep</th>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Merchant</th>
                <th className="px-2 py-1.5 font-medium">Category</th>
                <th className="px-2 py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {spend.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "border-b border-line/40 last:border-0",
                    !counts(r) && "opacity-40",
                  )}
                >
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={counts(r)}
                      disabled={r.dup}
                      title={r.dup ? "Already in your records, so it counts and is not saved again" : undefined}
                      aria-label={`Keep ${r.payee}`}
                      onChange={(e) => patch(r.id, { include: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[var(--brand-strong)]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                    {r.date}
                  </td>
                  <td className="max-w-[170px] truncate px-2 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {/*
                        * The bank names a pre-authorized debit and nothing
                        * else, so it is the one merchant worth typing. The
                        * name is kept with the payment, and next month a
                        * debit of the same amount is named and filed from it.
                        */}
                      {isPayment(r) ? (
                        <span className="truncate">Payment to {cardName(r)}</span>
                      ) : isUnnamedDebit(r.note ?? "") && r.category !== DEBT_CATEGORY ? (
                        <Input
                          value={isUnnamedDebit(r.payee) ? "" : r.payee}
                          placeholder="Who was paid?"
                          onChange={(e) => patch(r.id, { payee: e.target.value })}
                          onBlur={(e) => {
                            if (!e.target.value.trim()) patch(r.id, { payee: r.note ?? r.payee });
                          }}
                          aria-label={`Recipient of the pre-authorized debit on ${r.date}`}
                          className="h-7 w-36 py-0 text-[0.6875rem]"
                        />
                      ) : (
                        <span className="truncate">{r.payee}</span>
                      )}
                      {r.dup ? <Badge>recorded earlier</Badge> : null}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {isPayment(r) ? (
                      <span className="text-[0.6875rem] text-ink-dim">Card payment</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Select
                          disabled={r.dup}
                          value={r.category}
                          onChange={(e) => patch(r.id, chooseCategory(r, e.target.value, debtName))}
                          aria-label={`Category for ${r.payee}`}
                          className={cn(
                            "h-7 w-36 py-0 text-[0.6875rem]",
                            // Amber where the guess was weak, so the eye goes to
                            // the rows actually worth checking.
                            !r.confident && "border-amber-500/50",
                          )}
                        >
                          {alphabetical(userCategories).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </Select>
                        {r.category === DEBT_CATEGORY && debts.length > 0 ? (
                          <Select
                            value={r.debtAccountId ?? ""}
                            onChange={(e) =>
                              patch(r.id, chooseDebt(r, e.target.value, debtName))
                            }
                            aria-label={`Debt paid by ${r.payee}`}
                            className={cn(
                              "h-7 w-36 py-0 text-[0.6875rem]",
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
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                    {fmtCAD(r.amount, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StepBody>
  );
}

/* ---------- Step 4: Trades ---------- */

/* ---------- Step: mergers and demergers ---------- */

/**
 * Corporate actions found in the files, before the trades that depend on them.
 *
 * Rare enough that the step only exists when a file carried one — an empty
 * step every month, for something that happens twice a decade, is a step
 * people learn to click past. But when one does turn up it has to be handled
 * before the sale in the same file: the action decides what the new shares
 * cost, and a sale measured against a basis the action never moved reports a
 * gain that never happened.
 */
function ActionsStep({
  number,
  total,
  month,
  onNext,
  onBack,
  actions,
  onActions,
}: StepProps & {
  actions: CorporateAction[];
  onActions: (a: CorporateAction[]) => void;
}) {
  const holdings = useFinance((s) => s.holdings);
  const accounts = useFinance((s) => s.accounts);
  const patch = (id: string, change: Partial<CorporateAction>) =>
    onActions(actions.map((a) => (a.id === id ? { ...a, ...change } : a)));

  const holdingFor = (ticker: string, registration: CorporateAction["registration"]) => {
    const accountId = registration
      ? (accounts.find(
          (a) => isInvestmentAccount(a.kind) && a.registration === registration,
        )?.id ?? "")
      : "";
    return holdings.find(
      (h) =>
        h.ticker.toUpperCase() === ticker.toUpperCase() &&
        (!accountId || h.accountId === accountId),
    );
  };

  const included = actions.filter((a) => a.include);
  const missing = included.filter((a) => !holdingFor(a.from, a.registration));

  return (
    <StepBody
      number={number}
      total={total}
      title={`Mergers and demergers in ${labelMonth(month)}`}
      lead="A share of the parent's cost basis follows the new shares — the company publishes the split. Applied before the trades, so a sale afterwards is measured against the basis this leaves behind."
      onBack={onBack}
      note={
        missing.length > 0
          ? `${missing.map((a) => a.from).join(", ")} — no position found to start from, so ${missing.length === 1 ? "this one" : "these"} cannot be applied.`
          : undefined
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => { onActions(actions.map((a) => ({ ...a, include: false }))); onNext(); }}>
            Skip
          </Button>
          <Button onClick={onNext}>
            Next <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
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
                  onChange={(e) => patch(a.id, { include: e.target.checked })}
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
                        patch(a.id, { allocationPct: Number(e.target.value) || 0 })
                      }
                      className="h-7 w-20 py-0 text-right text-[0.6875rem]"
                      aria-label={`Percentage of ${a.from} cost basis moving to ${a.to}`}
                    />
                    %
                  </label>
                )}
              </div>
              <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
                {parent
                  ? describeAction(a, applied?.movedBasis ?? 0)
                  : `No ${a.from} position found in this account — nothing to move a cost basis from.`}
              </p>
            </li>
          );
        })}
      </ul>
    </StepBody>
  );
}

function TradesStep({
  number,
  total,
  month,
  onNext,
  onBack,
  drafts,
  unreadable,
  staged,
  onStage,
}: StepProps & {
  drafts: TradeDraft[];
  unreadable: number;
  staged: { batch: TradeBatch; rows: TradeInput[] } | null;
  onStage: (staged: { batch: TradeBatch; rows: TradeInput[] } | null) => void;
}) {
  /*
   * The form keeps its own validation and its own error line; only the button
   * moves out, down to the step footer where every other step's is.
   */
  const submit = useRef<(() => void) | null>(null);

  return (
    <StepBody
      number={number}
      total={total}
      title={`Trades in ${labelMonth(month)}`}
      lead={
        drafts.length > 0
          ? "Read out of the import. Check the numbers and the account, then add them to the month."
          : "Anything the import did not carry: buys, sells or dividends recorded somewhere else."
      }
      onBack={onBack}
      note={
        staged
          ? `${staged.batch.trades} trade${staged.batch.trades === 1 ? "" : "s"} ready${
              staged.batch.created > 0
                ? `, opening ${staged.batch.created} new position${
                    staged.batch.created === 1 ? "" : "s"
                  }`
                : ""
            }. Check them over on the last step before anything is written.`
          : unreadable > 0
            ? `${unreadable} row${unreadable === 1 ? "" : "s"} in the file named an activity or account this app does not recognise, and ${unreadable === 1 ? "was" : "were"} left out.`
            : undefined
      }
      actions={
        <>
          <Button variant="ghost" onClick={onNext}>
            {staged ? "Next" : drafts.length > 0 ? "Skip" : "Nothing to add"}
          </Button>
          <Button onClick={() => submit.current?.()}>
            {staged ? "Update these trades" : "Add these trades to the month"}
          </Button>
        </>
      }
    >
      {/*
        * Keyed on the drafts so that arriving with a different import remounts
        * the form. Its rows are seeded once on mount, which is what keeps an
        * edit in progress from being overwritten.
        */}
      <TradeEntry
        key={drafts.length}
        initial={drafts}
        hideSubmit
        submitRef={submit}
        onStage={(batch, rows) => onStage({ batch, rows })}
      />
    </StepBody>
  );
}

/* ---------- Step 7: Review and save ---------- */

interface PlannedChange {
  label: string;
  detail: string;
  count: number;
}

/**
 * The one place the month is written.
 *
 * Everything above collects; this applies. Listing it first is not decoration
 * — the checklist touches five different kinds of record, and "save" with no
 * statement of what is about to be saved is a button you press hopefully.
 */
function ReviewStep({
  number,
  total,
  month,
  onBack,
  onDone,
  draft,
  cash,
  files,
  actions,
  trades,
  cardFor,
}: {
  number: number;
  total: number;
  month: string;
  onBack?: () => void;
  onDone: () => void;
  draft: Draft;
  cash: ImportedRow[];
  files: RoutedFile[];
  actions: CorporateAction[];
  /** Everything the import read for the positions; only its money movements are used here. */
  trades: TradeRow[];
  cardFor: Record<string, string>;
}) {
  const addTransaction = useFinance((s) => s.addTransaction);
  const setMerchantRule = useFinance((s) => s.setMerchantRule);
  const addHolding = useFinance((s) => s.addHolding);
  const updateHolding = useFinance((s) => s.updateHolding);
  const adjustAccountCash = useFinance((s) => s.adjustAccountCash);
  const updateAccount = useFinance((s) => s.updateAccount);
  const recordEstimatedBalance = useFinance((s) => s.recordEstimatedBalance);
  const saveSnapshots = useFinance((s) => s.saveSnapshots);
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const transactions = useFinance((s) => s.transactions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pensions = accounts.filter((a) => isPension(a.kind));

  /*
   * The action's parent, found in the account it happened in: the same ticker
   * held elsewhere is a different position with its own cost base, and moving
   * the wrong one restates a basis nobody touched.
   */
  const holdingForAction = (
    ticker: string,
    registration: CorporateAction["registration"],
  ) => {
    const accountId = registration
      ? (accounts.find(
          (a) => isInvestmentAccount(a.kind) && a.registration === registration,
        )?.id ?? "")
      : "";
    return holdings.find(
      (h) =>
        h.ticker.toUpperCase() === ticker.toUpperCase() &&
        (!accountId || h.accountId === accountId),
    );
  };
  const includedActions = actions.filter(
    (a) => a.include && holdingForAction(a.from, a.registration),
  );

  /**
   * Which account a row of spending came out of.
   *
   * The row's own word first: an activity export names the account on every
   * line, and a pre-authorized debit out of chequing is not card spending
   * however the rest of the file was read. Then the file's kind — a card
   * statement is one account from top to bottom. The everyday account is the
   * last resort rather than the first: filing everything against the card is
   * exactly the mistake this replaced.
   */
  const cardId =
    accounts.find((a) => a.kind === "credit")?.id ?? accounts[0]?.id ?? "";
  const cashId =
    accounts.find((a) => a.kind === "checking")?.id ?? cardId;
  const accountForRow = (r: ImportedRow): string => {
    const named = accountForHint(r.accountHint, accounts);
    if (named) return named;
    const kind = files.find((f) => f.fileName === r.sourceFile)?.kind;
    return kind === "card" ? cardFor[r.sourceFile] || cardId : cashId;
  };
  const byMonth = useMemo(() => contributionsByMonth(transactions), [transactions]);

  /*
   * Money moving into or out of an investment account. Nothing else in the
   * checklist records it, so without this a month closed here held no
   * contribution at all. Checked against what is stored by the same rule the
   * import page uses, so a deposit already recorded — individually or inside a
   * month's total — is not written again.
   */
  const accountIdFor = (r: Registration) => accountForHint(r, accounts) ?? "";
  const moneyRows = useMemo(
    () =>
      markAlreadyImported(
        trades.filter(
          (t) =>
            (t.type === "deposit" || t.type === "withdrawal") && t.include && !t.duplicate,
        ),
        (r) => accountForHint(r, accounts) ?? "",
        holdings,
        transactions.filter((t) => t.type === "transfer"),
        new Set(accounts.filter((a) => isInvestmentAccount(a.kind)).map((a) => a.id)),
      ),
    [trades, accounts, holdings, transactions],
  );
  const moneyMoves = moneyRows.filter((r) => r.include);
  const heldBack = moneyRows.filter((r) => !r.include && !r.duplicate);

  const incomeRows = draft.incomeBoxes
    .map((b) => ({ box: b, amount: Number(draft.income[b.key]) || 0 }))
    .filter((r) => r.amount > 0);
  const incomeTotal = incomeRows.reduce((sum, r) => sum + r.amount, 0);

  const expenseRows = cash.filter((r) => r.type === "expense" && r.include);
  const paymentRows = cash.filter((r) => r.type === "transfer" && r.include);
  const expenseTotal = expenseRows.reduce((sum, r) => sum + r.amount, 0);
  const rules = expenseRows.filter((r) => r.category !== r.suggestedCategory);

  const pensionValues = draft.pension?.estimate
    ? pensions.map((acc) => ({ acc, value: estimateValue(acc, byMonth), estimated: true }))
    : pensions
        .map((acc) => ({ acc, value: Number(draft.pension?.values[acc.id]), estimated: false }))
        .filter((p) => Number.isFinite(p.value) && p.value >= 0);

  const planned: PlannedChange[] = [];
  if (incomeRows.length > 0) {
    planned.push({
      label: "Income",
      detail: `${fmtCAD(incomeTotal, 2)} across ${incomeRows.length} ${
        incomeRows.length === 1 ? "category" : "categories"
      }, dated ${monthEnd(month)}`,
      count: incomeRows.length,
    });
  }
  if (expenseRows.length > 0) {
    /*
     * Named by account, because they are not all one account. A file can carry
     * chequing and brokerage rows together, and spending filed against the
     * wrong side of the ledger is invisible once it is saved.
     */
    const byAccount = new Map<string, number>();
    for (const r of expenseRows) {
      const id = accountForRow(r);
      byAccount.set(id, (byAccount.get(id) ?? 0) + r.amount);
    }
    const where = [...byAccount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([id, sum]) =>
          `${accounts.find((a) => a.id === id)?.name ?? "an account"} ${fmtCAD(sum, 2)}`,
      )
      .join(", ");
    planned.push({
      label: "Spending",
      detail: `${fmtCAD(expenseTotal, 2)} across ${expenseRows.length} ${
        expenseRows.length === 1 ? "transaction" : "transactions"
      } — ${where}`,
      count: expenseRows.length,
    });
  }
  if (paymentRows.length > 0) {
    const byCard = new Map<string, number>();
    for (const r of paymentRows) {
      const id = accountForRow(r);
      byCard.set(id, (byCard.get(id) ?? 0) + r.amount);
    }
    planned.push({
      label: "Card payments",
      detail: [...byCard.entries()]
        .map(
          ([id, sum]) =>
            `${fmtCAD(sum, 2)} from ${accounts.find((a) => a.id === cashId)?.name ?? "the everyday account"} to ${
              accounts.find((a) => a.id === id)?.name ?? "a card"
            }`,
        )
        .join(", "),
      count: paymentRows.length,
    });
  }
  const repaid = expenseRows.filter((r) => r.debtAccountId);
  if (repaid.length > 0) {
    const owed = repaid.reduce((sum, r) => sum + r.amount, 0);
    planned.push({
      label: "Debt paid down",
      detail: repaid
        .map((r) => accounts.find((a) => a.id === r.debtAccountId)?.name)
        .filter((name, i, all): name is string => !!name && all.indexOf(name) === i)
        .join(", ")
        .concat(`, ${fmtCAD(owed, 2)} off what is owed`),
      count: repaid.length,
    });
  }
  if (rules.length > 0) {
    planned.push({
      label: "Merchant rules",
      detail: `${rules.length} ${rules.length === 1 ? "category" : "categories"} remembered for next month`,
      count: rules.length,
    });
  }
  if (includedActions.length > 0) {
    planned.push({
      label: "Mergers and demergers",
      detail: includedActions
        .map((a) => `${a.from} → ${a.to}`)
        .join(", ")
        .concat(", applied before the trades below"),
      count: includedActions.length,
    });
  }
  if (draft.trades) {
    planned.push({
      label: "Trades",
      detail: `${draft.trades.batch.trades} recorded${
        draft.trades.batch.created > 0
          ? `, opening ${draft.trades.batch.created} new position${
              draft.trades.batch.created === 1 ? "" : "s"
            }`
          : ""
      }`,
      count: draft.trades.batch.trades,
    });
  }
  if (moneyMoves.length > 0 || heldBack.length > 0) {
    const into = moneyMoves.filter((r) => r.type === "deposit").length;
    const out = moneyMoves.length - into;
    planned.push({
      label: "Investment deposits",
      detail: [
        into > 0 ? `${into} deposit${into === 1 ? "" : "s"} into an investment account` : "",
        out > 0 ? `${out} withdrawal${out === 1 ? "" : "s"}` : "",
        heldBack.length > 0
          ? `${heldBack.length} not saved: ${heldBack[0].error ?? "this month is kept as monthly totals"}`
          : "",
      ]
        .filter(Boolean)
        .join(", "),
      count: moneyMoves.length,
    });
  }
  if (pensionValues.length > 0) {
    planned.push({
      label: "Pension",
      detail: pensionValues
        .map(
          (p) =>
            `${p.acc.name} at ${fmtCAD(p.value, 2)}${p.estimated ? " (estimated)" : ""}`,
        )
        .join(", "),
      count: pensionValues.length,
    });
  }
  if (holdings.length > 0) {
    planned.push({
      label: "Portfolio snapshot",
      detail: `${holdings.length} positions valued as ${labelMonth(month)} closed, taken after the trades above land`,
      count: holdings.length,
    });
  }

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const date = monthEnd(month);

      /*
       * The database refuses a month kept both ways (drizzle/0024). Asking the
       * same question here first turns a rejected write half way through a save
       * into a sentence naming the month and what is already in it.
       */
      if (incomeRows.length > 0) {
        const clash = conflictingGranularity(transactions, {
          date,
          type: "income",
          granularity: "monthly",
        });
        if (clash) {
          setError(
            `${labelMonth(month)} already has ${clash.count} individual income ` +
              `transaction${clash.count === 1 ? "" : "s"}. Recording a monthly total ` +
              `on top would count the same pay twice — remove those rows first, or ` +
              `leave this month itemised and skip the income boxes.`,
          );
          setSaving(false);
          return;
        }
      }
      /*
       * The same question for card payments, which are transfers: a month whose
       * transfers are kept as one total each cannot take individual ones too.
       */
      const paymentClash = paymentRows
        .map((r) =>
          conflictingGranularity(transactions, {
            date: r.date,
            type: "transfer",
            granularity: "individual",
          }),
        )
        .find(Boolean);
      if (paymentClash) {
        setError(
          `${labelMonth(paymentClash.month)} keeps its transfers as monthly totals, so a card ` +
            `payment cannot be added on its own. Add it to that month's total instead, or ` +
            `untick it on the import.`,
        );
        setSaving(false);
        return;
      }

      const defaultAccount = accounts[0]?.id ?? "";
      for (const { box, amount } of incomeRows) {
        addTransaction({
          date,
          type: "income",
          amount: Math.round(amount * 100) / 100,
          category: box.category,
          ...sidesFor("income", defaultAccount),
          payee: box.label,
          /*
           * The checklist states a month's total for each box, not the deposits
           * that made it up. Saying so lets the database refuse the month if the
           * same income is already there as individual rows — which is how a
           * month's pay came to be counted twice, once from the bank export and
           * once from here.
           */
          granularity: "monthly",
        });
      }

      /*
       * Spending, and the card payments that settle it. Both sides come from
       * the rule the import page uses, so a row lands the same way whichever
       * door it came through: a repayment on the debt it paid off, a card
       * payment out of the everyday account and onto the card.
       */
      for (const r of [...expenseRows, ...paymentRows]) {
        if (!r.payee.trim() || r.amount <= 0) continue;
        addTransaction({
          date: r.date,
          type: r.type,
          amount: r.amount,
          category: r.category,
          ...cashRowSides(r, accountForRow(r), cashId),
          payee: r.payee.trim(),
          note: r.note,
        });
      }
      for (const r of rules) setMerchantRule(r.payee, r.category);

      /*
       * Corporate actions before trades, always.
       *
       * The action decides what the new shares cost, and a sale of them in the
       * same month is measured against that. Applied afterwards, the sale
       * would be priced against a basis that did not exist when it happened,
       * and the gain reported would be one that never occurred.
       */
      for (const action of includedActions) {
        const parent = holdingForAction(action.from, action.registration);
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
        const existingChild = holdingForAction(applied.child.ticker, action.registration);
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
            // No price of its own yet: the feed fills it in on the next
            // refresh, and until then what it cost is the best figure there is.
            price: applied.child.avgCostCAD,
            dividendsReceived: 0,
            accountId: parent.accountId,
            currency: parent.currency,
            flows: [applied.child.flow],
          });
        }
      }

      /*
       * The trades are re-planned against the positions the actions left.
       *
       * The batch was worked out on the trades step, from the holdings as they
       * were before any action ran — so writing it as planned would overwrite a
       * parent whose cost base an action had just reduced, leaving the basis it
       * moved to the child in both places. A demerger out of a position that
       * also paid a dividend that month created cost out of nothing.
       *
       * The new positions the batch opens carry their own name and class, so
       * the details a re-plan needs come back off the batch rather than being
       * asked for again. If the re-plan fails the original batch still stands:
       * a month written from slightly stale numbers is a smaller problem than
       * a month not written at all.
       */
      let batch = draft.trades?.batch ?? null;
      if (draft.trades && includedActions.length > 0) {
        const meta = draft.trades.batch.changes
          .filter((c) => !c.existing)
          .map((c) => ({ ticker: c.ticker, name: c.name, assetClass: c.assetClass }));
        const replanned = planTrades(
          draft.trades.rows,
          meta,
          useFinance.getState().holdings,
          useFinance.getState().usdCadRate,
          (id) =>
            useFinance.getState().accounts.find((a) => a.id === id)?.balanceAsOf ?? null,
        );
        if (replanned.ok) batch = replanned.batch;
      }

      if (batch) {
        for (const c of batch.changes) {
          if (c.existing) {
            updateHolding(c.existing.id, {
              ...c.existing,
              shares: c.shares,
              avgCost: c.avgCost,
              dividendsReceived: c.dividendsReceived,
              flows: c.flows,
            });
          } else {
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
        }
        for (const { accountId, delta, currency } of batch.cash) {
          adjustAccountCash(accountId, delta, undefined, currency);
        }
      }

      if (moneyMoves.length > 0) {
        const { transfers } = accumulatePositions(
          moneyMoves,
          accountIdFor,
          holdings,
          (id) => accounts.find((a) => a.id === id)?.balanceAsOf ?? null,
        );
        for (const t of transfers) {
          const txn = transferFor(t, cashId);
          if (txn) addTransaction(txn);
        }
      }

      for (const p of pensionValues) {
        if (p.estimated) {
          recordEstimatedBalance(p.acc.id, p.value, month);
        } else {
          updateAccount(
            p.acc.id,
            {
              name: p.acc.name,
              institution: p.acc.institution,
              kind: p.acc.kind,
              balance: Math.round(p.value * 100) / 100,
              registration: p.acc.registration,
            },
            month,
          );
        }
      }

      /*
       * Last, and awaited, because it is the only write here that goes to the
       * server on its own rather than through the store's queue.
       *
       * Read out of the store rather than off the `holdings` this component
       * rendered with: the trades above have just changed shares and cost, and
       * may have opened positions that had no id until a moment ago. A
       * snapshot taken from the stale list would record the portfolio as it
       * was before the month it is supposed to close.
       *
       * This used to be a step of its own, a table of sixty prices to scroll
       * past. Nobody edits a price they have no better source for than the app
       * itself, so it asks nothing and simply records what is held.
       */
      const closing = useFinance.getState().holdings;
      const unconverted = unconvertedPrices(closing);
      if (unconverted.length > 0) {
        throw new Error(
          `${unconverted.join(", ")} ${unconverted.length === 1 ? "has" : "have"} no Canadian-dollar price yet, ` +
            "so the month-end value would be saved in US dollars. Refresh prices on the Investments page, " +
            "then finish the checklist again.",
        );
      }
      if (closing.length > 0) {
        await saveSnapshots(
          closing.map((h) => ({
            month,
            holdingId: h.id,
            ticker: h.ticker,
            price: h.price,
            avgCost: h.avgCost,
            shares: h.shares,
            value: h.price * h.shares,
            valueCAD: h.priceCAD * h.shares,
          })),
        );
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Nothing was lost — try again.");
      setSaving(false);
    }
  };

  return (
    <section>
      <h3 className="text-sm font-semibold">
        <span className="text-ink-faint">
          Step {number} of {total}
        </span>{" "}
        · Save {labelMonth(month)}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">
        Nothing above has been written yet. This is what pressing the button
        does.
      </p>

      <div className="mt-4">
        {planned.length === 0 ? (
          <p className="rounded-lg border border-line bg-elevated/40 px-3 py-6 text-center text-xs text-ink-faint">
            Nothing to save — every step was skipped or left empty.
          </p>
        ) : (
          <ul className="divide-y divide-line/60 rounded-lg border border-line">
            {planned.map((p) => (
              <li key={p.label} className="flex items-start gap-3 px-3 py-2.5">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-positive" />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{p.label}</p>
                  <p className="text-[0.6875rem] text-ink-faint">{p.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="mt-3 text-[0.6875rem] text-negative">{error}</p>
      ) : (
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-faint">
          Closing this dialog before saving discards all of it, and nothing in
          the record changes.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {onBack ? (
          <Button variant="ghost" onClick={onBack} className="mr-auto" disabled={saving}>
            <ArrowLeft size={14} /> Back
          </Button>
        ) : null}
        <Button onClick={save} disabled={planned.length === 0 || saving}>
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {saving ? "Saving…" : `Save ${labelMonth(month)}`}
        </Button>
      </div>
    </section>
  );
}

/** The last day of a month, as an ISO date. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/* ---------- Step 4: Portfolio Snapshot ---------- */

/* ---------- Step 4: Pension ---------- */

/**
 * The one figure the app cannot work out for itself.
 *
 * A defined benefit pension has no transactions to import and no price to
 * fetch — its transfer value comes from the plan, and the plan tells you when
 * you ask. So it is asked for here, at month end, alongside everything else
 * that closes the month.
 */
function PensionStep({
  number,
  total,
  month,
  onNext,
  onBack,
  draft,
  onDraft,
}: StepProps & {
  draft: Draft["pension"];
  onDraft: (d: NonNullable<Draft["pension"]>) => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const pensions = accounts.filter((a) => isPension(a.kind));
  const [values, setValues] = useState<Record<string, string>>(draft?.values ?? {});

  const byMonth = useMemo(() => contributionsByMonth(transactions), [transactions]);

  /*
   * Skipping is a legitimate answer: the figure comes from the plan, and the
   * plan is not always to hand at month end. So the month is filled with the
   * contributions made since the last real figure — money that certainly went
   * in — and flagged as the app's own working until a real one replaces it.
   */
  const skip = () => {
    onDraft({ values: {}, estimate: true });
    onNext();
  };

  const submit = () => {
    onDraft({ values, estimate: false });
    onNext();
  };

  const estimated = pensions.reduce(
    (sum, acc) => sum + estimateValue(acc, byMonth),
    0,
  );

  return (
    <StepBody
      number={number}
      total={total}
      title={`Pension at the end of ${labelMonth(month)}`}
      lead="The transfer value your plan reports — the lump sum it would pay out. Leave a box empty to keep the value already recorded."
      onBack={onBack}
      note={
        <>
          Recorded against {labelMonth(month)}; earlier months are left alone. Skipping instead carries the last figure forward plus the
          contributions made since — {fmtCAD(estimated, 2)} — and marks it as an
          estimate until you enter the real one.
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={skip}>
            Skip — estimate it
          </Button>
          <Button onClick={submit}>
            Next <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {pensions.map((acc) => {
          const last = acc.history[acc.history.length - 1];
          return (
            <Field
              key={acc.id}
              label={acc.name}
              hint={
                last
                  ? `${fmtCAD(last.value, 2)} for ${labelMonth(last.month)}${
                      last.estimated ? " (estimated)" : " (from your plan)"
                    }`
                  : "Nothing recorded yet"
              }
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder={String(acc.balance)}
                value={values[acc.id] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [acc.id]: e.target.value }))
                }
              />
            </Field>
          );
        })}
      </div>
    </StepBody>
  );
}

/* ---------- Step: Contribution room ---------- */

/**
 * The one figure in the app that has to be looked up rather than derived.
 *
 * Contribution room depends on income, on room carried forward and on
 * withdrawals made years ago — all of it on a notice of assessment. The app
 * counts what went in and cannot know what was allowed, so once a year it
 * asks.
 *
 * Shown only in the months where the answer is knowable, and only until it has
 * been answered: closing January asks about the TFSA and FHSA, closing March
 * asks about the RRSP. Keyed off the month being closed rather than today, so a
 * checklist run in June for January still asks — the question is owed by the
 * month, not by the date it is done on.
 */
function RoomStep({
  number,
  total,
  month,
  onNext,
  onBack,
  asks,
  limits,
  deferrals,
  onSave,
}: StepProps & {
  asks: RoomAsk[];
  limits: ContributionLimits;
  deferrals: RoomDeferrals;
  onSave: (limits: ContributionLimits, deferrals: RoomDeferrals) => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const key = (a: RoomAsk) => `${a.year}|${a.plan}`;
  const paidIn = (a: RoomAsk) =>
    contributionRoom(a.year, transactions, accounts, limits).find(
      (r) => r.plan === a.plan,
    )?.contributed ?? 0;

  const years = [...new Set(asks.map((a) => a.year))];
  const plans = [...new Set(asks.map((a) => a.plan))];

  const submit = () => {
    const nextLimits: ContributionLimits = { ...limits };
    const unanswered: RoomAsk[] = [];
    for (const ask of asks) {
      const raw = (values[key(ask)] ?? "").trim().replace(/[$,\s]/g, "");
      if (raw === "") {
        unanswered.push(ask);
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        setError(`${ask.plan} room must be an amount, or left blank.`);
        return;
      }
      nextLimits[ask.year] = {
        ...(nextLimits[ask.year] ?? {}),
        [ask.plan]: Math.round(value * 100) / 100,
      };
    }
    // Anything left blank is treated as put off, so it returns next month
    // rather than waiting a year to be asked again.
    onSave(nextLimits, deferAsks(month, unanswered, deferrals));
    onNext();
  };

  const askAgainNextMonth = () => {
    onSave(limits, deferAsks(month, asks, deferrals));
    onNext();
  };

  return (
    <StepBody
      number={number}
      total={total}
      title={`Contribution room for ${years.join(" and ")}`}
      lead={
        plans.length > 1
          ? `The ${plans.join(" and ")} limits are set for the year. Enter what you are allowed to contribute and the Year page will track what you have used.`
          : `Your ${plans[0]} room comes off your notice of assessment. Enter it and the Year page will track what you have used.`
      }
      onBack={onBack}
      note={
        <>
          Saved against {years.join(" and ")}, not against {labelMonth(month)} —
          room is a fact about a year. Nothing here is required to close the
          month.
        </>
      }
      actions={
        <>
          {/*
            * Not "skip" but "ask me next month". The usual reason for having no
            * figure is that the notice of assessment has not arrived yet, and a
            * skip that waits a full year to ask again turns a one-month delay
            * into a year of an empty gauge.
            */}
          <Button variant="ghost" onClick={askAgainNextMonth}>
            I do not have it yet — ask next month
          </Button>
          <Button onClick={submit}>
            Next <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {asks.map((ask) => (
          <Field
            key={key(ask)}
            label={`${ask.plan} room for ${ask.year}`}
            hint={`${fmtCAD(paidIn(ask))} paid in so far in ${ask.year}`}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="Not set"
              value={values[key(ask)] ?? ""}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [key(ask)]: e.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      {error ? <p className="mt-3 text-xs text-negative">{error}</p> : null}
    </StepBody>
  );
}

/* ---------- Step: Goals for the new year ---------- */

/**
 * The year's goals, asked for once, when the year turns.
 *
 * Closing December is the January checklist: the old year is done and the new
 * one has just begun, which is the one moment in the year the question is
 * natural. Entirely optional — skipping leaves nothing half-set, and goals can
 * be set on the Goals page at any time. Each goal is saved as it is added, like
 * the room above it: a goal is not part of the month being closed.
 */
function GoalsStep({ number, total, month, onNext, onBack }: StepProps) {
  const year = String(Number(month.slice(0, 4)) + 1);
  const goals = useGoals((s) => s.goals);
  const state = useGoals((s) => s.state);
  const load = useGoals((s) => s.load);
  const save = useGoals((s) => s.save);
  useEffect(() => {
    void load();
  }, [load]);
  const set = goals.filter((g) => g.year === year);

  return (
    <StepBody
      number={number}
      total={total}
      title={`Goals for ${year}`}
      lead={`${labelMonth(month)} closes the year. If you want ${year} to be for something, say what — every goal here is measured from your own record as the year goes.`}
      onBack={onBack}
      note={<>Optional. Goals can be set or changed on the Goals page at any time.</>}
      actions={
        <>
          {set.length === 0 ? (
            <Button variant="ghost" onClick={onNext}>
              Skip
            </Button>
          ) : null}
          <Button onClick={onNext}>
            Next <ArrowRight size={14} />
          </Button>
        </>
      }
    >
      {set.length > 0 ? (
        <ul className="mb-4 space-y-1 rounded-lg border border-line bg-elevated/40 p-3">
          {set.map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-sm text-ink-dim">
              <CheckCircle2 size={14} className="shrink-0 text-positive" />
              {describeGoal(g, fmtCAD)}
            </li>
          ))}
        </ul>
      ) : null}
      {state === "failed" ? (
        <p className="text-xs text-negative">
          Your goals could not be read, so none can be added here. Skip this step and try the Goals
          page later.
        </p>
      ) : state === "ready" ? (
        <GoalComposer
          year={year}
          onAdd={(goal) => save([...useGoals.getState().goals, goal])}
        />
      ) : (
        <p className="text-xs text-ink-faint">Loading your goals…</p>
      )}
    </StepBody>
  );
}

/* ---------- Main Component ---------- */

const STEPS: { key: Step; label: string }[] = [
  { key: "import", label: "Import" },
  { key: "income", label: "Income" },
  { key: "expenses", label: "Expenses" },
  { key: "actions", label: "Actions" },
  { key: "trades", label: "Trades" },
  { key: "pension", label: "Pension" },
  { key: "room", label: "Room" },
  { key: "goals", label: "Goals" },
  { key: "review", label: "Save" },
];

export function MonthlyChecklistButton({
  onOpen,
  gaps = 0,
}: {
  onOpen: () => void;
  /**
   * Months the portfolio record is missing.
   *
   * Carried on the button because a warning buried inside the checklist is
   * one you only see once you have already decided to run it — which is not
   * the month it needed saying.
   */
  gaps?: number;
}) {
  return (
    <Button variant="secondary" onClick={onOpen}>
      <CheckCircle2 size={14} /> Monthly checklist
      {gaps > 0 ? (
        <span
          title={`${gaps} month${gaps === 1 ? "" : "s"} without a portfolio snapshot`}
        >
          <Badge tone="negative" className="ml-1">
            {gaps}
          </Badge>
        </span>
      ) : null}
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
  /*
   * The body is mounted only while the dialog is open, which is what makes
   * reopening it start at step one with nothing loaded. Left mounted, it kept
   * whichever step was abandoned — and, now that the import feeds every step
   * after it, a stale file as well.
   */
  return open ? <Checklist onClose={onClose} /> : null;
}

/**
 * A month, closed in order.
 *
 * The file comes first because everything after it is a review of what the
 * file said. Income is a total of it, spending is a list of it, trades are
 * read out of it — each editable, and each written only when its own step
 * says so. The step before the last is the one no export can answer: what the
 * pension is worth. The portfolio's closing value is not asked for at all —
 * saving the month records it.
 */
function Checklist({ onClose }: { onClose: () => void }) {
  // No pension, no step: the checklist should only ask what applies.
  const hasPension = useFinance((s) => s.accounts.some((a) => isPension(a.kind)));
  const accounts = useFinance((s) => s.accounts);
  const transactions = useFinance((s) => s.transactions);

  /*
   * The month just finished, not the one running. A checklist done on the
   * third of the month is closing the month before it, and a partial month
   * would report a collapse in both income and spending.
   */
  const month = lastCompleteMonthKey();

  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOAD);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [limits, setLimits] = useState<ContributionLimits>({});
  const [deferrals, setDeferrals] = useState<RoomDeferrals>({});

  useEffect(() => {
    let cancelled = false;
    getSettings<{ limits?: ContributionLimits; deferrals?: RoomDeferrals }>("/api/contribution-limits")
      .then((d) => {
        if (cancelled) return;
        setLimits(d.limits ?? {});
        setDeferrals(d.deferrals ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveRoom = useCallback(
    (nextLimits: ContributionLimits, nextDeferrals: RoomDeferrals) => {
      // A figure entered settles the question, so its deferral goes with it.
      const tidied = clearAnswered(nextLimits, nextDeferrals);
      setLimits(nextLimits);
      setDeferrals(tidied);
      saveSettings("/api/contribution-limits", { limits: nextLimits, deferrals: tidied }).catch(() => {});
    },
    [],
  );

  /*
   * What this month owes an answer for: the question its own month raises, and
   * anything a previous month put off. Filtered to plans that are actually
   * held and not already answered, so the step never appears with nothing to
   * ask.
   */
  const asks = roomAsks(month, limits, deferrals, accounts);
  /*
   * Steps the month does not need are not shown. No pension account, no
   * pension step; and the mergers step appears only once a file has actually
   * carried one, which for most months is never. Derived rather than fixed at
   * the top, because the import that reveals an action is itself step one.
   */
  const steps = STEPS.filter(
    (s) =>
      (s.key !== "pension" || hasPension) &&
      (s.key !== "actions" || loaded.actions.length > 0) &&
      (s.key !== "room" || asks.length > 0) &&
      // Only when closing December, the January checklist that opens a year.
      (s.key !== "goals" || month.endsWith("-12")),
  );
  const at = Math.min(index, steps.length - 1);
  const step = steps[at].key;
  const next = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = at > 0 ? () => setIndex((i) => Math.max(i - 1, 0)) : undefined;
  const shared = {
    number: at + 1,
    total: steps.length,
    month,
    onNext: next,
    onBack: back,
  };

  /*
   * A pension contribution is deducted at source and never appears on the
   * statement the checklist reads, so its box came up empty every month and
   * had to be typed from memory. Last month's figure is the answer nearly
   * every time; the box says where it came from and stays editable.
   */
  const carried = useMemo(
    () => previousMonthIncome(transactions, month, ["RSP / Pension"]),
    [transactions, month],
  );
  const boxes = useMemo(
    () => incomeBoxes(loaded.cash, carried),
    [loaded.cash, carried],
  );

  /*
   * Only the three kinds the trade form can record. Deposits and withdrawals
   * are not trades: the last step saves them as transfers.
   */
  const drafts = useMemo<TradeDraft[]>(
    () =>
      loaded.trades
        .filter(
          (t) =>
            t.include &&
            !t.duplicate &&
            (t.type === "buy" || t.type === "sell" || t.type === "dividend"),
        )
        .map((t) => tradeDraftFrom(t, accounts)),
    [loaded.trades, accounts],
  );

  const unreadable = loaded.trades.filter(
    (t) => t.type === null || t.registration === null,
  ).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Monthly checklist · closing ${labelMonth(month)}`}
      size="2xl"
    >
      <div className="mb-5 border-b border-line pb-4">
        <StepIndicator
          steps={steps}
          current={step}
          onJump={(key) => setIndex(steps.findIndex((s) => s.key === key))}
        />
      </div>

      {step === "import" && (
        <ImportStep {...shared} loaded={loaded} onLoaded={setLoaded} />
      )}
      {step === "income" && (
        <IncomeStep
          {...shared}
          boxes={boxes}
          draft={draft.income}
          onDraft={(income, incomeBoxes) =>
            setDraft((d) => ({ ...d, income, incomeBoxes }))
          }
          rows={loaded.cash}
          onRows={(cash) => setLoaded((l) => ({ ...l, cash }))}
        />
      )}
      {step === "expenses" && (
        <ExpensesStep
          {...shared}
          rows={loaded.cash}
          onRows={(cash) => setLoaded((l) => ({ ...l, cash }))}
          files={loaded.files}
          cardFor={loaded.cardFor}
        />
      )}
      {step === "actions" && (
        <ActionsStep
          {...shared}
          actions={loaded.actions}
          onActions={(actions) => setLoaded((l) => ({ ...l, actions }))}
        />
      )}
      {step === "trades" && (
        <TradesStep
          {...shared}
          drafts={drafts}
          unreadable={unreadable}
          staged={draft.trades}
          onStage={(trades) => setDraft((d) => ({ ...d, trades }))}
        />
      )}
      {step === "pension" && (
        <PensionStep
          {...shared}
          draft={draft.pension}
          onDraft={(pension) => setDraft((d) => ({ ...d, pension }))}
        />
      )}
      {step === "room" && (
        <RoomStep
          {...shared}
          asks={asks}
          limits={limits}
          deferrals={deferrals}
          onSave={saveRoom}
        />
      )}
      {step === "goals" && <GoalsStep {...shared} />}
      {step === "review" && (
        <ReviewStep
          number={shared.number}
          total={shared.total}
          month={month}
          onBack={back}
          onDone={onClose}
          draft={draft}
          cash={loaded.cash}
          files={loaded.files}
          actions={loaded.actions}
          trades={loaded.trades}
          cardFor={loaded.cardFor}
        />
      )}
    </Modal>
  );
}
