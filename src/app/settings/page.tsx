"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import { useFinance } from "@/lib/store";
import { PROVIDERS, invalidReason, type KeyState, type KeyStates, type Provider } from "@/lib/api-keys";

/**
 * Settings: at the moment, the keys this installation fetches prices with.
 *
 * They used to be environment variables, which put changing one beyond anybody
 * who was not also running the deployment. A key is still a secret, so this
 * page never receives one: it is told whether each is set, where it came from,
 * and its last four characters, and it sends a new one the other way.
 */

const PROVIDER_COPY: Record<
  Provider,
  { name: string; what: string; limits: string; free: string; url: string }
> = {
  eodhd: {
    name: "EODHD",
    what:
      "End-of-day prices for shares and funds — what a holding closed at. This is what most of the portfolio is valued with, and it is asked once a day per security rather than continuously.",
    limits:
      "The free plan allows 20 price lookups a day. The app spends them deliberately: it fetches the securities whose prices are oldest first, keeps the rest at their last known price, and marks those as not updated today rather than guessing.",
    free: "eodhd.com — free plan, no card",
    url: "https://eodhd.com/",
  },
  twelvedata: {
    name: "Twelve Data",
    what:
      "Live quotes for crypto, and the US dollar exchange rate used to convert holdings priced in dollars. Without it, crypto and anything in US dollars keep the last rate the app saw.",
    limits:
      "The free plan allows 8 requests a minute and 800 a day. The app holds a little of each back, so a price refresh cannot use the last of the allowance and leave the exchange rate unfetchable.",
    free: "twelvedata.com — free plan, no card",
    url: "https://twelvedata.com/",
  },
};

function Status({ state }: { state: KeyState }) {
  if (!state.set) {
    return <span className="text-xs font-medium text-amber-400">Not set</span>;
  }
  return (
    <span className="text-xs text-ink-faint">
      <span className="font-medium text-positive">In use</span> · {state.hint}
      {state.source === "environment" ? " · from this deployment's settings" : null}
    </span>
  );
}

export default function SettingsPage() {
  const demo = useFinance((s) => s.demo);
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

  const save = useCallback(
    async (provider: Provider) => {
      const value = drafts[provider];
      const reason = invalidReason(value);
      if (reason) {
        setError((e) => ({ ...e, [provider]: reason }));
        return;
      }
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
        setSaved(provider);
        setTimeout(() => setSaved(null), 2500);
      } catch {
        setError((e) => ({ ...e, [provider]: "That could not be saved." }));
      } finally {
        setSaving(null);
      }
    },
    [drafts],
  );

  return (
    <Shell title="Settings" subtitle="How this installation fetches prices">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 shrink-0 text-ink-faint" />
            <div className="min-w-0 space-y-2 text-sm text-ink-dim">
              <p className="font-medium text-ink">Market-data keys</p>
              <p className="text-xs leading-relaxed">
                Prices come from two providers, each with a free plan and a small
                daily allowance. Everything else in the app works without them:
                what they add is today&rsquo;s price on a holding, so a portfolio
                without keys is valued at the last prices it was given.
              </p>
              <p className="text-xs leading-relaxed">
                A key is stored with your record, and is only ever sent from this
                page to the server. It is never sent back, so what you see below
                is the last four characters and nothing more.
              </p>
            </div>
          </div>
        </Card>

        {demo ? (
          <Card className="border-brand/30 bg-brand/5 p-5">
            <p className="text-sm font-medium text-brand">Not used in the demo</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-dim">
              The demo never contacts a price provider — it neither needs a key
              nor could use one, because it runs entirely in this browser and
              makes no requests. Its prices are part of the invented data. Sign
              in to set keys for a real record.
            </p>
          </Card>
        ) : null}

        {PROVIDERS.map((provider) => {
          const copy = PROVIDER_COPY[provider];
          const state = states?.[provider];
          return (
            <Card key={provider}>
              <CardHeader
                title={copy.name}
                subtitle={copy.what}
                action={state ? <Status state={state} /> : null}
              />
              <div className="space-y-4 px-5 pb-5">
                <p className="text-xs leading-relaxed text-ink-faint">{copy.limits}</p>
                {demo ? null : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[16rem] flex-1">
                      <Field label={state?.set ? "Replace the key" : "Add a key"}>
                        <Input
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={drafts[provider]}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [provider]: e.target.value }))
                          }
                          placeholder={state?.set ? "Paste a new key to replace it" : "Paste the key"}
                        />
                      </Field>
                    </div>
                    <Button
                      onClick={() => void save(provider)}
                      disabled={saving === provider || drafts[provider].trim() === ""}
                    >
                      {saving === provider ? "Saving…" : "Save"}
                    </Button>
                    {state?.source === "account" ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDrafts((d) => ({ ...d, [provider]: "" }));
                          void fetch("/api/settings/api-keys", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ [provider]: "" }),
                          })
                            .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
                            .then((s: KeyStates) => setStates(s))
                            .catch(() => {});
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                )}
                {error[provider] ? (
                  <p className="text-xs text-negative">{error[provider]}</p>
                ) : null}
                {saved === provider ? (
                  <p className="text-xs text-positive">Saved. It is used from the next refresh.</p>
                ) : null}
                <a
                  href={copy.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-xs text-ink-faint underline-offset-2 hover:text-ink-dim hover:underline"
                >
                  {copy.free} <ExternalLink size={12} />
                </a>
              </div>
            </Card>
          );
        })}
      </div>
    </Shell>
  );
}
