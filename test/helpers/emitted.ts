/**
 * A real `routes.gen.ts`, as a project with this module installed gets it: the
 * fixture workspace compiled by the installed SDK, planned and rendered by the
 * SDK, and composed with the section this module's PLUGIN returns.
 *
 * Written under `node_modules/.cache/` so that the file's `import { z } from
 * "zod"` resolves to the real zod this repo installs, for tsc, esbuild and
 * Node alike.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import plugin from "../../src/plugin.js";
import { routeInputWorkspace } from "../fixtures/defs.js";
import { compose, planWorkspace, type Exportable } from "./sdk-pipeline.js";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The SDK version handed to the hook: this module's peer floor, the release
 * that ships the hook. The build under test is that release's contents.
 */
export const SDK_VERSION = "1.0.6";

/** The composed `routes.gen.ts` text for `ws`, the fixture workspace by default. */
export async function emittedRoutesFile(ws: Exportable = routeInputWorkspace()): Promise<string> {
  const { inputs, core } = await planWorkspace(ws);
  const section = plugin.routesManifest!({ inputs, config: { enabled: true }, sdkVersion: SDK_VERSION });
  return compose(core, section);
}

/** A fresh directory zod resolves from. The caller removes it. */
export function scratchDir(prefix: string): string {
  const base = join(ROOT, "node_modules", ".cache");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${prefix}-`));
}

/** Write `files` into `dir`, returning `dir`. */
export function writeFiles(dir: string, files: Record<string, string>): string {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
