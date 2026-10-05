/**
 * The installed SDK's own `routes.gen.ts` pipeline, reached for the suites that
 * need a REAL emitted file: payload → plan → core manifest → composed with this
 * module's section, exactly as the SDK composes it.
 *
 * The pipeline (`planRouteManifest`, `renderPlannedManifest`,
 * `composeRoutesManifest`) is not on any published subpath, and the CLI's
 * `routes --emit` does not fire module sections in the build under test, so the
 * module that defines them is located inside the installed `dist/` by what it
 * exports rather than by its hashed file name. A dist with no such module fails
 * here, by name, instead of letting a suite pass on a hand-rolled composition.
 */
import { readdirSync } from "node:fs";
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

async function pipeline(): Promise<Pipeline> {
  cached ??= (async () => {
    for (const file of readdirSync(SDK_DIST).filter((f) => /^routes-manifest-[\w-]+\.js$/.test(f))) {
      const mod = (await import(pathToFileURL(join(SDK_DIST, file)).href)) as Partial<Pipeline>;
      if (
        typeof mod.planRouteManifest === "function" &&
        typeof mod.renderPlannedManifest === "function" &&
        typeof mod.composeRoutesManifest === "function"
      ) {
        return mod as Pipeline;
      }
    }
    throw new Error(`No routes-manifest module exporting the planner and composer in ${SDK_DIST}.`);
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
