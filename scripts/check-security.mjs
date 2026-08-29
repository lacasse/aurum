#!/usr/bin/env node
/*
 * Lightweight security regression check. Fails the build if it finds patterns
 * that must never re-enter the codebase. Run via: npm run check:security
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const IGNORED = new Set([
  "node_modules",
  ".next",
  ".git",
  ".test-build", // compiled test output, not source
  "package-lock.json",
]);
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
 * a short list of places, and any file that calls it must reserve against the
 * ledger in the same file. Without the second rule a new call site could sit
 * next to a reserving one and silently spend the allowance.
 *
 * The benchmark filler is on the list because it is not a price route but
 * genuinely needs the provider: it tops up the shipped XEQT series when a
 * completed month is missing, once a month, one call however wide the gap. It
 * reserves like everything else — and against a lowered ceiling, so it cannot
 * take the last calls a price refresh depends on.
 */
const EODHD_HOST = "eodhd" + ".com";
const EODHD_ALLOWED = ["src/app/api/prices/", "src/db/benchmark.ts"];

/*
 * Twelve Data has the same shape of limit — 8 credits a minute, 800 a day — and
 * the same rule: every call site must reserve first. The FX helper calls it too,
 * so the allowed set is a list rather than a single directory.
 */
const TWELVEDATA_HOST = "api.twelvedata" + ".com";
const TWELVEDATA_ALLOWED = ["src/app/api/prices/", "src/lib/fx.ts"];

function check(rel, content) {
  if (content.includes(EODHD_HOST)) {
    if (!EODHD_ALLOWED.some((allowed) => rel.startsWith(allowed))) {
      problems.push(
        `${rel}: calls ${EODHD_HOST} outside ${EODHD_ALLOWED.join(" / ")} — the daily cap is enforced there`,
      );
    } else if (!content.includes("reserveEodhdCalls")) {
      problems.push(
        `${rel}: calls ${EODHD_HOST} without reserveEodhdCalls — every call must reserve first`,
      );
    }
  }

  if (content.includes(TWELVEDATA_HOST)) {
    if (!TWELVEDATA_ALLOWED.some((allowed) => rel.startsWith(allowed))) {
      problems.push(
        `${rel}: calls ${TWELVEDATA_HOST} outside ${TWELVEDATA_ALLOWED.join(" / ")}`,
      );
    } else if (!content.includes("reserveTwelveDataCredits")) {
      problems.push(
        `${rel}: calls ${TWELVEDATA_HOST} without reserveTwelveDataCredits — every call must reserve first`,
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

/* The same, for Twelve Data's free plan. */
const TD_PLAN = { TWELVEDATA_MINUTE_LIMIT: 8, TWELVEDATA_DAY_LIMIT: 800 };
const tdSrc = readFileSync(join(ROOT, "src/lib/twelvedata-quota.ts"), "utf8");
for (const [name, planLimit] of Object.entries(TD_PLAN)) {
  const found = new RegExp(`${name}\\s*\\?\\?\\s*(\\d+)`).exec(tdSrc);
  if (!found) {
    problems.push(`src/lib/twelvedata-quota.ts: no ${name} fallback found`);
  } else if (Number(found[1]) > planLimit) {
    problems.push(
      `src/lib/twelvedata-quota.ts: default ${name} ${found[1]} exceeds the free plan's ${planLimit}`,
    );
  }
}

if (problems.length) {
  console.error("SECURITY CHECK FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Security check passed: no forbidden patterns found.");
