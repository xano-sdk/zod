/**
 * The bundle cost: `routes.gen.ts` exists so a frontend can address the backend
 * without a runtime, so a bundle that imports only `routePath` must carry no
 * zod and no schema. Proven with a real esbuild bundle, against a control that
 * does import the schemas, so a check that finds nothing is known to look.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { emittedRoutesFile, scratchDir, writeFiles } from "./helpers/emitted.js";

let dir: string | undefined;

beforeAll(async () => {
  dir = writeFiles(scratchDir("emit-bundle"), {
    "routes.gen.ts": await emittedRoutesFile(),
    "paths-only.ts": 'import { routePath } from "./routes.gen.ts";\nconsole.log(routePath("GET nothing"));\n',
    "schemas.ts": 'import { ROUTE_SCHEMAS } from "./routes.gen.ts";\nconsole.log(ROUTE_SCHEMAS["GET nothing"].parse({}));\n',
  });
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [join(dir!, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    minify: false,
    logLevel: "silent",
  });
  return result.outputFiles[0]!.text;
}

describe("a bundle of the emitted routes.gen.ts", () => {
  it("that imports only routePath contains no zod code and no schema", async () => {
    const text = await bundle("paths-only.ts");
    expect(text).toContain("/api:");
    for (const marker of ["ZodObject", "zod", "ROUTE_SCHEMAS", "__zodText", "z.object"]) {
      expect(text).not.toContain(marker);
    }
  });

  it("that imports the schemas does contain zod (the control)", async () => {
    const text = await bundle("schemas.ts");
    expect(text).toContain("ZodObject");
  });
});
