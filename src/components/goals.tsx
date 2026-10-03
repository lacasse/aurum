"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import {
  Check,
  Coins,
  CreditCard,
  HeartHandshake,
  Landmark,
  PartyPopper,
  PenLine,
  Pencil,
  PiggyBank,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sprout,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button, Field, Input, Modal, Select, cn } from "./ui";
import { useFinance } from "@/lib/store";
import { getSettings, saveSettings } from "@/lib/api";
import { useIncomeTransactions, useSpendGroups } from "@/lib/hooks";
import { netExternalFlows, netWorthOver, portfolioHistory, portfolioSeries } from "@/lib/analytics";
import { DONATIONS_CATEGORY, groupOf } from "@/lib/expenses";
import {
  REGISTERED_PLANS,
  type ContributionLimits,
  type RegisteredPlan,
} from "@/lib/contributions";
import { fmtCAD, todayISO } from "@/lib/format";
import { uid } from "@/lib/ids";
import { isLiability } from "@/lib/types";
import {
  CUSTOM,
  METRICS,
  describe,
  dollarsOf,
  measure,
  monthName,
  newlyMet,
  specOf,
  type Goal,
  type GoalBasis,
  type GoalInputs,
  type GoalMetric,
  type GoalProgress,
  type GoalStatus,
} from "@/lib/goals";

/* ── The goals, shared by every page that shows or watches them ── */

interface GoalStore {
  goals: Goal[];
  /** "loading" until the first read lands; "failed" says so on screen. */
  state: "idle" | "loading" | "ready" | "failed";
  load: () => Promise<void>;
  /** Replaces the list, on screen at once and in storage behind it. */
  save: (goals: Goal[]) => void;
  /** Goals being celebrated right now, on whichever page they were met. */
  celebrating: Goal[];
  /** Stamps these goals met today and puts them on screen. */
  celebrate: (met: Goal[], today: string) => void;
  /** Shows a met goal's celebration again, for the fun of it. Stores nothing. */
  replay: (goal: Goal) => void;
  dismiss: () => void;
}

/*
 * One copy for the page, the checklist and the watcher. Each loading its own
 * would let one save over another's stale list — the page deleting a goal and
 * the watcher, a moment later, writing it back with its celebration stamped.
 */
export const useGoals = create<GoalStore>()((set, get) => ({
  goals: [],
  state: "idle",
  load: async () => {
    if (get().state === "loading" || get().state === "ready") return;
    set({ state: "loading" });
    try {
      const d = await getSettings<{ goals?: Goal[] }>("/api/goals");
      set({ goals: d.goals ?? [], state: "ready" });
    } catch {
      set({ state: "failed" });
    }
  },
  save: (goals) => {
    set({ goals });
    saveSettings("/api/goals", { goals }).catch(() => set({ state: "failed" }));
  },
  celebrating: [],
  celebrate: (met, today) => {
    const ids = new Set(met.map((g) => g.id));
    // Stamped before anything is shown, so a reload cannot celebrate it twice.
    get().save(get().goals.map((g) => (ids.has(g.id) ? { ...g, metOn: today } : g)));
    set({ celebrating: [...get().celebrating, ...met] });
  },
  replay: (goal) => set({ celebrating: [goal] }),
  dismiss: () => set({ celebrating: [] }),
}));

/**
 * Everything a goal is measured against, built the way the Overview and Year
 * pages build it, so a goal's figure is the figure those pages show.
 *
 * Null until it can be trusted: the record loaded, not failed, and the
 * month-end history in. Before the history lands the portfolio is an estimate
 * from price history, and a goal judged on an estimate could be celebrated on
 * a figure the record does not support.
 */
