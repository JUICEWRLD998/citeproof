import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `process.env` with `.env` folded in, matching how Next.js resolves configuration.
 *
 * vitest does not load `.env`, and Next.js does. A check that read only `process.env` would
 * therefore silently skip the one thing it was written to prove — the bundle grep — on the machine
 * where the app would happily find a key. That is a security check reporting green for the
 * uninteresting reason that it never ran.
 *
 * `process.env` wins, so a CI-provided value overrides a stale local file.
 *
 * The value is read from a gitignored file at test time and is never written to a fixture, a
 * snapshot, or a log. Only the key NAME is ever referenced in an assertion.
 */
export function envWithDotenv(root: string = process.cwd()): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return merged;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value && !merged[name]) merged[name] = value;
  }
  return merged;
}

/**
 * Find the key the way Next.js would, for the bundle grep.
 *
 * Returns null when no key is configured at all, which is a legitimate state — and then there is
 * nothing that could leak, so the caller reports the check as vacuous rather than as passed.
 */
export function resolveKeyForBundleGrep(root: string = process.cwd()): string | null {
  return envWithDotenv(root).OPENROUTER_API_KEY ?? null;
}
