import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // `@/*` is a tsconfig path. Next resolves it; Vite does not, so without this a test that
    // imports a module using the alias fails to resolve — and the failure looks like a missing
    // file rather than a missing alias.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The corpus layer talks to static.case.law. Tests must never depend on that:
    // Phase 1 caches into fixtures/corpus/ and the tests read the cache, so the suite
    // is deterministic and passes offline. Any test needing the network belongs in
    // .recon/, not here.
    //
    // EXCEPTION, and it is deliberate: `tests/selfverify.test.ts` and `tests/belt-record.test.ts`
    // each hold one `RUN_LIVE_BELT=1` case that is skipped by default. Both need the real API to
    // mean anything, and the recorder writes `fixtures/belt-run.json` from a live run.
    globals: false,
    // The 5s default is too tight here. The true-home scan walks every cached opinion (~60KB each)
    // per item, and on a 4GB dev machine with little free memory that exceeded 5s under parallel
    // workers — one run produced four spurious timeout failures, the next produced none. This is a
    // hang detector, not a performance target: the whole suite runs in ~17s.
    testTimeout: 30_000,
  },
});
