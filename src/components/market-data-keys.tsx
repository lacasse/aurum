"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { PROVIDERS, invalidReason, type KeyState, type KeyStates, type Provider } from "@/lib/api-keys";

/*
 * The keys this account fetches prices with, as one card: two providers doing
 * two halves of one job. Shown as separate cards they read as three unrelated
 * settings; together, the card says what the pair is for and each section says
 * which half is its.
 *
 * A key is a secret, so this never receives one: it is told whether each is
 * set, where it came from, and its last four characters, and it sends a new
 * one the other way.
 */

const PROVIDER_COPY: Record<Provider, { name: string; role: string; limits: string }> = {
  eodhd: {
    name: "EODHD",
    role: "Prices for shares and funds",
    limits: "Free plan: 20 lookups a day, oldest prices first.",
  },
  twelvedata: {
    name: "Twelve Data",
    role: "Crypto prices and the US dollar rate",
    limits: "Free plan: 800 requests a day.",
  },
};

function Status({ state }: { state: KeyState }) {
  if (!state.set) {
    return <span className="text-xs font-medium text-amber-400">Not set</span>;
  }
  return (
    <span className="text-xs text-ink-faint">
      <span className="font-medium text-positive">In use</span> · {state.hint}
      {state.source === "environment"
        ? " · set by the installation"
        : null}
    </span>
  );
}

export function MarketDataKeys({ demo }: { demo: boolean }) {
  const [states, setStates] = useState<KeyStates | null>(null);
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ twelvedata: "", eodhd: "" });
  const [error, setError] = useState<Record<Provider, string>>({ twelvedata: "", eodhd: "" });
  const [saving, setSaving] = useState<Provider | null>(null);
  const [saved, setSaved] = useState<Provider | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    fetch("/api/settings/api-keys", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: KeyStates) => {
        if (!cancelled) setStates(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [demo]);

  const put = useCallback(async (provider: Provider, value: string) => {
    setError((e) => ({ ...e, [provider]: "" }));
    setSaving(provider);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [provider]: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError((e) => ({ ...e, [provider]: body.error ?? "That could not be saved." }));
        return;
      }
      setStates((await res.json()) as KeyStates);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      if (value) {
        setSaved(provider);
        setTimeout(() => setSaved(null), 2500);
      }
    } catch {
      setError((e) => ({ ...e, [provider]: "That could not be saved." }));
    } finally {
      setSaving(null);
    }
  }, []);

  const save = (provider: Provider) => {
    const reason = invalidReason(drafts[provider]);
    if (reason) setError((e) => ({ ...e, [provider]: reason }));
    else void put(provider, drafts[provider]);
  };

  return (
    <Card>
      <CardHeader
        title="Market-data keys"
        subtitle="Prices come from two free services. Without their keys, holdings keep the last price they were given."
        action={<KeyRound size={16} className="text-ink-faint" />}
      />
      <div className="space-y-3 px-5 pb-5">
        {demo ? (
          <p className="mt-4 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs leading-relaxed text-ink-dim">
            <span className="font-medium text-brand">Not used in the demo,</span> which
            runs in this browser and never fetches prices.
          </p>
        ) : null}

        <div className="mt-1 divide-y divide-line rounded-xl border border-line">
          {PROVIDERS.map((provider, i) => {
            const copy = PROVIDER_COPY[provider];
            const state = states?.[provider];
            return (
              <section key={provider} className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
                    {i + 1} of {PROVIDERS.length}
                  </span>
                  <h3 className="text-sm font-medium text-ink">{copy.name}</h3>
                  <span className="text-xs text-ink-dim">{copy.role}</span>
                  <span className="text-xs text-ink-faint">· {copy.limits}</span>
                  <span className="ml-auto">{state ? <Status state={state} /> : null}</span>
                </div>
                {demo ? null : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[16rem] flex-1">
                      <Field label={state?.set ? `Replace the ${copy.name} key` : `Add a ${copy.name} key`}>
                        <Input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={drafts[provider]}
                          onChange={(e) => setDrafts((d) => ({ ...d, [provider]: e.target.value }))}
                          placeholder={state?.set ? "Paste a new key to replace it" : "Paste the key"}
                        />
                      </Field>
                    </div>
                    <Button
                      onClick={() => save(provider)}
                      disabled={saving === provider || drafts[provider].trim() === ""}
                    >
                      {saving === provider ? "Saving…" : "Save"}
                    </Button>
                    {state?.source === "account" ? (
                      <Button variant="ghost" onClick={() => void put(provider, "")}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                )}
                {error[provider] ? <p className="text-xs text-negative">{error[provider]}</p> : null}
                {saved === provider ? (
                  <p className="text-xs text-positive">Saved. It is used from the next refresh.</p>
                ) : null}
              </section>
            );
          })}
        </div>
        <p className="text-xs text-ink-faint">
          Both have free plans; sign up on their sites. Your keys are used only for your
          prices, and after saving you only ever see the last four characters.
        </p>
      </div>
    </Card>
  );
}
