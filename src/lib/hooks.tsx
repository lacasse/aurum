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

export type TickerStatus = "idle" | "loading" | "valid" | "invalid";

/**
 * Debounced ticker validation against the price APIs.
 * Returns the validation status and the fetched price (if valid).
 */
export function useTickerValidation(ticker: string, assetClass: AssetClass, currency: Currency = "USD") {
  const [status, setStatus] = useState<TickerStatus>("idle");
  const [price, setPrice] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (!t) {
      setStatus("idle");
      setPrice(null);
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
        if (!res.ok) return setStatus("invalid");
        const data = (await res.json()) as { valid: boolean; price: number | null };
        if (controller.signal.aborted) return;
        setStatus(data.valid ? "valid" : "invalid");
        setPrice(data.price);
      } catch {
        if (!controller.signal.aborted) setStatus("invalid");
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [ticker, assetClass, currency]);

  return { status, price };
}