export function useGoalInputs(): GoalInputs | null {
  const hydrated = useFinance((s) => s.hydrated);
  const loadError = useFinance((s) => s.loadError);
  const accounts = useFinance((s) => s.accounts);
  const holdings = useFinance((s) => s.holdings);
  const usdCadRate = useFinance((s) => s.usdCadRate);
  const snapshots = useFinance((s) => s.snapshotHistory);
  const historyReady = useFinance((s) => s.snapshotHistoryReady);
  const loadSnapshotHistory = useFinance((s) => s.loadSnapshotHistory);
  const transactions = useIncomeTransactions();
  const spendGroups = useSpendGroups();
  const [limits, setLimits] = useState<ContributionLimits | null>(null);

  useEffect(() => {
    if (hydrated && !loadError) loadSnapshotHistory();
  }, [hydrated, loadError, loadSnapshotHistory]);

  // The room a share-of-room goal is measured against, as the Year page reads it.
  useEffect(() => {
    let cancelled = false;
    getSettings<{ limits?: ContributionLimits }>("/api/contribution-limits")
      .then((d) => !cancelled && setLimits(d.limits ?? {}))
      .catch(() => !cancelled && setLimits({}));
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    if (!hydrated || loadError || !historyReady || limits === null) return null;
    const portfolio =
      portfolioHistory(holdings, snapshots)?.points ?? portfolioSeries(holdings, 18);
    return {
      transactions,
      accounts,
      netWorth: netWorthOver(accounts, portfolio, usdCadRate),
      portfolio,
      limits,
      flowsByMonth: netExternalFlows(holdings),
      spendGroup: (c: string) => groupOf(c, spendGroups),
      // A month is closed once the checklist has recorded its month end.
      isClosed: (month: string) => month in snapshots,
      today: todayISO(),
    };
  }, [
    hydrated,
    loadError,
    historyReady,
    holdings,
    snapshots,
    accounts,
    usdCadRate,
    transactions,
    spendGroups,
    limits,
  ]);
}

/* ── Formatting ── */

export function fmtTarget(goal: Pick<Goal, "metric" | "basis">, n: number): string {
  return specOf(goal.metric, goal.basis).unit === "pct" ? `${Math.round(n * 10) / 10}%` : fmtCAD(n);
}

/** What each status is called; its colour comes from `goalTone`. */
const STATUS: Record<GoalStatus, string> = {
  met: "Met",
  "on-track": "On track",
  behind: "Behind",
  missed: "Missed",
  awaiting: "Awaiting the checklist",
  upcoming: "Not started",
  "no-data": "No figures yet",
  open: "To do",
};

/* ── One goal ── */

/**
 * The one line under a goal that the rest of its card does not already say.
 *
 * The badge gives the status and the bar gives the progress, so this gives
 * what they cannot: the date it was met, what it takes from here, or — for a
 * percentage — the dollars behind it. Null when there is nothing to add; a
 * line that restated the badge would be the repetition this card exists to
 * avoid.
 */
function footerLine(p: GoalProgress, today: string): string | null {
  const { goal, spec, measure: m, status } = p;
  if (goal.metric === "custom") {
    if (goal.metOn) return `Done on ${goal.metOn}.`;
    return status === "missed" ? "It can still be checked off." : null;
  }
  if (goal.metOn) return `Met on ${goal.metOn}.`;
  if (status === "met") return "Met — celebrating now.";
  if (status === "no-data" && goal.metric === "contribution" && goal.basis === "percent") {
    return `Needs ${goal.year}'s contribution room — set it on the Year page.`;
  }
  if (spec.unit === "pct" || m.value === null) return null;
  if (status !== "on-track" && status !== "behind") return null;

  const thisMonth = today.slice(0, 7);
  const monthsLeft = Math.max(
    1,
    Number(goal.by.slice(5)) - (goal.year === thisMonth.slice(0, 4) ? Number(thisMonth.slice(5)) - 1 : 0),
  );
  const gap = goal.target - m.value;
  switch (spec.judge) {
    case "reach":
      return spec.shape === "flow"
        ? `About ${fmtCAD(gap / monthsLeft)} a month to go.`
        : `${fmtCAD(gap)} to go.`;
    case "reduceTo":
      return `${fmtCAD(m.value - goal.target)} left to pay down.`;
    case "stayUnder":
      return `${fmtCAD(gap)} left — about ${fmtCAD(gap / monthsLeft)} a month.`;
    default:
      return null;
  }
}

/**
 * One icon per measure, used wherever a goal appears — its card and its idea —
 * so a goal is recognised by its shape before it is read.
 */
