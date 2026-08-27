"use client";

import { ThemeProvider } from "next-themes";
import { ReactNode, useEffect } from "react";
import { useFinance } from "@/lib/store";

export function Providers({ children }: { children: ReactNode }) {
  const loadFromServer = useFinance((s) => s.loadFromServer);

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
      {children}
    </ThemeProvider>
  );
}
