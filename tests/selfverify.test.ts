import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  beltConfigFromEnv,
  beltAvailable,
  beltMode,
  proposeAndVerify,
  proposeSupportingSpan,
  redactKey,
  scrubKey,
  summarise,
  verifyAttempt,
  verifyProposal,
  DEFAULT_SEED,
  PROMPT_VERSION,
} from "../lib/llm";
import type { PropositionAttempt } from "../lib/llm";
import { findBestMatch } from "../lib/match";
import { MIN_VERBATIM_RUN_TOKENS } from "../lib/types";

/**
 * Phase 6 acceptance, from implementation.md:
 *   - a stubbed model response citing a span that is NOT in the opinion is caught and reported as
 *     an unsupported span
 *   - a real span passes
 *   - identical seed ⇒ identical output across runs
 *   - the key is read server-side only and never reaches the client bundle (assert by grepping the
 *     built client output for the key)
 *
 * Watch item: "the belt must have a NO-KEY PATH — if OPENROUTER_API_KEY is absent the app degrades
 * to Phases 1–5 and still audits. Never let the demo depend on the belt being up."
 *
 * The asymmetry these tests protect: a false "supported" is a quotation the court never wrote,
 * rendered beside real ones. Every no-key, no-span, failed-request and fabricated-span case must
 * therefore land somewhere OTHER than `supported`.
 */

const root = process.cwd();
const brown = JSON.parse(readFileSync(join(root, "fixtures/corpus/us-347-0483-01.json"), "utf8"))
  .text as string;
const HOLDING = "Separate educational facilities are inherently unequal.";

describe("self-verify: a real span PASSES", () => {
  it("accepts a span that is genuinely in the opinion, and reports where", () => {
    const v = verifyProposal(brown, { proposedSpan: HOLDING, selfReportedConfidence: 0.9 });
    expect(v.status).toBe("supported");
    expect(v.span).toBeDefined();
    // The offset must actually contain the sentence, in the OPINION's own bytes.
    expect(brown.slice(v.span!.start, v.span!.end)).toBe(HOLDING);
    // And the verbatim field is the opinion's text, not the model's.
    expect(v.verbatim).toBe(HOLDING);
  });

  it("accepts a span the model copied with different whitespace, and returns the opinion's bytes", () => {
    // Normalisation tolerates whitespace and quote marks, which is exactly why the report must
    // render the OPINION's text: the model's string and the opinion's can differ character by
    // character while still matching, and only the opinion's is evidence.
    const wrapped = `We conclude that in the field of public education\n      the doctrine of “separate but equal” has no place.`;
    const v = verifyProposal(brown, { proposedSpan: wrapped, selfReportedConfidence: 0.5 });
    expect(v.status).toBe("supported");
    expect(v.verbatim).not.toContain("\n");
    expect(brown).toContain(v.verbatim!);
  });

  it("finds the exact frozen offset the ground truth records", () => {
    const v = verifyProposal(brown, { proposedSpan: HOLDING, selfReportedConfidence: 1 });
    expect(v.span!.start).toBe(9564);
  });
});

