/**
 * The emitted file under a real `tsc`, with real zod: the check this module
 * emits is the only thing standing between a schema that disagrees with its
 * core type and a user's frontend, so it is proven three ways — the full file
 * compiles, a schema too strict for its type fails, and a schema that drops an
 * optional key fails (the check is two-way, which `satisfies` is not).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, emittedRoutesFile, scratchDir, writeFiles } from "./helpers/emitted.js";

let file: string;
const dirs: string[] = [];

beforeAll(async () => {
  file = await emittedRoutesFile();
});

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Run tsc over `source` as `routes.gen.ts`; the diagnostics, one per line ("" when clean). */
function tsc(source: string, exactOptionalPropertyTypes: boolean): string {
  const dir = scratchDir("emit-tsc");
  dirs.push(dir);
  writeFiles(dir, {
    "routes.gen.ts": source,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        types: [],
        strict: true,
        exactOptionalPropertyTypes,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noImplicitReturns: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
        noEmit: true,
      },
      files: ["routes.gen.ts"],
    }),
  });
  const result = spawnSync(join(ROOT, "node_modules/.bin/tsc"), ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], {
    encoding: "utf8",
  });
  return `${result.stdout}${result.stderr}`.trim();
}

/** The source lines the diagnostics point at. */
function failingLines(source: string, diagnostics: string): string[] {
  const lines = source.split("\n");
  return [...diagnostics.matchAll(/routes\.gen\.ts\((\d+),\d+\): error/g)].map((m) => lines[Number(m[1]) - 1]!.trim());
}

/** `file` with exactly one occurrence of `from` replaced by `to`. */
function mutate(from: string, to: string): string {
  expect(file.split(from)).toHaveLength(2);
  return file.replace(from, to);
}

describe.each([true, false])("the emitted routes.gen.ts with exactOptionalPropertyTypes: %s", (exact) => {
  it("compiles, every entry's check holding", () => {
    expect(tsc(file, exact)).toBe("");
  });

  it("fails on the one entry whose schema is too strict for its type", () => {
    const source = mutate("    qty: z.int().min(1).max(10),\n", "    qty: z.literal(1),\n");
    const diagnostics = tsc(source, exact);
    expect(failingLines(source, diagnostics)).toEqual([
      '__ZodExpect<"POST validated", __ZodSame<z.output<(typeof ROUTE_SCHEMAS)["POST validated"]>, RouteInputs["POST validated"]>>,',
    ]);
  });

  it("fails on the one entry whose schema has the wrong type on a key", () => {
    const source = mutate("    room_id: z.int(),\n", "    room_id: z.string(),\n");
    expect(failingLines(source, tsc(source, exact))).toEqual([
      '__ZodExpect<"rooms/{room_id}", __ZodSame<z.output<(typeof CHANNEL_SCHEMAS)["rooms/{room_id}"]>, ChannelInputs["rooms/{room_id}"]>>,',
    ]);
  });

  it("fails on the one entry whose schema omits an optional key — the check is two-way", () => {
    const source = mutate("    ratio: z.number().min(0).max(1).optional(),\n", "");
    expect(failingLines(source, tsc(source, exact))).toEqual([
      '__ZodExpect<"POST validated", __ZodSame<z.output<(typeof ROUTE_SCHEMAS)["POST validated"]>, RouteInputs["POST validated"]>>,',
    ]);
  });

  it("fails when a schema makes a required key optional", () => {
    const source = mutate('    body: z.string().check(__zodRequired("body")),\n', '    body: z.string().check(__zodRequired("body")).optional(),\n');
    expect(failingLines(source, tsc(source, exact))).toEqual([
      '__ZodExpect<"rooms/{room_id} send", __ZodSame<z.output<(typeof MESSAGE_SCHEMAS)["rooms/{room_id} send"]>, MessageInputs["rooms/{room_id} send"]>>,',
    ]);
  });
});

describe("the emitted file's shape", () => {
  it("carries the module block after the core sections, with zod imported at the top", () => {
    const header = file.indexOf(" */\n") + 4;
    expect(file.slice(header).startsWith('import { z } from "zod";\n')).toBe(true);
    expect(file.match(/^import /gm)).toHaveLength(1);
    expect(file.indexOf("// xanosdk:begin @xano-sdk/zod")).toBeGreaterThan(file.indexOf("export type MessageName"));
  });

  it("has a schema for every key of every core map", () => {
    for (const key of ['"POST scalars"', '"POST lists"', '"POST signup"', '"v1:GET vehicles"', '"GET nothing"']) {
      expect(file).toContain(`__ZodExpect<${key}, __ZodSame<z.output<(typeof ROUTE_SCHEMAS)[${key}]>`);
    }
    expect(file).toContain('__ZodExpect<"lobby", ');
    expect(file).toContain('__ZodExpect<"lobby ping", ');
  });
});
