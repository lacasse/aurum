"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Lock, Wallet } from "lucide-react";
import { Button, Input, Field } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") || "/";

  // Same-origin check: only allow local path navigation (no open redirect).
  const next = (() => {
    if (typeof window === "undefined") return "/";
    if (!rawNext.startsWith("/") || rawNext.startsWith("//")) return "/";
    const target = new URL(rawNext, window.location.origin);
    if (target.origin !== window.location.origin) return "/";
    return target.pathname + target.search + target.hash;
  })();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid credentials");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20">
            <Wallet size={22} />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
            Aurum
          </h1>
          <p className="mt-1 text-sm text-ink-faint">Sign in to continue</p>
        </div>

        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <Field label="Username">
            <Input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              autoFocus
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
          </Field>

          {error ? (
            <p className="flex items-center gap-1.5 rounded-lg bg-negative/10 px-3 py-2 text-xs text-negative">
              <Lock size={12} />
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
