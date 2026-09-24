import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beltConfigFromEnv,
  proposeAndVerify,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  DEFAULT_SEED,
  PROMPT_VERSION,
} from "../lib/llm";
import type { VerifiedProposition } from "../lib/llm";
import { envWithDotenv } from "./helpers/env";

/**
 * RECORDER, not an acceptance test — it is the only file in `tests/` that writes anything.
 *
 * The plan's Phase 6 task list says to "record seed + prompt version in the fixture", so a live run
 * has to be attributable to the prompt that produced it: a result from `p1` is not comparable with
 * one from `p2`, and an unrecorded seed makes "the demo replays" an assertion rather than a receipt.
 * This writes `fixtures/belt-run.json` — the run's parameters, the span the model proposed, and what
 * the REAL matcher made of it.
 *
 * It lives here rather than in `.recon/` for a concrete reason: it must verify through
 * `lib/match` — the same code path the product uses — and the plain-JS `.recon/*.mjs` probes cannot
 * import the TypeScript module graph (the repo's relative imports are extensionless, which Node's
 * type-stripping resolver refuses). Re-implementing the matcher in the recorder would defeat the
 * purpose of recording it: the point is that a *verified* span was recorded.
 *
 * Opt-in, because it costs money and needs a key. A deterministic suite must not silently become a
 * network suite:
 *
 *   RUN_LIVE_BELT=1 npx vitest run tests/belt-record.test.ts
 *
 * The record is only written after every claim below holds, so a stale or edited file cannot be
 * mistaken for a measurement. `tests/selfverify.test.ts` then checks the record against the current
 * code constants and re-matches the recorded span, so the artifact fails the build when it rots.
 */

const root = process.cwd();
const CASE_FIXTURE = "fixtures/corpus/us-347-0483-01.json";
const CASE_CITATION = "347 U.S. 483";

/** The same proposition the live determinism test uses, so the two records are comparable. */
const PROPOSITION = "Racial segregation in public education is unconstitutional.";

/**
 * The probe's adversarial control (`.recon/probe-seed-determinism.mjs` §4), reused verbatim so the
 * measurement stays comparable: nothing in Brown v. Board addresses the Seventh Amendment.
 */
const UNSUPPORTED_PROPOSITION = "The Seventh Amendment guarantees a jury trial in all civil actions.";

/** The plan's own measurement was 5/5; the same count is repeated here so the record is comparable. */
const RUNS = 5;

const live = process.env.RUN_LIVE_BELT === "1" ? it : it.skip;

describe("belt recorder: a replayable run, written down", () => {
  live(
    `records ${RUNS} identical live runs and the one decline into fixtures/belt-run.json`,
    async () => {
      const env = envWithDotenv(root);
      const config = beltConfigFromEnv(env);
      expect(config, "RUN_LIVE_BELT=1 but no OPENROUTER_API_KEY in the environment or .env").not.toBeNull();
      // Recorded, because a run through a different provider is not comparable with this one.
      expect(config!.seed).toBe(DEFAULT_SEED);
      expect(config!.temperature).toBe(0);
      // The pinning default is what makes the seed a reproducible setting rather than routing luck,
      // so a run recorded with a different pin is not the documented configuration.
      if (!env.OPENROUTER_PROVIDER) {
        expect(config!.pinProvider).toBe(DEFAULT_PROVIDER);
      }

      const opinion = JSON.parse(readFileSync(join(root, CASE_FIXTURE), "utf8")).text as string;
      expect(opinion.length, "the corpus fixture the record names is not the one this measures").toBeGreaterThan(
        20_000,
      );

      const runs: VerifiedProposition[] = [];
      for (let i = 0; i < RUNS; i++) {
        runs.push(await proposeAndVerify(opinion, PROPOSITION, config));
      }

      const spans = runs.map((r) => r.attempt.proposal?.proposedSpan ?? null);
      const proposed = runs.filter((r) => r.attempt.status === "proposed").length;
      const supported = runs.filter((r) => r.verification.status === "supported").length;
      const statuses = [...new Set(runs.map((r) => r.verification.status))];
      const byteIdenticalRuns = spans.filter((s) => s !== null && s === spans[0]).length;
      const providers = [...new Set(runs.map((r) => r.attempt.provider ?? "(not reported)"))];

      // Every claim in the record is asserted BEFORE it is written. A recorder that writes whatever
      // came back would turn a broken run into evidence.
      expect(proposed, "the model did not propose a span for every run").toBe(RUNS);
      expect(supported, "a proposed span was not found verbatim by the matcher").toBe(RUNS);
      expect(statuses).toEqual(["supported"]);
      expect(byteIdenticalRuns, "identical requests did not return identical output").toBe(RUNS);
      expect(providers.length, `routed to more than one provider: ${providers.join(", ")}`).toBe(1);
      if (config!.pinProvider) {
        expect(providers[0], "the pinned provider did not serve the run").toBe(config!.pinProvider);
      }

      const first = runs[0];
      const span = first.verification.span!;
      expect(first.verification.verbatim, "the verified span is not the opinion's own bytes").toBe(
        opinion.slice(span.start, span.end),
      );

      // The opposite direction, and it is the point of the belt: an unsupported proposition must
      // never come back `supported`. The model declining is the good outcome; being caught is the
      // designed one. Both are recorded rather than only the flattering case.
      const decline = await proposeAndVerify(opinion, UNSUPPORTED_PROPOSITION, config);
      expect(
        decline.verification.status,
        "the belt reported SUPPORT for a proposition the opinion does not address",
      ).not.toBe("supported");

      const costUsd = [...runs, decline].reduce((sum, r) => sum + (r.attempt.usage?.costUsd ?? 0), 0);
      const record = {
        recordedAt: new Date().toISOString().slice(0, 10),
        recordedBy: "RUN_LIVE_BELT=1 npx vitest run tests/belt-record.test.ts",
        promptVersion: PROMPT_VERSION,
        seed: config!.seed,
        temperature: config!.temperature,
        model: config!.model,
        pinnedProvider: config!.pinProvider ?? null,
        case: { citation: CASE_CITATION, fixture: CASE_FIXTURE },
        proposition: PROPOSITION,
        runs: RUNS,
        byteIdenticalRuns,
        providersServed: providers,
        proposedSpan: first.attempt.proposal!.proposedSpan,
        proposedSpanChars: first.attempt.proposal!.proposedSpan.length,
        verification: {
          status: first.verification.status,
          start: span.start,
          end: span.end,
          selfReportedConfidence: first.verification.selfReportedConfidence ?? null,
        },
        totalCostUsd: Number(costUsd.toFixed(6)),
        generationIds: runs.map((r) => r.attempt.generationId),
        declineControl: {
          proposition: UNSUPPORTED_PROPOSITION,
          status: decline.verification.status,
        },
      };

      writeFileSync(join(root, "fixtures/belt-run.json"), JSON.stringify(record, null, 2) + "\n");

      console.log(
        `  [belt:record] ${byteIdenticalRuns}/${RUNS} byte-identical · provider=${providers[0]} · ` +
          `span chars ${span.start}-${span.end} · cost $${record.totalCostUsd.toFixed(6)} · ` +
          `unsupported-proposition control: ${decline.verification.status}`,
      );
    },
    300_000,
  );
});
