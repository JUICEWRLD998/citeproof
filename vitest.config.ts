import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The corpus layer talks to static.case.law. Tests must never depend on that:
    // Phase 1 caches into fixtures/corpus/ and the tests read the cache, so the suite
    // is deterministic and passes offline. Any test needing the network belongs in
    // .recon/, not here.
    globals: false,
  },
});
