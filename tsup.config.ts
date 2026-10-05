import { defineConfig } from "tsup";

export default defineConfig({
  // `plugin` is what the SDK's toolchain loader imports; `index` is the direct
  // entry for code and tests that want the renderer without the loader.
  entry: { index: "src/index.ts", plugin: "src/plugin.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  // Both peers resolve from the consumer's install and are never bundled. Matched
  // as patterns so subpath entries (`@xano/sdk/plugin`, `zod/v4`) stay external too.
  external: [/^@xano\/sdk(\/|$)/, /^zod(\/|$)/],
});