describe("self-verify: a span NOT in the opinion is CAUGHT", () => {
  it("reports an unsupported span when the model cites text the opinion never contains", () => {
    // The core acceptance criterion. A model asserting a confident, fluent sentence that is simply
    // not in the opinion must NOT be reported as support.
    const v = verifyProposal(brown, {
      proposedSpan: "The Court held that segregated schools violate the Eighth Amendment.",
      selfReportedConfidence: 0.99,
    });
    expect(v.status).toBe("unsupported");
    expect(v.status).not.toBe("supported");
    // No span, so nothing downstream can deep-link to a quotation that does not exist.
    expect(v.span).toBeUndefined();
    expect(v.reason).toContain("nowhere in the opinion");
  });

  it("describes a PARAPHRASE as drawing on real text, and distinguishes it from invention", () => {
    // The model quoted a genuinely real phrase and built its own sentence around it. Still
    // `unsupported` — a real fragment inside a false sentence is a false sentence — but the reason
    // must say it drew on real text, because that is a prompt problem, not fabrication.
    const embedded =
      "we conclude that in the field of public education the doctrine of separate but equal is dead";
    const v = verifyProposal(brown, { proposedSpan: embedded, selfReportedConfidence: 0.95 });
    expect(v.status).toBe("unsupported");
    expect(v.sharedRunWords).toBeGreaterThanOrEqual(MIN_VERBATIM_RUN_TOKENS);
    expect(v.reason).toMatch(/drew on a genuine passage/i);
    // The run's text must be the OPINION's bytes, not the model's.
    expect(brown).toContain(v.sharedRunText!);
  });

  it("describes outright invention as appearing nowhere, with only incidental overlap", () => {
    const invented = "The Court awarded damages of one hundred thousand dollars to each plaintiff.";
    const v = verifyProposal(brown, { proposedSpan: invented, selfReportedConfidence: 0.99 });
    expect(v.status).toBe("unsupported");
    expect(v.sharedRunWords).toBeLessThan(MIN_VERBATIM_RUN_TOKENS);
    expect(v.reason).toMatch(/appears nowhere in the opinion/i);
  });

  it("separates the two failures, which a SIMILARITY score provably could not", () => {
    // This assertion exists because the first implementation used alignment similarity and
    // `.recon/probe-belt-diagnostics.mjs` measured that it separates NOTHING: a real sentence the
    // model extended scored the same as a full invention, and the ranges overlapped (real
    // 0.791-0.886, fake 0.765-0.825). The longest-run measure is what replaced it.
    const embedded =
      "we conclude that in the field of public education the doctrine of separate but equal is dead";
    const invented = "The Court awarded damages of one hundred thousand dollars to each plaintiff.";
    const a = verifyProposal(brown, { proposedSpan: embedded, selfReportedConfidence: 0.9 });
    const b = verifyProposal(brown, { proposedSpan: invented, selfReportedConfidence: 0.9 });
    expect(a.sharedRunWords!).toBeGreaterThan(b.sharedRunWords!);

    // And the dead-code half: the old "close resemblance" branch triggered at the fuzzy floor, but
    // NO realistic rejection reaches it — the matcher returns null for all of these. So that branch
    // could never have run, which is why it was removed rather than tuned.
    for (const span of [embedded, invented, "Separate schools for different races are fundamentally unequal."]) {
      expect(findBestMatch(brown, span), "a realistic rejection unexpectedly cleared the fuzzy floor").toBeNull();
    }
  });

  it("is NOT swayed by the model's self-reported confidence", () => {
    // The anti-requirement, asserted explicitly. If confidence could produce `supported`, the model
    // would be back in charge of the verdict, which is the one thing this design cannot allow.
    const fabricated = "The Court awarded damages of one hundred thousand dollars to each plaintiff.";
    const low = verifyProposal(brown, { proposedSpan: fabricated, selfReportedConfidence: 0.0 });
    const high = verifyProposal(brown, { proposedSpan: fabricated, selfReportedConfidence: 1.0 });
    expect(low.status).toBe("unsupported");
    expect(high.status).toBe("unsupported");
    // And a real span passes regardless of a low confidence.
    const honestButUnsure = verifyProposal(brown, { proposedSpan: HOLDING, selfReportedConfidence: 0.01 });
    expect(honestButUnsure.status).toBe("supported");
  });

  it("treats a span from a DIFFERENT opinion as unsupported (cross-case leakage)", () => {
    const anderson = JSON.parse(
      readFileSync(join(root, "fixtures/corpus/us-477-0242-01.json"), "utf8"),
    ).text as string;

    // This sentence is taken from the Anderson fixture, NOT written from memory. The first version
    // of this test used a Rule 56(c) sentence reproduced from recollection, and it was not in the
    // opinion at all — the test failed on its own setup rather than on the behaviour, which is the
    // same from-memory-quote trap that produced a bogus probe reading in Phase 4 (§7). Extract the
    // control from the bytes and assert the extraction succeeded.
    const andersonSentence = "the requirement is that there be no genuine issue of material fact";
    expect(anderson.replace(/\s+/g, " ")).toContain(andersonSentence);
    // And it must genuinely NOT be in Brown, or the test would prove nothing.
    expect(brown.replace(/\s+/g, " ")).not.toContain(andersonSentence);

    const v = verifyProposal(brown, { proposedSpan: andersonSentence, selfReportedConfidence: 0.9 });
    expect(v.status).toBe("unsupported");
  });

  it("never reports supported for an empty or whitespace-only span", () => {
    for (const s of ["", "   ", "\n\t "]) {
      const v = verifyProposal(brown, { proposedSpan: s, selfReportedConfidence: 0.9 });
      expect(v.status).toBe("declined");
      expect(v.span).toBeUndefined();
    }
  });

  it("never reports supported when there is no proposal at all", () => {
    const v = verifyProposal(brown, null);
    expect(v.status).toBe("declined");
  });
});

