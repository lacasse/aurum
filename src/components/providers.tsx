"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode, useEffect } from "react";
import { useFinance } from "@/lib/store";

/**
 * Says that the record could not be read, instead of drawing a page as though
 * it had been.
 *
 * A blank app and a real one differ only in their numbers, so a load that fails
 * silently is indistinguishable from a record that is empty — or, as it was
 * before, from somebody else's money rendered in place of yours.
 */
function LoadFailure({ kind }: { kind: "auth" | "failed" }) {
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-negative px-4 py-3 text-center text-sm text-white">
      {kind === "auth" ? (
        <>
          Your session has expired, so none of your data is shown below.{" "}
          <a href="/login" className="font-semibold underline">
            Sign in again
          </a>
          .
        </>
      ) : (
        <>
          Your data could not be loaded, so none of it is shown below. Nothing has
          been changed. Reload to try again.
        </>
      )}
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const loadFromServer = useFinance((s) => s.loadFromServer);
  const loadError = useFinance((s) => s.loadError);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {loadError ? <LoadFailure kind={loadError} /> : null}
      {children}
    </ThemeProvider>
  );
}