const GOAL_ICONS: Record<GoalMetric, LucideIcon> = {
  netWorth: Landmark,
  portfolio: TrendingUp,
  cash: Wallet,
  debt: CreditCard,
  saved: PiggyBank,
  invested: Coins,
  passive: Sprout,
  contribution: ShieldCheck,
  spending: ShoppingBag,
  donations: HeartHandshake,
  custom: Star,
};

/**
 * A goal's colour, from its status and nothing else, so the same state reads
 * the same everywhere: green met, red behind or missed, the brand on course.
 * A cap going well is on course; a cap nearly spent is behind.
 */
function goalTone(p: GoalProgress): "positive" | "negative" | "brand" | "neutral" {
  if (p.status === "met") return "positive";
  if (p.status === "behind" || p.status === "missed") return "negative";
  if (p.status === "on-track" || p.status === "open") return "brand";
  return "neutral";
}

const TONE_ICON = {
  positive: "bg-positive/15 text-positive",
  negative: "bg-negative/15 text-negative",
  brand: "bg-brand/10 text-brand",
  neutral: "bg-elevated text-ink-faint",
} as const;

const TONE_BAR = {
  positive: "bg-positive",
  negative: "bg-negative",
  brand: "bg-brand-strong",
  neutral: "bg-ink-faint/50",
} as const;

const STATUS_TEXT = {
  positive: "text-positive",
  negative: "text-negative",
  brand: "text-brand",
  neutral: "text-ink-faint",
} as const;