describe("self-verify: the no-key path is the floor, and it always audits", () => {
  it("reports the belt unconfigured without throwing", async () => {
    const config = beltConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(config).toBeNull();
    expect(beltAvailable({} as NodeJS.ProcessEnv)).toBe(false);
    expect(beltMode({} as NodeJS.ProcessEnv)).toBe("deterministic-only");

    const result = await proposeAndVerify(brown, "anything", config);
    expect(result.verification.status).toBe("unavailable");
    expect(result.verification.status).not.toBe("supported");
    expect(result.verification.reason).toContain("did not run");
  });

  it("does not even attempt a request with no key", async () => {
    // A fetch that fails the test if called: with no key there must be NO network activity at all.
    const result = await proposeSupportingSpan(brown, "p", null, {
      fetchImpl: (async () => {
        throw new Error("the belt must not reach the network without a key");
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("unavailable");
    expect(result.detail).toContain("not set");
  });

  it("distinguishes an unconfigured belt from a model that declined", async () => {
    // "We never asked" must never read as "the model found nothing". Different facts, different
    // statuses, and the attempt log has to tell them apart.
    const unavailable = await proposeAndVerify(brown, "p", null);
    expect(unavailable.verification.status).toBe("unavailable");

    const declining = verifyAttempt(brown, {
      ...baseAttempt(),
      status: "declined",
      proposal: null,
      detail: "the model returned an empty span",
    });
    expect(declining.status).toBe("declined");
    expect(unavailable.verification.status).not.toBe(declining.status);
  });

  it("degrades rather than throwing when the request fails, times out, or returns junk", async () => {
    const config = { apiKey: "sk-test-not-real", seed: 1, temperature: 0, model: "m" };

    const httpFail = await proposeAndVerify(brown, "p", config, {
      fetchImpl: (async () => new Response("upstream exploded", { status: 502 })) as unknown as typeof fetch,
    });
    expect(httpFail.verification.status).toBe("unavailable");
    expect(httpFail.attempt.detail).toContain("http");

    const networkFail = await proposeAndVerify(brown, "p", config, {
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(networkFail.verification.status).toBe("unavailable");
    expect(networkFail.attempt.detail).toContain("network");

    const badJson = await proposeAndVerify(brown, "p", config, {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "I think the answer is the holding." } }] }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    expect(badJson.verification.status).toBe("unavailable");
    expect(badJson.attempt.detail).toContain("bad-payload");
  });
});

describe("self-verify: a stubbed model response, end to end through the client", () => {
  /** A stub that answers like OpenRouter, with the content we choose. */
  function stub(content: string, status = 200, extra: Record<string, unknown> = {}) {
    const counter = { calls: 0 };
    const bodies: string[] = [];
    const impl = (async (_url: string, init: { body: string }) => {
      counter.calls++;
      bodies.push(init.body);
      return new Response(
        JSON.stringify({
          id: "gen-test-1",
          model: "google/gemini-2.5-flash",
          provider: "Google",
          choices: [{ message: { content }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 6126,
            completion_tokens: 41,
            total_tokens: 6167,
            cost: 0.001884,
            prompt_tokens_details: { cached_tokens: 0 },
          },
          ...extra,
        }),
        { status },
      );
    }) as unknown as typeof fetch;
    return { impl, counter, bodies };
  }

  // Built through beltConfigFromEnv with a fake env, so this exercises the REAL default config —
  // including provider pinning — rather than a hand-written object that could drift from it.
  const config = beltConfigFromEnv({
    OPENROUTER_API_KEY: "sk-test-not-real",
  } as unknown as NodeJS.ProcessEnv)!;

  it("catches a stubbed FABRICATED span", async () => {
    const { impl } = stub(JSON.stringify({ proposedSpan: "Segregation was upheld by a unanimous Court.", selfReportedConfidence: 0.97 }));
    const result = await proposeAndVerify(brown, "segregation is unlawful", config, { fetchImpl: impl });
    expect(result.attempt.status).toBe("proposed");
    expect(result.verification.status).toBe("unsupported");
  });

  it("accepts a stubbed REAL span", async () => {
    const { impl } = stub(JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.88 }));
    const result = await proposeAndVerify(brown, "segregation is unlawful", config, { fetchImpl: impl });
    expect(result.verification.status).toBe("supported");
    expect(brown.slice(result.verification.span!.start, result.verification.span!.end)).toBe(HOLDING);
  });

  it("records the seed, prompt version, provider and cost on the attempt", async () => {
    const { impl } = stub(JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.9 }));
    const result = await proposeAndVerify(brown, "p", config, { fetchImpl: impl });
    expect(result.attempt.seed).toBe(DEFAULT_SEED);
    expect(result.attempt.promptVersion).toBe(PROMPT_VERSION);
    expect(result.attempt.provider).toBe("Google");
    expect(result.attempt.model).toBe("google/gemini-2.5-flash");
    expect(result.attempt.usage?.costUsd).toBeCloseTo(0.001884, 6);
    expect(result.attempt.usage?.promptTokens).toBe(6126);
    expect(result.attempt.generationId).toBe("gen-test-1");
  });

  it("carries NO cost rather than a guess when the response omits it", async () => {
    // A fabricated cost in a demo budget is a lie about money, so a missing cost stays null.
    const { impl } = stub(JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.9 }), 200, {
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });
    const result = await proposeAndVerify(brown, "p", config, { fetchImpl: impl });
    expect(result.attempt.usage?.costUsd).toBeNull();
    expect(summarise([result]).costUsd).toBeNull();
  });

  it("sends a byte-identical request for identical inputs, with the seed and provider pinned", async () => {
    // The part of "identical seed ⇒ identical output" that this repo controls. A body that varied
    // between runs would defeat the seed no matter what the model did.
    const { impl, bodies } = stub(JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.9 }));
    await proposeAndVerify(brown, "same proposition", config, { fetchImpl: impl });
    await proposeAndVerify(brown, "same proposition", config, { fetchImpl: impl });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);

    const parsed = JSON.parse(bodies[0]);
    expect(parsed.seed).toBe(DEFAULT_SEED);
    expect(parsed.temperature).toBe(0);
    // Provider pinning is not decoration: seed is per-provider and OpenRouter load-balances.
    expect(parsed.provider).toEqual({ order: ["Google"], allow_fallbacks: false });
    expect(parsed.response_format.type).toBe("json_schema");
    expect(parsed.response_format.json_schema.strict).toBe(true);
  });

  it("omits provider pinning when explicitly configured to route freely", async () => {
    const { impl, bodies } = stub(JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.9 }));
    await proposeAndVerify(brown, "p", { ...config, pinProvider: undefined }, { fetchImpl: impl });
    expect(JSON.parse(bodies[0]).provider).toBeUndefined();
  });

  it("surfaces the model's honest DECLINE as declined, not as support and not as an error", async () => {
    const { impl } = stub(JSON.stringify({ proposedSpan: "", selfReportedConfidence: 0 }));
    const result = await proposeAndVerify(brown, "the Seventh Amendment guarantees a jury trial", config, {
      fetchImpl: impl,
    });
    expect(result.attempt.status).toBe("declined");
    expect(result.verification.status).toBe("declined");
    // The reason must be careful: a decline is not evidence the proposition is unsupported.
    expect(result.verification.reason).toMatch(/not evidence/i);
  });
});

