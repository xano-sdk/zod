/**
 * A backend serving the parity fixture, for the suite to send requests to.
 *
 * `XANO_E2E_HOST` names one that already serves it: a cloud ephemeral, say,
 * deployed with `xanosdk deploy ./xano/index.ts --ephemeral` from the project
 * directory below. Otherwise the fixture is deployed to a Xano Engine on this
 * machine through the installed SDK's own CLI, as a project would deploy it.
 *
 * The CLI's project is the directory holding the entry's nearest package.json,
 * so the fixture is copied into a throwaway project under `node_modules/.cache/`
 * with a package.json of its own: `@xano/sdk` resolves from there to the install
 * this repo tests against, and the engine pin the first deploy writes lands in
 * that package.json rather than this repo's. The directory is stable across
 * runs so a running engine is reused, and the engine is stopped afterwards
 * unless `XANO_E2E_KEEP` is set, because nothing else ever reclaims one.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../../helpers/emitted.js";

export interface Backend {
  /** The origin, with no trailing slash. */
  readonly url: string;
  /** Where it came from, for the report. */
  readonly label: string;
  /** Reclaim what this run started, if anything. */
  stop(): void;
}

const BIN = join(ROOT, "node_modules/@xano/sdk/dist/bin.js");
const FIXTURE = fileURLToPath(new URL("../fixtures/defs.ts", import.meta.url));
const PROJECT = join(ROOT, "node_modules/.cache/e2e-project");

/** A backend serving the fixture: the one named by `XANO_E2E_HOST`, else a local engine deployed now. */
export function startBackend(): Backend {
  const host = process.env.XANO_E2E_HOST;
  if (host !== undefined && host !== "") {
    return { url: host.replace(/\/+$/, ""), label: `XANO_E2E_HOST ${host}`, stop: () => {} };
  }
  const dir = projectDir();
  const deploy = cli(["deploy", "./xano/index.ts", "--lock=./xano/xano.lock", "--local", "--no-dev-env", "--json"], dir);
  if (deploy.status !== 0) {
    throw new Error(`xanosdk deploy --local failed (exit ${deploy.status}).\n${deploy.stderr}${deploy.stdout}`);
  }
  const json = deploy.stdout.slice(deploy.stdout.indexOf("{"));
  const out = JSON.parse(json) as { url: string; engine: { name: string } };
  return {
    url: out.url.replace(/\/+$/, ""),
    label: `Xano Engine ${out.engine.name} at ${out.url}`,
    stop: () => {
      if (process.env.XANO_E2E_KEEP) return;
      cli(["local", "stop", out.engine.name], dir);
    },
  };
}

/** The throwaway project holding a fresh copy of the fixture, as a resolved path (the CLI records projects resolved). */
function projectDir(): string {
  mkdirSync(join(PROJECT, "xano"), { recursive: true });
  try {
    // Written once: the first deploy adds the engine pin to it, which later runs keep.
    writeFileSync(join(PROJECT, "package.json"), `${JSON.stringify({ name: "xano-sdk-zod-e2e", private: true, type: "module" }, null, 2)}\n`, { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  copyFileSync(FIXTURE, join(PROJECT, "xano/index.ts"));
  return realpathSync(PROJECT);
}

function cli(args: readonly string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 540_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
