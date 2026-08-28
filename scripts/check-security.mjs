#!/usr/bin/env node
/*
 * Lightweight security regression check. Fails the build if it finds patterns
 * that must never re-enter the codebase. Run via: npm run check:security
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const IGNORED = new Set(["node_modules", ".next", ".git", "package-lock.json"]);
const SELF = "check-security.mjs";

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
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) continue;
    const rel = file === undefined ? entry : `${file}/${entry}`;
    if (rel === SELF) continue;
    const content = readFileSync(full, "utf8");
    check(rel, content);
  }
}

function check(rel, content) {
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
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

if (problems.length) {
  console.error("SECURITY CHECK FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("Security check passed: no forbidden patterns found.");
