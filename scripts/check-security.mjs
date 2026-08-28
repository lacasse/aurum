#!/usr/bin/env node
/*
 * Lightweight security regression check. Fails the build if it finds patterns
 * that must never re-enter the codebase. Run via: npm run check:security
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const IGNORED = new Set(["node_modules", ".next", ".git", "package-lock.json"]);
const SELF = "scripts/check-security.mjs";

// Build the forbidden pattern so this very file does not match itself.
const FORBIDDEN_SECRET = "aurum-dev-" + "secret-change-me";

const problems = [];

function walk(dir, file) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, file === undefined ? entry : `${file}/${entry}`);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|ya?ml|sh)$/.test(entry)) continue;
    const rel = file === undefined ? entry : `${file}/${entry}`;
    if (rel === SELF) continue;
    const content = readFileSync(full, "utf8");
    check(rel, content);
  }
}

/*
 * Absolute paths under a developer's home directory work on the machine they
 * were written on and nowhere else — not in CI, not in the container, not on a
 * second checkout. Anything machine-specific belongs in an env var or a path
 * resolved relative to the file.
 */
const HOME_PATH = /(?:^|[\s"'`(=:])(\/Users\/|\/home\/[a-z0-9_.-]+\/)/i;

/*
 * The EODHD free plan is 20 calls a day for the whole account. Two rules keep
 * that structural rather than remembered: the provider may only be called from
 * the price routes, and any file that calls it must reserve against the ledger
 * in the same file. Without the second rule a new call site could sit next to
 * a reserving one and silently spend the allowance.
 */
const EODHD_HOST = "eodhd" + ".com";
const EODHD_ALLOWED_DIR = "src/app/api/prices/";

function check(rel, content) {
  if (content.includes(EODHD_HOST)) {
    if (!rel.startsWith(EODHD_ALLOWED_DIR)) {
      problems.push(
        `${rel}: calls ${EODHD_HOST} outside ${EODHD_ALLOWED_DIR} — the daily cap is enforced there`,
      );
    } else if (!content.includes("reserveEodhdCalls")) {
      problems.push(
        `${rel}: calls ${EODHD_HOST} without reserveEodhdCalls — every call must reserve first`,
      );
    }
  }

  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    if (HOME_PATH.test(line)) {
      problems.push(`${rel}:${n}: absolute home-directory path is not portable`);
    }
    if (line.includes(FORBIDDEN_SECRET)) {
      problems.push(`${rel}:${n}: hardcoded fallback secret present`);
    }
    if (/AUTH_SECRET\s*\|\|[^=]=?=.?["'][^"']/.test(line)) {
      problems.push(`${rel}:${n}: AUTH_SECRET has a fallback default`);
    }
    if (/AUTH_PASSWORD\s*\|\|\s*["'].*["']/.test(line)) {
      problems.push(`${rel}:${n}: AUTH_PASSWORD has a fallback default`);
    }
  });
}

walk(ROOT);

/*
 * The cap itself. Tests and CI pin EODHD_DAY_LIMIT lower, but the fallback is
 * what production runs on, so it must never drift above the free plan's 20.
 */
const PLAN_LIMIT = 20;
const quotaSrc = readFileSync(join(ROOT, "src/lib/eodhd-quota.ts"), "utf8");
const fallback = /EODHD_DAY_LIMIT\s*\?\?\s*(\d+)/.exec(quotaSrc);
if (!fallback) {
  problems.push("src/lib/eodhd-quota.ts: no EODHD_DAY_LIMIT fallback found");
} else if (Number(fallback[1]) > PLAN_LIMIT) {
  problems.push(
    `src/lib/eodhd-quota.ts: default limit ${fallback[1]} exceeds the free plan's ${PLAN_LIMIT}/day`,
  );
}

if (problems.length) {
  console.error("SECURITY CHECK FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Security check passed: no forbidden patterns found.");
