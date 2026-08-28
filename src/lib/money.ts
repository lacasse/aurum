/**
 * Money arithmetic in integer cents.
 *
 * IEEE-754 doubles cannot represent most decimal cent values exactly, so
 * naive accumulation drifts: `0.1 + 0.2 !== 0.3`, and summing a few hundred
 * transactions can land a fraction of a cent away from the true total. Every
 * currency total in this app therefore accumulates as integers and converts
 * back only at the end, where the result is exact by construction.
 *
 * Postgres holds these values as `numeric` (see src/db/schema.ts); these
 * helpers keep the JavaScript side from reintroducing the error the database
 * type exists to prevent.
 */

const CENTS_PER_UNIT = 100;

/**
 * Scale a decimal amount to whole cents.
 *
 * The `toPrecision(15)` pass corrects binary-float artifacts before rounding:
 * `1.005 * 100` evaluates to `100.49999999999999`, which would round down to
 * 100 (i.e. $1.00) instead of the intended 101 ($1.01). Re-rounding at 15
 * significant digits — comfortably inside a double's ~15.95 digits of
 * precision — recovers the decimal value that was actually meant.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(Number((amount * CENTS_PER_UNIT).toPrecision(15)));
}

/** Convert whole cents back to a decimal amount. */
export function fromCents(cents: number): number {
  return cents / CENTS_PER_UNIT;
}

/** Round an amount to whole cents. */
export function roundMoney(amount: number): number {
  return fromCents(toCents(amount));
}

/** Sum amounts exactly, accumulating in integer cents. */
export function sumMoney(amounts: Iterable<number>): number {
  let cents = 0;
  for (const amount of amounts) cents += toCents(amount);
  return fromCents(cents);
}

/** Quantity x unit price, rounded to whole cents. */
export function multiplyMoney(quantity: number, unitPrice: number): number {
  return roundMoney(quantity * unitPrice);
}

/**
 * Sum of `quantity * unitPrice` products, each rounded to the cent before
 * accumulating — so the total matches the sum of the displayed line items.
 */
export function sumProducts(
  pairs: Iterable<readonly [quantity: number, unitPrice: number]>,
): number {
  let cents = 0;
  for (const [quantity, unitPrice] of pairs) cents += toCents(quantity * unitPrice);
  return fromCents(cents);
}

/** Difference of two amounts, exact to the cent. */
export function subtractMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

/** Sum of two amounts, exact to the cent. */
export function addMoney(a: number, b: number): number {
  return fromCents(toCents(a) + toCents(b));
}
