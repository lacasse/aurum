"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button, Card, CardHeader, Field, Input, Modal } from "@/components/ui";
import { useFinance } from "@/lib/store";
import { ERASE_PHRASE, isErasePhrase } from "@/lib/erase";

const GOES = [
  "Every account and its balance history",
  "Every transaction, recurring rule and imported month",
  "Every holding, trade and month-end value",
  "Budgets, categories and merchant rules",
  "Allocation targets, contribution room and expense settings",
];

const STAYS = [
  "Your sign-in: username and password",
  "Your market-data keys",
  "Everyone else's accounts and records, which this never reads or touches",
];

/**
 * Deletes the signed-in person's whole record, so they can start over.
 *
 * Three steps, each one a separate decision: read what goes and tick that it
 * cannot be undone; type a phrase, which cannot be done by accident; give the
 * password, which a browser left open does not know. The server asks for the
 * phrase and the password again for itself.
 */
export function StartOver() {
  const router = useRouter();
  const loadFromServer = useFinance((s) => s.loadFromServer);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setStep(1);
    setUnderstood(false);
    setPhrase("");
    setPassword("");
    setError("");
  };

  const erase = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/me/record", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: phrase, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Nothing was deleted. Please try again.");
        return;
      }
      await loadFromServer();
      setBusy(false);
      close();
      router.push("/");
    } catch {
      setError("Nothing was deleted. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-negative/40">
      <CardHeader
        title="Delete all my data"
        subtitle="Empty your record and start again from nothing. This affects only your account."
        action={<TriangleAlert size={16} className="text-negative" />}
      />
      <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-dim">
          This cannot be undone from inside the app. You will be asked to confirm
          three times before anything is deleted.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete all my data…
        </Button>
      </div>

      <Modal open={open} onClose={close} title={`Delete all my data — step ${step} of 3`}>
        {step === 1 ? (
          <div className="space-y-4 text-sm text-ink-dim">
            <div>
              <p className="font-medium text-negative">This permanently deletes:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {GOES.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium text-ink">This keeps:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {STAYS.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs leading-relaxed">
              There is no undo. The installation&rsquo;s automatic backups hold
              everyone&rsquo;s records together, so getting yours back from one
              means asking whoever runs this installation to restore it for
              everybody.
            </p>
            <label className="flex items-start gap-2 text-xs text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              I understand that my data will be deleted and cannot be recovered from the app.
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!understood} onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <form
            className="space-y-4 text-sm text-ink-dim"
            onSubmit={(e) => {
              e.preventDefault();
              if (isErasePhrase(phrase)) setStep(3);
            }}
          >
            <p>
              To confirm, type <span className="font-mono text-ink">{ERASE_PHRASE}</span> below.
            </p>
            <Field label="Confirmation">
              <Input
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={!isErasePhrase(phrase)}>
                Continue
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 ? (
          <form
            className="space-y-4 text-sm text-ink-dim"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) void erase();
            }}
          >
            <p>
              Last step. Enter your password and your whole record is deleted
              straight away.
            </p>
            <Field label="Password">
              <Input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error ? <p className="text-xs text-negative">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={busy || !password}>
                {busy ? "Deleting…" : "Delete everything"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </Card>
  );
}
