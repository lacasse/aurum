"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFinance } from "./store";
import type { AssetClass, Currency } from "./types";

const emptySubscribe = () => () => {};

/** True once running on the client. Uses useSyncExternalStore so SSR and the
 * hydrating render both see `false` without needing setState-in-effect. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Gate for pages that read app state: skeleton until mounted AND the server
 * state (Postgres via /api/data) has loaded. Falls back to sample data if the
 * API is unreachable, in which case hydrated is set anyway.
 */
export function useReady(): boolean {
  const mounted = useMounted();
  const hydrated = useFinance((s) => s.hydrated);
  return mounted && hydrated;
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-2xl border border-line bg-surface" />
        ))}
      </div>
      <div className="h-80 rounded-2xl border border-line bg-surface" />
      <div className="h-72 rounded-2xl border border-line bg-surface" />
    </div>
  );
}

export type TickerStatus = "idle" | "loading" | "valid" | "invalid" | "unknown";

/**
 * Answers already paid for, kept for the life of the page.
 *
 * Every lookup costs a provider call from a small daily allowance, and a
 * debounced field re-asks the same question constantly: clearing a ticker and
 * retyping it, switching rows, reopening the dialog. Only definitive answers
 * are cached — an "unknown" means nobody looked, and caching that would make
 * an exhausted quota look permanent for the rest of the session.
 */
const validationCache = new Map<string, { valid: boolean; price: number | null }>();

const cacheKey = (ticker: string, assetClass: AssetClass, currency: Currency) =>
  `${ticker}|${assetClass}|${currency}`;

/**
 * Debounced ticker validation against the price APIs.
 *
 * Returns the validation status and the price, when there is one. A ticker
 * already in the portfolio resolves from the store without a request at all —
 * it is held, so it exists, and its price is already known.
 */
export function useTickerValidation(ticker: string, assetClass: AssetClass, currency: Currency = "USD") {
  const [status, setStatus] = useState<TickerStatus>("idle");
  const [price, setPrice] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const t = ticker.trim().toUpperCase();
  /*
   * The held position's price, or null when the ticker is not in the
   * portfolio. Selected down to a primitive so the store hands back a stable
   * value: returning the holding itself would be a fresh object every render
   * and would re-run the effect forever.
   */
  const heldPrice = useFinance((s) => {
    const h = s.holdings.find((x) => x.ticker.toUpperCase() === t);
    return h ? h.price : null;
  });

  // This effect synchronizes with an external system (the price API): it
  // resets to "idle" when the field is cleared and shows "loading" while the
  // debounced request is in flight. Both are deliberate single re-renders, not
  // the cascading render chain `set-state-in-effect` exists to catch.
  useEffect(() => {
    if (!t) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
      setPrice(null);
      return;
    }

    /*
     * A ticker you already hold needs no provider to confirm it exists, and
     * the trade log is mostly about positions you already have. This is the
     * difference between a call per keystroke-pause and no calls at all for
     * the common case.
     */
    if (heldPrice !== null) {
      setStatus("valid");
      setPrice(heldPrice > 0 ? heldPrice : null);
      return;
    }

    const key = cacheKey(t, assetClass, currency);
    const cached = validationCache.get(key);
    if (cached) {
      setStatus(cached.valid ? "valid" : "invalid");
      setPrice(cached.price);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/prices/validate?ticker=${encodeURIComponent(t)}&class=${encodeURIComponent(assetClass)}&currency=${encodeURIComponent(currency)}`,
          { cache: "no-store", signal: controller.signal },
        );
        // A failed request is not a verdict on the ticker.
        if (!res.ok) return setStatus("unknown");
        const data = (await res.json()) as {
          valid: boolean;
          checked?: boolean;
          price: number | null;
        };
        if (controller.signal.aborted) return;
        // `checked: false` means the daily allowance was gone and nothing was
        // asked. Saying "invalid" there accuses a perfectly good ticker.
        if (data.checked === false) {
          setStatus("unknown");
          setPrice(null);
          return;
        }
        validationCache.set(key, { valid: data.valid, price: data.price });
        setStatus(data.valid ? "valid" : "invalid");
        setPrice(data.price);
      } catch {
        if (!controller.signal.aborted) setStatus("unknown");
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [t, assetClass, currency, heldPrice]);

  return { status, price };
}
