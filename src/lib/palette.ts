"use client";

import { useSyncExternalStore } from "react";

/**
 * The chart palette, in one editable place.
 *
 * This exists for the colour-picking page. The values below are the app's real
 * defaults; the page overrides them and stores the overrides in the browser, so
 * a colour tried there is the colour every chart draws with until it is reset.
 * Nothing here is written to the database — the palette is a look, not a
 * record, and clearing site data puts the defaults back.
 */

/**
 * The spectrum every ring, donut and category band is coloured from.
 *
 * Thirteen anchors, sampled to however many slices there are. See `spectrumAt`
 * for what sampling means. The long-form reasoning for this particular ramp
 * lives beside `ExposurePie`, which is what it was chosen for.
 */
export const DEFAULT_SPECTRUM = [
  "#0d3b52",
  "#12657f",
  "#2a7f8a",
  "#2e8b6f",
  "#43a047",
  "#a8c93a",
  "#e8c33a",
  "#f4a12a",
  "#f2762f",
  "#ea5765",
  "#d94f8c",
  "#b0509f",
  "#7b56ab",
] as const;

/**
 * The named colours that are not part of the spectrum.
 *
 * A spectrum slot means "the third of nine things"; these mean something in
 * themselves — money arriving is green wherever it is drawn, and the cost line
 * under the portfolio is amber on every page that draws it. They are named for
 * the job rather than the hue so that changing one here changes the meaning
 * consistently rather than one chart at a time.
 */
export const DEFAULT_ACCENTS = {
  /** Money arriving: income, gains, anything welcome. */
  positive: "#34d399",
  /** Money leaving: expenses, debt, losses. */
  negative: "#fb7185",
  /** The app's own violet — net worth, and the default sparkline. */
  brand: "#8b5cf6",
  /** The portfolio's market value, and the second series in a pair. */
  market: "#22d3ee",
  /** What was paid for it: cost basis, budgets, benchmarks. */
  cost: "#f59e0b",
  /** The pension, which belongs to neither cash nor market. */
  pension: "#f472b6",
  /** Bonds and other fixed income. */
  bonds: "#60a5fa",
  /** Passive income: a lighter reading of the brand violet. */
  passive: "#a78bfa",
} as const;

export type AccentName = keyof typeof DEFAULT_ACCENTS;

export interface Palette {
  spectrum: string[];
  accents: Record<AccentName, string>;
}

const STORAGE_KEY = "aurum.palette";

function defaults(): Palette {
  return {
    spectrum: [...DEFAULT_SPECTRUM],
    accents: { ...DEFAULT_ACCENTS },
  };
}

/**
 * Read the stored override, keeping only what still makes sense.
 *
 * A stored palette can outlive the shape it was saved against — a stop added
 * to the spectrum, an accent renamed — so every value is checked against the
 * defaults rather than trusted, and anything unrecognised falls back. The
 * alternative is a page that throws on a colour saved months ago.
 */
function load(): Palette {
  const base = defaults();
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Palette>;
    if (Array.isArray(saved.spectrum)) {
      base.spectrum = base.spectrum.map((c, i) =>
        isHex(saved.spectrum?.[i]) ? (saved.spectrum[i] as string) : c,
      );
    }
    if (saved.accents && typeof saved.accents === "object") {
      for (const key of Object.keys(base.accents) as AccentName[]) {
        const v = saved.accents[key];
        if (isHex(v)) base.accents[key] = v;
      }
    }
  } catch {
    /* Unreadable storage is the same as no storage. */
  }
  return base;
}

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

let current: Palette = load();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* Private browsing, a full quota — the colours still apply this session. */
  }
}

/** The live palette. Read at draw time, so an edit reaches the next render. */
export function palette(): Palette {
  return current;
}

/** Step `i` of `n` along the spectrum, ends included. */
export function spectrumAt(i: number, n: number): string {
  const stops = current.spectrum;
  if (n <= 1) return stops[Math.floor(stops.length / 2)];
  const at = Math.round((i * (stops.length - 1)) / (n - 1));
  return stops[Math.min(at, stops.length - 1)];
}

/** One named colour, by what it means rather than what it looks like. */
export function accent(name: AccentName): string {
  return current.accents[name];
}

export function setSpectrumStop(i: number, hex: string) {
  const spectrum = [...current.spectrum];
  spectrum[i] = hex;
  current = { ...current, spectrum };
  persist();
  emit();
}

export function setAccent(name: AccentName, hex: string) {
  current = { ...current, accents: { ...current.accents, [name]: hex } };
  persist();
  emit();
}

export function resetPalette() {
  current = defaults();
  persist();
  emit();
}

/** Whether anything has been changed from the shipped defaults. */
export function isCustomised(): boolean {
  return (
    current.spectrum.some((c, i) => c !== DEFAULT_SPECTRUM[i]) ||
    (Object.keys(DEFAULT_ACCENTS) as AccentName[]).some(
      (k) => current.accents[k] !== DEFAULT_ACCENTS[k],
    )
  );
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Subscribe a component to the palette.
 *
 * Only the picking page needs this. Everything else reads the palette while it
 * draws, which means an edit shows up the next time that chart renders — on the
 * picking page that is immediately, and elsewhere it is on the next visit,
 * which is all a stored preference needs to do.
 *
 * The server snapshot is the defaults rather than the stored palette, because
 * the server has no storage to read: returning anything else would render one
 * palette and hydrate into another.
 */
export function usePalette(): Palette {
  return useSyncExternalStore(subscribe, palette, defaults);
}
