/**
 * Request-body schemas, declared once and shared by every API route.
 *
 * These replace the hand-rolled `typeof` / `Number.isFinite` ladders that used
 * to live in `src/db/repo.ts`: each field's coercion, default and constraint is
 * stated in one place, so a new field cannot silently ship unvalidated.
 *
 * The coercions deliberately mirror the old behaviour (`Number(x)`,
 * `String(x ?? fallback)`) so existing clients keep working. What has been
 * tightened is the set of enum-like fields — `kind`, `assetClass`,
 * `accountType`, `currency` — which previously took any string and were merely
 * cast to their union type.
 */
import { z } from "zod";
import {
  ACCOUNT_KINDS,
  ASSET_CLASSES,
  CURRENCIES,
  RECURRENCE_FREQUENCIES,
  REGISTRATIONS,
  type AccountKind,
  type AssetClass,
  type Currency,
  type RecurrenceFrequency,
  type Registration,
} from "./types";
import { roundMoney } from "./money";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** Mirrors `String(value ?? fallback)`. */
const coercedString = (fallback: string) =>
  z.preprocess((v) => (v == null ? fallback : String(v)), z.string());

/** Mirrors `String(value ?? fallback).trim()`. */
const trimmedString = (fallback: string) =>
  coercedString(fallback).transform((s) => s.trim());

/** A string that must be present and non-blank. */
const requiredString = z.string().trim().min(1);

/** Mirrors `Number(value)`, required finite and strictly positive. */
const positiveNumber = z.coerce.number().finite().positive();

/** Mirrors `Number(value)`, finite, clamped at zero, defaulting to zero. */
const nonNegativeNumber = z.coerce
  .number()
  .finite()
  .transform((n) => Math.max(0, n))
  .catch(0);

/** A finite number, or `undefined` when absent/unparseable. */
const optionalNumber = z.coerce
  .number()
  .finite()
  .optional()
  .catch(undefined);

/** A money amount: finite, rounded to whole cents, defaulting to zero. */
const moneyOrZero = z.coerce
  .number()
  .finite()
  .transform(roundMoney)
  .catch(0);

const numberArray = z.array(z.coerce.number().finite()).catch([]);

/** An enum that falls back to `fallback` when the field is absent. */
const enumWithDefault = <T extends string>(values: readonly T[], fallback: T) =>
  z.preprocess(
    (v) => (v == null ? fallback : v),
    z.enum(values as unknown as [T, ...T[]]),
  );

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const monthKeySchema = z.string().regex(MONTH, "month must be YYYY-MM");

export const monthlyPointSchema = z.object({
  month: z.string().regex(MONTH),
  value: z.coerce.number().finite(),
});

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

/** An optional account reference: absent, or a non-blank id. */
const optionalAccountId = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined));

export const accountSchema = z.object({
  id: requiredString,
  name: requiredString,
  institution: coercedString("—"),
  kind: enumWithDefault<AccountKind>(ACCOUNT_KINDS, "checking"),
  balance: moneyOrZero,
  history: z.array(monthlyPointSchema).catch([]),
  registration: z
    .enum(REGISTRATIONS as unknown as [Registration, ...Registration[]])
    .optional()
    .catch(undefined),
});

/**
 * Every transaction must touch at least one of your accounts, and the type
 * decides which side. Rejecting the mismatched shapes here keeps the balance
 * arithmetic in the repository total: it never has to ask "what if neither
 * side is set?".
 */
export const transactionSchema = z
  .object({
    id: requiredString,
    date: z.string().regex(DATE, "date must be YYYY-MM-DD"),
    type: z.enum(["income", "expense", "transfer"]),
    amount: positiveNumber.transform(roundMoney),
    category: coercedString("Other"),
    sourceAccountId: optionalAccountId,
    destinationAccountId: optionalAccountId,
    payee: trimmedString(""),
    // `.optional()` is required: in Zod 4 a bare `z.unknown()` key still
    // rejects a missing property, which would refuse every note-less transaction.
    note: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)),
    recurringId: optionalAccountId,
  })
  .superRefine((t, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    if (t.type === "expense" && !t.sourceAccountId) {
      issue("an expense needs the account the money left", "sourceAccountId");
    }
    if (t.type === "income" && !t.destinationAccountId) {
      issue("income needs the account the money arrived in", "destinationAccountId");
    }
    if (t.type === "transfer") {
      if (!t.sourceAccountId) issue("a transfer needs a source account", "sourceAccountId");
      if (!t.destinationAccountId) {
        issue("a transfer needs a destination account", "destinationAccountId");
      }
      if (t.sourceAccountId && t.sourceAccountId === t.destinationAccountId) {
        issue("a transfer must move money between two different accounts", "destinationAccountId");
      }
    }
  });

