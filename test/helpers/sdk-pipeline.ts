/**
 * The installed SDK's own `routes.gen.ts` pipeline, reached for the suites that
 * need a REAL emitted file: payload → plan → core manifest → composed with this
 * module's section, exactly as the SDK composes it.
 *
 * The pipeline (`planRouteManifest`, `renderPlannedManifest`,
 * `composeRoutesManifest`) is not on any published subpath, and the CLI's
 * `routes --emit` does not fire module sections in the build under test, so each
 * function is located inside the installed `dist/` by the module that defines
 * and exports it, rather than by a hashed file name. The bundler is free to put
 * them in different chunks (1.0.6 splits the composer from the planner), so each
 * is found on its own. A dist missing any of them fails here, by name, instead
 * of letting a suite pass on a hand-rolled composition.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RouteInputs, RoutesManifestSection } from "@xano/sdk/plugin";

interface Pipeline {
  planRouteManifest(payload: Readonly<Record<string, unknown>>): { inputs: RouteInputs };
  renderPlannedManifest(plan: { inputs: RouteInputs }): string | undefined;
  composeRoutesManifest(
    core: string,
    modules: readonly { pkg: string; version: string; section: RoutesManifestSection }[],
  ): string;
}

const require = createRequire(import.meta.url);
const SDK_DIST = dirname(require.resolve("@xano/sdk/package.json")) + "/dist";

let cached: Promise<Pipeline> | undefined;

const NAMES = ["planRouteManifest", "renderPlannedManifest", "composeRoutesManifest"] as const;

async function pipeline(): Promise<Pipeline> {
  cached ??= (async () => {
    // Read the source first so only the modules that define a name get imported:
    // most of `dist/` is CLI commands with no business running here.
    const sources = readdirSync(SDK_DIST)
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ file: join(SDK_DIST, f), text: readFileSync(join(SDK_DIST, f), "utf8") }));
    const found: Partial<Pipeline> = {};
    for (const name of NAMES) {
      const defines = new RegExp(`\\bfunction ${name}\\(`);
      const exports = new RegExp(`\\bexport\\s*\\{[^}]*\\b${name}\\b`);
      for (const { file, text } of sources) {
        if (!defines.test(text) || !exports.test(text)) continue;
        const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
        if (typeof mod[name] === "function") {
          (found as Record<string, unknown>)[name] = mod[name];
          break;
        }
      }
    }
    const missing = NAMES.filter((name) => found[name] === undefined);
    if (missing.length > 0) {
      throw new Error(`No module in ${SDK_DIST} exports ${missing.join(", ")}.`);
    }
    return found as Pipeline;
  })();
  return cached;
}

/** A registry whose `export()` yields the compiled payload, as the SDK's `Xano` does. */
export interface Exportable {
  export(): { payload: unknown };
}

/** The input description and the core manifest the SDK renders for `ws`. */
export async function planWorkspace(ws: Exportable): Promise<{ inputs: RouteInputs; core: string }> {
  const { planRouteManifest, renderPlannedManifest } = await pipeline();
  const plan = planRouteManifest(ws.export().payload as Record<string, unknown>);
  const core = renderPlannedManifest(plan);
  if (core === undefined) throw new Error("The SDK rendered no manifest for this workspace.");
  return { inputs: plan.inputs, core };
}

/** `core` with `section` composed in under this package, as the SDK writes the file. */
export async function compose(core: string, section: RoutesManifestSection): Promise<string> {
  const { composeRoutesManifest } = await pipeline();
  return composeRoutesManifest(core, [{ pkg: "@xano-sdk/zod", version: "1.0.0", section }]);
}
