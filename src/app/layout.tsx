import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Aurum · Personal Finance",
    template: "%s · Aurum",
  },
  description:
    "Track your net worth, income, expenses, budgets and investment portfolio — all locally in your browser.",
};

// Spelled out rather than using Next's generated `LayoutProps<"/">` global:
// that type only exists once `next build`/`next dev` has written .next/types, so
// a plain `tsc --noEmit` on a fresh checkout (as CI does) cannot see it.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          * Whether the sidebar is collapsed, applied before the first paint.
          *
          * The preference lives in this browser's storage, which the server
          * cannot see, so a React state read after hydration would draw the
          * wide rail first and snap it narrow — on every page, every load.
          * Stamping <html> here means the stylesheet already knows.
          */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('aurum.nav')==='collapsed')document.documentElement.dataset.nav='collapsed'}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
