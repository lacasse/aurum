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
  ACCOUNT_TYPES,
  ASSET_CLASSES,
  CURRENCIES,
  type AccountKind,
  type AccountType,
  type AssetClass,
  type Currency,
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

export const accountSchema = z.object({
  id: requiredString,
  name: requiredString,
  institution: coercedString("—"),
  kind: enumWithDefault<AccountKind>(ACCOUNT_KINDS, "checking"),
  balance: moneyOrZero,
  history: z.array(monthlyPointSchema).catch([]),
});

export const transactionSchema = z.object({
  id: requiredString,
  date: z.string().regex(DATE, "date must be YYYY-MM-DD"),
  type: z.enum(["income", "expense"]),
  amount: positiveNumber.transform(roundMoney),
  category: coercedString("Other"),
  accountId: coercedString(""),
  payee: trimmedString(""),
  // `.optional()` is required: in Zod 4 a bare `z.unknown()` key still
  // rejects a missing property, which would refuse every note-less transaction.
  note: z
    .unknown()
    .optional()
    .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : undefined)),
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
    accountType: enumWithDefault<AccountType>(ACCOUNT_TYPES, "non-registered"),
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
    accountType: h.accountType,
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