describe("self-verify: the key never leaves the server", () => {
  const SECRET = "sk-or-v1-THIS-IS-A-CANARY-NEVER-COMMIT-ME";

  it("redacts the key in any fingerprint it reports", () => {
    const redacted = redactKey(SECRET);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain("chars");
    // A short prefix is deliberate — enough to tell WHICH key ran, useless as a credential.
    expect(redacted.slice(0, 6)).toBe("sk-or-");
    expect(redactKey(undefined)).toBe("(absent)");
  });

  it("does not put the key in the attempt or any error message", async () => {
    const failingFetch = (async () => new Response(`error echoing ${SECRET}`, { status: 500 })) as unknown as typeof fetch;
    const result = await proposeAndVerify(brown, "p", { apiKey: SECRET, seed: 1, temperature: 0, model: "m" }, {
      fetchImpl: failingFetch,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    // The fingerprint is the only trace, and it is not usable.
    expect(result.attempt.keyFingerprint).toContain("chars");
    expect(result.attempt.detail).toContain("http");
  });

  it("does not leak the key into a redaction-failure path", async () => {
    // A 200 whose body is junk must not echo the Authorization header either.
    const junkFetch = (async () => new Response("not json at all " + SECRET, { status: 200 })) as unknown as typeof fetch;
    const result = await proposeAndVerify(brown, "p", { apiKey: SECRET, seed: 1, temperature: 0, model: "m" }, {
      fetchImpl: junkFetch,
    });
    expect(result.verification.status).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("scrubs the key out of arbitrary response text", () => {
    // The mechanism behind the two tests above. A response body is untrusted text that can contain
    // the key if any hop echoes the request, and it must be neutralised before it reaches `detail`.
    expect(scrubKey(`upstream error near ${SECRET}`, SECRET)).not.toContain(SECRET);
    // A Bearer-prefixed echo survives a naive bare-key replacement, so it is handled explicitly.
    expect(scrubKey(`Authorization: Bearer ${SECRET}`, SECRET)).not.toContain(SECRET);
    // A truncated/abbreviated echo of the tail is neutralised too.
    expect(scrubKey(`key ending ${SECRET.slice(-8)}`, SECRET)).not.toContain(SECRET.slice(-8));
    // And a key present multiple times is removed everywhere, not once.
    expect(scrubKey(`${SECRET} and again ${SECRET}`, SECRET)).not.toContain(SECRET);
    // Text without the key is untouched.
    expect(scrubKey("plain error", SECRET)).toBe("plain error");
    expect(scrubKey("anything", undefined)).toBe("anything");
  });

  it("has no NEXT_PUBLIC variable that could carry the key to the browser", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_[A-Z_]*OPENROUTER/);
    expect(example).not.toMatch(/NEXT_PUBLIC_[A-Z_]*API_KEY/);
    // And the real key must never be committed: only the example is tracked.
    expect(existsSync(join(root, ".env.example"))).toBe(true);
  });

  it("is NOT imported by any client component", () => {
    // The structural half of the bundle guarantee: `lib/llm` reads a server env var at call time, so
    // a client import would either inline the key or break at runtime. Catch it at the source.
    const clientFiles = collectFiles(join(root, "app")).filter((f) => {
      const src = readFileSync(f, "utf8");
      return /^["']use client["']/m.test(src.slice(0, 400));
    });
    for (const f of clientFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} is a client component and must not import the belt`).not.toMatch(/from\s+["'][^"']*\/llm/);
    }
  });

  it("greps the BUILT client bundle for the key when a build exists", () => {
    // The acceptance criterion, verbatim: assert by grepping the built client output for the key.
    //
    // The key is resolved the way Next.js resolves it — from the environment, falling back to .env
    // (which vitest does not load on its own). If a .next build exists and any key is available,
    // this MUST actually grep; a skipped security check that reads as green is worse than no check,
    // so the only skip path is a missing build, and it says so loudly.
    const staticDir = join(root, ".next", "static");
    if (!existsSync(staticDir)) {
      console.warn(
        "\n  [selfverify] SKIPPED bundle grep: .next/static does not exist.\n" +
          "  Run `npm run build` and re-run to actually verify the key is absent from the client bundle.\n",
      );
      return;
    }

    const key = resolveKeyForBundleGrep();
    if (!key) {
      // A build with no key configured is a legitimate state — and then there is nothing to leak.
      console.warn(
        "\n  [selfverify] bundle grep found no key to search for (no OPENROUTER_API_KEY in the\n" +
          "  environment or .env), so the check is vacuous for this build.\n",
      );
      return;
    }

    const files = collectFiles(staticDir);
    expect(files.length, "no client bundle files found to grep").toBeGreaterThan(0);

    // TWO checks, because the key grep alone can pass vacuously.
    //
    // The bundle is built from whatever imported what at build time. Until Phase 7 wires the belt
    // into a page, no belt code is in the client bundle at all — so "the key is absent" would be
    // true for the uninteresting reason that nothing belt-shaped is there. The second check greps
    // for the module's own fingerprints, which catches a leak of the belt into the client even when
    // no key happens to be configured.
    const rawFiles = files.map((f) => ({ path: f, text: readFileSync(f, "utf8") }));

    const keyOffenders = rawFiles.filter((f) => f.text.includes(key)).map((f) => f.path);
    expect(keyOffenders, `the API key leaked into the client bundle: ${keyOffenders.join(", ")}`).toEqual([]);

    // Server-only fingerprints. Any of these in a client chunk means lib/llm was bundled for the
    // browser, which would either inline configuration or break at runtime.
    const FINGERPRINTS = [
      "OPENROUTER_API_KEY",
      "openrouter.ai/api/v1",
      "extract verbatim quotations from judicial opinions",
    ];
    for (const fingerprint of FINGERPRINTS) {
      const offenders = rawFiles.filter((f) => f.text.includes(fingerprint)).map((f) => f.path);
      expect(
        offenders,
        `the server-only belt leaked into the client bundle (found ${JSON.stringify(fingerprint)}): ${offenders.join(", ")}`,
      ).toEqual([]);
    }
  });
});

describe("self-verify: the belt is advisory and cannot change a verdict", () => {
  it("is not an input to the verdict layer at all", () => {
    // Structural guarantee, stronger than a behavioural test: the deterministic verdict path does
    // not import the belt, so no belt result can move a verdict. A proposition can be unsupported
    // while the citation is VERIFIED, and vice versa — they answer different questions.
    const verdictDir = join(root, "lib", "verdict");
    for (const f of collectFiles(verdictDir)) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} must not depend on the belt`).not.toMatch(/from\s+["'][^"']*llm/);
    }
  });

  it("summarises a run without inventing numbers", async () => {
    const config = { apiKey: "sk-test", seed: 1, temperature: 0, model: "m" };
    const ok = await proposeAndVerify(brown, "p1", config, {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ proposedSpan: HOLDING, selfReportedConfidence: 0.9 }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.002 },
            provider: "Google",
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const miss = await proposeAndVerify(brown, "p2", config, {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ proposedSpan: "nothing like this appears", selfReportedConfidence: 0.9 }) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.001 },
            provider: "Google",
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const none = await proposeAndVerify(brown, "p3", null);

    const s = summarise([ok, miss, none]);
    expect(s.total).toBe(3);
    expect(s.supported).toBe(1);
    expect(s.unsupported).toBe(1);
    expect(s.unavailable).toBe(1);
    expect(s.costUsd).toBeCloseTo(0.003, 6);
    expect(s.providers).toEqual(["Google"]);
  });
});

describe("self-verify: live determinism, opt-in", () => {
  /**
   * The acceptance criterion "identical seed ⇒ identical output across runs", against the real API.
   *
   * Opt-in because it costs money and needs a key, and because a deterministic unit test must not
   * silently become a network test. Run it deliberately:
   *
   *   RUN_LIVE_BELT=1 npx vitest run tests/selfverify.test.ts
   *
   * Measured 2026-09-23 with this exact check: 5/5 identical live requests returned byte-identical
   * output, all served by Google. Recorded in docs/LIMITS.md §14.
   */
  const live = process.env.RUN_LIVE_BELT === "1" ? it : it.skip;

  live("returns byte-identical output for identical requests", async () => {
    const config = beltConfigFromEnv();
    expect(config, "RUN_LIVE_BELT=1 but no OPENROUTER_API_KEY").not.toBeNull();

    const a = await proposeAndVerify(brown, "Racial segregation in public education is unconstitutional.", config);
    const b = await proposeAndVerify(brown, "Racial segregation in public education is unconstitutional.", config);

    expect(a.attempt.status).toBe("proposed");
    expect(b.attempt.status).toBe("proposed");
    expect(a.attempt.proposal!.proposedSpan).toBe(b.attempt.proposal!.proposedSpan);
    // And both were served by the pinned provider, which is what makes that repeatable.
    expect(a.attempt.provider).toBe(b.attempt.provider);
    // Report the cost actually incurred rather than asserting a number that would rot.
    console.log(
      `  [live] provider=${a.attempt.provider} cost=$${(
        (a.attempt.usage?.costUsd ?? 0) + (b.attempt.usage?.costUsd ?? 0)
      ).toFixed(6)}`,
    );
  }, 60_000);
});

/** Every file under a directory, recursively. */
function collectFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * Find the key the way Next.js would, for the bundle grep.
 *
 * vitest does not load `.env`, and Next.js does, so a test that only checked `process.env` would
 * silently skip the one check that proves the key stays server-side. `.env` is gitignored; this
 * reads it locally and never writes the value anywhere.
 */
function resolveKeyForBundleGrep(): string | null {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq).trim() === "OPENROUTER_API_KEY") {
      const value = trimmed.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

/** A minimal attempt, for tests that only care about one field. */
function baseAttempt(): PropositionAttempt {
  return {
    proposition: "p",
    proposal: null,
    status: "unavailable",
    detail: "",
    promptVersion: PROMPT_VERSION,
    seed: null,
    model: null,
    provider: null,
    usage: null,
    latencyMs: null,
    generationId: null,
    keyFingerprint: "(absent)",
  };
}
