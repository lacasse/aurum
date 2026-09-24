"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { useFinance } from "@/lib/store";
import { leaveDemo } from "@/lib/demo";

/**
 * Where an invitation link lands: choose a username and a password, and you
 * have an account. The link is good once; the page checks before showing the
 * form, so someone with a used or expired link is told so instead of filling
 * in a form that cannot work.
 */
export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const loadFromServer = useFinance((s) => s.loadFromServer);
  const [usable, setUsable] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { usable?: boolean }) => {
        if (!cancelled) setUsable(Boolean(d.usable));
      })
      .catch(() => {
        if (!cancelled) setUsable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That did not work. Please try again.");
        if (res.status === 410) setUsable(false);
        return;
      }
      // Signed in by the server. Load the new, empty record before arriving in it.
      leaveDemo();
      await loadFromServer();
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <span
            className="h-12 w-12 rounded-full shadow-sm"
            style={{
              background:
                "linear-gradient(135deg, #f6cb6e 0%, #e3aec4 34%, #a877e2 66%, #7c30e6 100%)",
            }}
          />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Join Aurum</h1>
          <p className="mt-1 text-sm text-ink-faint">
            You have been invited to keep your own record here.
          </p>
        </div>

        {usable === false ? (
          <div className="mt-8 rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-sm font-medium text-ink">This invitation cannot be used</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              It has already been used, has expired, or was never valid. Ask whoever
              invited you for a new link.
            </p>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => router.push("/login")}>
              Go to sign in
            </Button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
          >
            <Field label="Username">
              <Input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="letters, digits, . _ -"
                required
                autoFocus
                disabled={usable === null}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
                required
                disabled={usable === null}
              />
            </Field>
            <Field label="Password again">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={usable === null}
              />
            </Field>
            <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
              Your record starts empty and is yours alone: nobody else using this
              installation can see it, and you cannot see theirs.
            </p>
            {error ? (
              <p className="flex items-center gap-1.5 rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">
                <Lock size={12} />
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || usable !== true}>
              {busy ? "Creating your account…" : "Create account"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