export const holdingSchema = z
  .object({
    id: requiredString,
    ticker: requiredString,
    name: z.coerce.string().optional().catch(undefined),
    assetClass: enumWithDefault<AssetClass>(ASSET_CLASSES, "US Equity"),
    sector: z.coerce.string().optional().catch(undefined),
    shares: positiveNumber,
    avgCost: positiveNumber,
    price: positiveNumber,
    history: numberArray,
    dividendsReceived: nonNegativeNumber,
    accountId: requiredString,
    currency: enumWithDefault<Currency>(CURRENCIES, "USD"),
    priceCAD: optionalNumber,
    avgCostCAD: optionalNumber,
    dividendsReceivedCAD: optionalNumber,
    historyCAD: numberArray,
  })
  // Cross-field defaults: the CAD mirror of each figure falls back to the
  // listing-currency figure, and name/sector fall back to ticker/assetClass.
  .transform((h) => ({
    id: h.id,
    ticker: h.ticker.toUpperCase(),
    name: (h.name ?? h.ticker).trim(),
    assetClass: h.assetClass,
    sector: h.sector ?? h.assetClass,
    shares: h.shares,
    avgCost: h.avgCost,
    price: h.price,
    history: h.history,
    dividendsReceived: h.dividendsReceived,
    accountId: h.accountId,
    currency: h.currency,
    priceCAD: h.priceCAD ?? h.price,
    avgCostCAD: h.avgCostCAD ?? h.avgCost,
    dividendsReceivedCAD: h.dividendsReceivedCAD ?? h.dividendsReceived,
    historyCAD: h.historyCAD.length > 0 ? h.historyCAD : h.history,
  }));

export const snapshotSchema = z
  .object({
    month: z.string().regex(MONTH, "month must be YYYY-MM"),
    holdingId: requiredString,
    ticker: requiredString,
    price: positiveNumber,
    avgCost: positiveNumber,
    shares: positiveNumber,
    value: z.coerce.number().finite(),
    valueCAD: optionalNumber,
  })
  .transform((s) => ({
    ...s,
    ticker: s.ticker.toUpperCase(),
    valueCAD: s.valueCAD ?? s.value,
  }));

export const snapshotsBodySchema = z.object({
  snapshots: z.array(snapshotSchema),
});

/* ------------------------------------------------------------------ */
/* Smaller route bodies                                                */
/* ------------------------------------------------------------------ */

/**
 * A recurring rule is a transaction template plus a schedule, so it carries
 * the same source/destination rules. `nextDate` defaults to the start date:
 * a new rule has not posted anything yet.
 */
export const recurringRuleSchema = z
  .object({
    id: requiredString,
    type: z.enum(["income", "expense", "transfer"]),
    amount: positiveNumber.transform(roundMoney),
    category: coercedString("Other"),
    sourceAccountId: optionalAccountId,
    destinationAccountId: optionalAccountId,
    payee: trimmedString(""),
    note: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)),
    frequency: z.enum(
      RECURRENCE_FREQUENCIES as unknown as [RecurrenceFrequency, ...RecurrenceFrequency[]],
    ),
    startDate: z.string().regex(DATE, "startDate must be YYYY-MM-DD"),
    endDate: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === "string" && DATE.test(v) ? v : undefined)),
    nextDate: z
      .unknown()
      .optional()
      .transform((v) => (typeof v === "string" && DATE.test(v) ? v : undefined)),
    active: z.coerce.boolean().catch(true),
  })
  .transform((r) => ({ ...r, nextDate: r.nextDate ?? r.startDate }))
  .superRefine((r, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    if (r.type === "expense" && !r.sourceAccountId) {
      issue("an expense needs the account the money leaves", "sourceAccountId");
    }
    if (r.type === "income" && !r.destinationAccountId) {
      issue("income needs the account the money arrives in", "destinationAccountId");
    }
    if (r.type === "transfer") {
      if (!r.sourceAccountId) issue("a transfer needs a source account", "sourceAccountId");
      if (!r.destinationAccountId) {
        issue("a transfer needs a destination account", "destinationAccountId");
      }
      if (r.sourceAccountId && r.sourceAccountId === r.destinationAccountId) {
        issue("a transfer must move money between two different accounts", "destinationAccountId");
      }
    }
    if (r.endDate && r.endDate < r.startDate) {
      issue("the end date cannot precede the start date", "endDate");
    }
  });

export const budgetSchema = z.object({
  category: requiredString,
  limit: positiveNumber.transform(roundMoney),
});

export const categorySchema = z.object({
  name: requiredString,
});

export const renameCategorySchema = z.object({
  oldName: requiredString,
  newName: requiredString,
});

export const merchantRuleSchema = z.object({
  merchant: requiredString.transform((s) => s.toLowerCase()),
  category: requiredString,
});

export const deleteDemoSchema = z.object({
  confirm: z.literal("DELETE"),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().trim().min(1),
});

/* ------------------------------------------------------------------ */
/* Error formatting                                                    */
/* ------------------------------------------------------------------ */

/** Render a ZodError as a single readable `field: reason` line. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}
