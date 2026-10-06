import { defineConfig } from "vitest/config";

/**
 * The end-to-end parity suite (`npm run test:e2e`): deploys the fixture under
 * `test/e2e/` to a Xano Engine and compares each emitted schema's verdict with
 * the server's. Kept out of `npm test`, which needs no backend.
 */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 30_000,
    // The first deploy may fetch and start an engine.
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