export function GoalCard({
  progress,
  onEdit,
  onDelete,
  highlight = false,
}: {
  progress: GoalProgress;
  onEdit?: () => void;
  onDelete?: () => void;
  /** The goal a celebration linked to, picked out when the page opens on it. */
  highlight?: boolean;
}) {
  const replay = useGoals((s) => s.replay);
  const celebrate = useGoals((s) => s.celebrate);
  const save = useGoals((s) => s.save);
  const { goal, measure: m, fraction, status } = progress;
  const manual = goal.metric === "custom";
  const met = status === "met";
  const tone = goalTone(progress);
  const Icon = met ? Trophy : GOAL_ICONS[goal.metric];
  const title = describe(goal, fmtCAD, { year: false });
  const today = todayISO();
  const line = footerLine(progress, today);
  // A percentage's dollars, when nothing more pressing takes the line.
  const money = line === null ? dollarsOf(goal, m) : null;
  const statusWord = (
    <span className={cn("shrink-0 text-xs font-medium", STATUS_TEXT[tone])}>{STATUS[status]}</span>
  );

  return (
    <div
      id={`goal-${goal.id}`}
      className={cn(
        "group flex scroll-mt-24 flex-col rounded-2xl border p-4 transition-colors",
        met ? "border-positive/30 bg-positive/5" : "border-line bg-elevated/30",
        highlight && "ring-2 ring-positive",
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", TONE_ICON[tone])}>
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-ink">{title}</p>
          {goal.why ? <p className="mt-0.5 truncate text-xs text-ink-faint">{goal.why}</p> : null}
        </div>
        {/*
          * Out of the way until wanted: shown on hover or keyboard focus where
          * there is a pointer, always on a touch screen, which has no hover.
          */}
        <div className="-mr-1.5 flex shrink-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
          {onEdit ? (
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit goal: ${title}`} title="Edit goal">
              <Pencil size={14} />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label={`Delete goal: ${title}`}
              title="Delete goal"
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-auto pt-4">
        {manual ? (
          <div className="flex items-center justify-between gap-2">
            {statusWord}
            {met ? null : (
              /*
               * Checked off by hand, and celebrated like any other: the same
               * stamp, the same confetti. Nothing else can tick it.
               */
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  celebrate([goal], today);
                  playChime();
                }}
              >
                <Check size={13} /> Mark as done
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="tabular-nums text-ink-faint">
                <span className="font-semibold text-ink">
                  {m.value === null ? "—" : fmtTarget(goal, m.value)}
                </span>{" "}
                of {fmtTarget(goal, goal.target)}
              </span>
              {statusWord}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className={cn("h-full rounded-full transition-all duration-700", TONE_BAR[tone])}
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </div>
          </>
        )}

        {line || money || met ? (
          <div className="mt-2 flex items-center justify-between gap-3 text-[0.6875rem] text-ink-faint">
            {money ? (
              /*
               * A percentage in dollars, with the base it is a share of named —
               * a share of income so far is a different sum every month.
               */
              <p
                className="min-w-0 tabular-nums"
                title={
                  money.approx
                    ? "Approximate: a time-weighted return does not convert exactly to dollars, because the dollars depend on when money was added."
                    : undefined
                }
              >
                <span className="text-ink-dim">
                  {money.approx ? "≈ " : ""}
                  {fmtCAD(money.amount)} of {money.approx ? "≈ " : ""}
                  {fmtCAD(money.target)}
                </span>{" "}
                · {money.lead === "of" ? "" : `${money.lead} `}
                {fmtCAD(money.base)} {money.noun}
              </p>
            ) : (
              <p className="min-w-0">{line}</p>
            )}
            {met ? (
              <div className="flex shrink-0 items-center gap-3">
                {manual ? (
                  /* A box ticked by mistake has to be unticked by hand too. */
                  <button
                    type="button"
                    onClick={() =>
                      save(
                        useGoals.getState().goals.map((g) => {
                          if (g.id !== goal.id) return g;
                          const { metOn: _metOn, ...open } = g;
                          void _metOn;
                          return open;
                        }),
                      )
                    }
                    className="hover:text-ink hover:underline"
                  >
                    Undo
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    replay(goal);
                    playChime();
                  }}
                  className="inline-flex items-center gap-1 font-medium text-positive hover:underline"
                >
                  <PartyPopper size={12} /> Celebrate again
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Setting one ── */

const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

/**
 * A goal written the SMART way, one question at a time.
 *
 * Specific and measurable are the dropdowns: only figures the app can measure
 * are offered, so every goal set here can be tracked without anything typed in
 * later. Achievable is the figure so far and last year's beside the target,
 * which is the difference between a target and a guess. Relevant is the reason,
 * optional and in the owner's words. Time-bound is the month it is due.
 */
/** A starting point for the form: an idea picked from the list above it. */
export type GoalPreset = Partial<Pick<Goal, "metric" | "basis" | "target" | "plan" | "category">>;

export function GoalComposer({
  year,
  onAdd,
  preset,
  editing,
  wide = false,
}: {
  year: string;
  /** Called with the new goal, or with the edited one in place of `editing`. */
  onAdd: (goal: Goal) => void;
  /** Read once, when the form mounts; give it a new `key` to apply another. */
  preset?: GoalPreset;
  /** A goal to change rather than a new one to set. Read once, like `preset`. */
  editing?: Goal;
  /** Two columns of steps, for a card with the width for them. */
  wide?: boolean;
}) {
  const inputs = useGoalInputs();
  const accounts = useFinance((s) => s.accounts);
  const categories = useFinance((s) => s.categories);
  const start = editing ?? preset;
  const [metric, setMetric] = useState<GoalMetric>(start?.metric ?? "saved");
  // Empty is every plan, as an empty category is all spending.
  const [plan, setPlan] = useState<RegisteredPlan | "">(start?.plan ?? "");
  const [category, setCategory] = useState(start?.category ?? "");
  const [cards, setCards] = useState<"net" | "ignore">(editing?.ignoreCards ? "ignore" : "net");
  const [basis, setBasis] = useState<GoalBasis>(start?.basis ?? "amount");
  const [target, setTarget] = useState(start?.target !== undefined ? String(start.target) : "");
  const [by, setBy] = useState(editing ? editing.by.slice(5) : "12");
  const [why, setWhy] = useState(editing?.why ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [error, setError] = useState("");

  // A goal of the owner's own: words and a month, checked off by hand.
  const manual = metric === "custom";
  const spec = specOf(metric, basis);
  const def = METRICS.find((m) => m.metric === metric) ?? METRICS[0];
  const pct = spec.unit === "pct";
  const today = todayISO();
  const thisMonth = today.slice(0, 7);
  const draft = {
    metric,
    basis,
    year,
    by: `${year}-${by}`,
    plan: metric === "contribution" && plan ? plan : undefined,
    category: metric === "spending" && category ? category : undefined,
    ignoreCards: metric === "cash" && cards === "ignore" ? (true as const) : undefined,
    title: manual ? title.trim() : undefined,
    ...(manual ? { basis: "amount" as GoalBasis } : {}),
  };

  /*
   * The two figures that make a target achievable rather than a guess: where
   * it stands this year, and where it ended last year.
   */
  const soFar = inputs && year <= thisMonth.slice(0, 4) ? measure(draft, inputs).value : null;
  const lastYear = inputs
    ? measure({ ...draft, year: String(Number(year) - 1), by: `${Number(year) - 1}-12` }, inputs)
        .value
    : null;

  const amount = manual ? 0 : Number(target.replace(/[$,\s%]/g, ""));
  const valid = manual
    ? title.trim() !== ""
    : target.trim() !== "" && Number.isFinite(amount) && amount >= 0;
  const monthsLeft = Math.max(
    1,
    Number(by) - (year === thisMonth.slice(0, 4) ? Number(thisMonth.slice(5)) - 1 : 0),
  );

  /*
   * A share of room needs the room. Said before the goal is set, not after:
   * otherwise it is added, reads "no figures yet", and nobody knows why.
   */
  const room = inputs?.limits[year] ?? {};
  const noRoom =
    metric === "contribution" &&
    pct &&
    inputs !== null &&
    !(draft.plan ? [draft.plan] : REGISTERED_PLANS).some((p) => (room[p] ?? 0) > 0);

  let pace: string | null = null;
  if (valid && !manual) {
    if (spec.judge === "reach" && soFar !== null && soFar >= amount) {
      pace = "Already there — the goal would be met the moment it is saved. Aim higher?";
    } else if (spec.judge === "reduceTo" && soFar !== null && soFar <= amount) {
      pace = "Already there — the goal would be met the moment it is saved.";
    } else if (pct && spec.judge === "reach" && soFar !== null) {
      pace = `${Math.round((amount - soFar) * 10) / 10} percentage points to go.`;
    } else if (pct) {
      pace = null;
    } else if (spec.judge === "reach" && spec.shape === "flow") {
      pace = `About ${fmtCAD((amount - (soFar ?? 0)) / monthsLeft)} a month from here.`;
    } else if (spec.judge === "stayUnder") {
      pace = `About ${fmtCAD(Math.max(0, amount - (soFar ?? 0)) / monthsLeft)} a month left to spend.`;
    } else if (spec.shape === "level" && soFar !== null) {
      pace = `${fmtCAD(Math.abs(amount - soFar))} to go.`;
    }
  }

  const add = () => {
    if (!valid) {
      setError(
        manual
          ? "Say what the goal is."
          : pct
            ? "Enter the target as a percentage."
            : "Enter the target as an amount.",
      );
      return;
    }
    if (pct && amount > (spec.max ?? 100)) {
      setError(`That cannot be more than ${spec.max ?? 100}%.`);
      return;
    }
    if (!manual && amount === 0 && spec.judge !== "reduceTo") {
      setError("A target of nothing is met before it starts.");
      return;
    }
    const next: Goal = {
      id: editing?.id ?? uid(),
      ...draft,
      target: pct ? Math.round(amount * 10) / 10 : Math.round(amount * 100) / 100,
      why: why.trim() || undefined,
      createdAt: editing?.createdAt ?? today,
    };
    if (editing) {
      /*
       * A goal met is met for what it was. Change the reason and it stays met;
       * change what it measures, the target or the month, and it is a different
       * goal — judged again from the record, and celebrated again if the record
       * already shows it met. Keeping the stamp would call a goal met that
       * never was.
       */
      /*
       * A custom goal is ticked by hand, so an edit keeps the tick: rewording
       * something already done does not undo it. The card's Undo does that.
       */
      const same =
        manual ||
        editing.metric === next.metric &&
        editing.basis === next.basis &&
        editing.target === next.target &&
        editing.by === next.by &&
        editing.plan === next.plan &&
        editing.category === next.category &&
        editing.ignoreCards === next.ignoreCards;
      if (same && editing.metOn) next.metOn = editing.metOn;
      onAdd(next);
      return;
    }
    onAdd(next);
    setTarget("");
    setTitle("");
    setWhy("");
    setError("");
  };

  const preview = valid
    ? describe({ id: "", createdAt: "", target: amount, ...draft }, fmtCAD)
    : null;

  return (
    <div className={cn("space-y-5", wide && "lg:grid lg:grid-cols-2 lg:gap-x-10 lg:gap-y-5 lg:space-y-0")}>
      <Step
        letter="S"
        title="Specific"
        hint={
          metric === "cash" && cards === "ignore" && basis === "amount"
            ? "Chequing and savings as the bank shows them, with nothing taken off for the cards."
            : spec.source
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What to measure">
            <Select value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)}>
              <optgroup label="Where things stand">
                {METRICS.filter((m) => m.amount.shape === "level").map((m) => (
                  <option key={m.metric} value={m.metric}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={`Over ${year}`}>
                {METRICS.filter((m) => m.amount.shape === "flow").map((m) => (
                  <option key={m.metric} value={m.metric}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Your own">
                <option value={CUSTOM.metric}>{CUSTOM.label}</option>
              </optgroup>
            </Select>
          </Field>
          {manual ? null : (
            <Field label="Set as">
              <Select value={basis} onChange={(e) => setBasis(e.target.value as GoalBasis)}>
                <option value="amount">{def.amount.option}</option>
                <option value="percent">{def.percent.option}</option>
              </Select>
            </Field>
          )}
          {metric === "contribution" ? (
            <Field label="Which plan">
              <Select value={plan} onChange={(e) => setPlan(e.target.value as RegisteredPlan | "")}>
                <option value="">All plans</option>
                {REGISTERED_PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                    {accounts.some((a) => a.registration === p) ? "" : " (no account yet)"}
                  </option>
                ))}
              </Select>
            </Field>
          ) : metric === "cash" ? (
            <Field label="Credit cards">
              <Select value={cards} onChange={(e) => setCards(e.target.value as "net" | "ignore")}>
                <option value="net">Subtract what they owe</option>
                <option value="ignore">Leave them out</option>
              </Select>
            </Field>
          ) : metric === "spending" ? (
            <Field label="On what">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All spending</option>
                {[...categories].sort().map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
          {metric === "donations" && !categories.includes(DONATIONS_CATEGORY) ? (
            <p className="mt-2 text-[0.6875rem] text-ink-dim">
              There is no {DONATIONS_CATEGORY} category yet. Gifts to charity count once they are
              recorded under one — an import files a bank&rsquo;s charity rows there on its own.
            </p>
          ) : null}
          {noRoom ? (
            <p className="mt-2 text-[0.6875rem] text-ink-dim">
              No contribution room is set for {year} yet, so there is nothing to take a share of. Set it
              on the Year page, or in the January checklist.
            </p>
          ) : null}
      </Step>

      <Step letter="M" title="Measurable">
        {manual ? (
          <Field label={spec.field}>
            <Input
              maxLength={120}
              placeholder="e.g. Write a will"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        ) : (
          <Field label={spec.field}>
            <Input
              inputMode="decimal"
              placeholder={pct ? "e.g. 10" : metric === "donations" ? "e.g. 2000" : "e.g. 10000"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
        )}
      </Step>

      <Step letter="A" title="Achievable">
        {manual ? (
          /*
           * Nothing measures a goal of your own, so the one test of it is
           * whether you will know, without argument, the day it is done.
           */
          <p className="text-xs text-ink-dim">
            Nothing here measures it, so make it something you will know for certain is done — a
            thing finished, not a feeling.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <p>
                <span className="text-ink-faint">So far in {year}: </span>
                <span className="font-medium tabular-nums text-ink">
                  {soFar === null ? "—" : fmtTarget(draft, soFar)}
                </span>
              </p>
              <p>
                <span className="text-ink-faint">{Number(year) - 1}: </span>
                <span className="font-medium tabular-nums text-ink">
                  {lastYear === null ? "—" : fmtTarget(draft, lastYear)}
                </span>
              </p>
            </div>
            {pace ? <p className="mt-1.5 text-xs text-ink-dim">{pace}</p> : null}
          </>
        )}
      </Step>

      <Step letter="R" title="Relevant">
        <Field label="Why it matters (optional)">
          <Input
            maxLength={280}
            placeholder="e.g. A deposit for a place of our own"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        </Field>
      </Step>

      <Step letter="T" title="Time-bound">
        <Field
          label={spec.judge === "stayUnder" || spec.judge === "rateAtLeast" ? "Over January to" : "By the end of"}
        >
          <Select value={by} onChange={(e) => setBy(e.target.value)}>
            {MONTH_KEYS.map((m) => (
              <option
                key={m}
                value={m}
                // A month already past is no deadline — unless it is the one being edited.
                disabled={`${year}-${m}` < thisMonth && `${year}-${m}` !== editing?.by}
              >
                {monthName(`${year}-${m}`)} {year}
              </option>
            ))}
          </Select>
        </Field>
      </Step>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 lg:col-span-2">
        <p className="min-w-0 flex-1 text-sm text-ink-dim">
          {preview ? (
            <>
              <span className="text-ink-faint">Goal: </span>
              <span className="font-medium text-ink">{preview}</span>
            </>
          ) : (
            <span className="text-ink-faint">Pick a measure and a target to see the goal.</span>
          )}
        </p>
        <Button onClick={add}>
          {editing ? (
            <>
              <Check size={14} /> Save changes
            </>
          ) : (
            <>
              <Plus size={14} /> Add goal
            </>
          )}
        </Button>
      </div>
      {error ? <p className="text-xs text-negative lg:col-span-2">{error}</p> : null}
    </div>
  );
}

/**
 * Starting points, one click from a filled-in form.
 *
 * Percentages rather than amounts, deliberately: a share of income or a
 * year's growth means the same thing on anybody's record, where a dollar
 * figure would be a guess about whose. Each is only offered where it can be
 * measured — no room idea without a TFSA, no dining idea without the category.
 */
export function GoalIdeas({
  onPick,
  onScratch,
}: {
  onPick: (preset: GoalPreset) => void;
  /** An empty form, for a goal none of the ideas fits. */
  onScratch: () => void;
}) {
  const accounts = useFinance((s) => s.accounts);
  const categories = useFinance((s) => s.categories);
  const hasDebt = accounts.some((a) => isLiability(a.kind));
  const ideas: { label: string; preset: GoalPreset; when?: boolean }[] = [
    { label: "Save 20% of income", preset: { metric: "saved", basis: "percent", target: 20 } },
    { label: "Grow net worth by 10%", preset: { metric: "netWorth", basis: "percent", target: 10 } },
    {
      label: "Use all of your TFSA room",
      preset: { metric: "contribution", basis: "percent", target: 100, plan: "TFSA" },
      when: accounts.some((a) => a.registration === "TFSA"),
    },
    {
      label: "Cover 10% of spending with passive income",
      preset: { metric: "passive", basis: "percent", target: 10 },
    },
    {
      label: "Keep Dining under 5% of income",
      preset: { metric: "spending", basis: "percent", target: 5, category: "Dining" },
      when: categories.includes("Dining"),
    },
    { label: "Pay debt down by 25%", preset: { metric: "debt", basis: "percent", target: 25 }, when: hasDebt },
    { label: "Give 2% of income to charity", preset: { metric: "donations", basis: "percent", target: 2 } },
  ];
  const tile =
    "flex items-center gap-3 rounded-xl border border-line bg-elevated/40 p-3 text-left text-sm text-ink-dim transition-colors hover:border-brand/50 hover:text-ink";
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {ideas
        .filter((i) => i.when !== false)
        .map((i) => {
          const Icon = GOAL_ICONS[i.preset.metric ?? "saved"];
          return (
            <button key={i.label} type="button" onClick={() => onPick(i.preset)} className={tile}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                <Icon size={15} />
              </span>
              <span className="leading-snug">{i.label}</span>
            </button>
          );
        })}
      <button type="button" onClick={onScratch} className={cn(tile, "border-dashed")}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-elevated text-ink-faint">
          <PenLine size={15} />
        </span>
        <span className="leading-snug">Start from scratch</span>
      </button>
    </div>
  );
}

function Step({
  letter,
  title,
  hint,
  children,
}: {
  letter: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand/10 text-xs font-semibold text-brand"
      >
        {letter}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-xs font-medium text-ink-dim">{title}</p>
        {children}
        {hint ? <p className="mt-1.5 text-[0.6875rem] text-ink-faint">{hint}</p> : null}
      </div>
    </div>
  );
}

/* ── Celebrating one ── */

const CONFETTI_COLOURS = ["#f6cb6e", "#e3aec4", "#a877e2", "#7c30e6", "#34d399", "#60a5fa"];

/** A burst of confetti across the whole window, gone in a few seconds. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Two cannons from the lower corners, aimed up and in.
    const pieces = Array.from({ length: 220 }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = 9 + Math.random() * 9;
      return {
        x: left ? 0 : w,
        y: h * 0.85,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        spin: Math.random() * Math.PI,
        spinV: (Math.random() - 0.5) * 0.3,
        colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
        round: Math.random() < 0.3,
      };
    });

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = t > 3200 ? Math.max(0, 1 - (t - 3200) / 900) : 1;
      for (const p of pieces) {
        p.vy += 0.25;
        p.vx *= 0.99;
        p.vy *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.spinV;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.colour;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Squashed by the spin, so each piece looks like it is tumbling.
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.spin)) + 1);
        }
        ctx.restore();
      }
      if (fade > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
    />
  );
}

/**
 * A short bright chime: a major arpeggio up, then the chord held.
 *
 * Synthesised rather than loaded, so there is no file to fetch and nothing to
 * license. A browser that has not yet seen the page touched may refuse to play
 * sound at all; that is the browser's call, and the confetti and the message
 * say the same thing without it.
 */
export function playChime() {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return;
  }
  void ctx.resume().catch(() => {});
  const master = ctx.createGain();
  master.gain.value = 0.16;
  master.connect(ctx.destination);

  const note = (freq: number, at: number, length: number, level = 1) => {
    for (const [type, mult, gain] of [
      ["triangle", 1, level],
      ["sine", 2, level * 0.22],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(g).connect(master);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }
  };

  const t = ctx.currentTime + 0.03;
  // C5 E5 G5 C6, then the chord held under a high E.
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, t + i * 0.09, 0.5, 0.8));
  [523.25, 659.25, 783.99].forEach((f) => note(f, t + 0.42, 1.3, 0.45));
  note(1318.5, t + 0.42, 1.1, 0.35);
  window.setTimeout(() => void ctx.close().catch(() => {}), 2500);
}

/**
 * Watches for goals the record now shows met, and celebrates them once.
 *
 * Mounted by the shell, so a goal met by a checklist, an import or a price
 * refresh is celebrated on whichever page it happens. Each goal is stamped
 * with the day it was first seen met before anything is shown, which is what
 * stops a reload from celebrating it again.
 */
export function GoalWatcher() {
  const router = useRouter();
  const onGoals = usePathname() === "/goals";
  const inputs = useGoalInputs();
  const goals = useGoals((s) => s.goals);
  const state = useGoals((s) => s.state);
  const load = useGoals((s) => s.load);
  const celebrate = useGoals((s) => s.celebrate);
  const met = useGoals((s) => s.celebrating);
  const close = useGoals((s) => s.dismiss);

  useEffect(() => {
    if (inputs) void load();
  }, [inputs, load]);

  useEffect(() => {
    if (!inputs || state !== "ready") return;
    const fresh = newlyMet(goals, inputs);
    if (fresh.length === 0) return;
    celebrate(fresh, inputs.today);
    playChime();
  }, [inputs, state, goals, celebrate]);

  if (met.length === 0) return null;
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <>
      {reduceMotion ? null : <Confetti />}
      <Modal open onClose={close} title={met.length === 1 ? "Goal reached" : `${met.length} goals reached`}>
        <div className="flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-positive/15 text-positive">
            <PartyPopper size={26} />
          </div>
          <p className="mt-3 text-base font-semibold text-ink">
            You did it.
          </p>
          <ul className="mt-2 space-y-1">
            {met.map((g) => (
              <li key={g.id} className="text-sm text-ink-dim">
                {describe(g, fmtCAD)}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant={onGoals ? "primary" : "ghost"} onClick={close}>
            Close
          </Button>
          {/* Already on the page it would link to: nothing to go and see. */}
          {onGoals ? null : (
            <Button
              onClick={() => {
                close();
                router.push(`/goals#goal-${met[0].id}`);
              }}
            >
              See it on the goals page
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
