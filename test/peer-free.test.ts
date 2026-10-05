import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PEER_RANGE } from "../src/plugin.js";

/**
 * `@xano/sdk` is a peer, and this module owes it nothing at runtime: the
 * renderer turns the SDK's input description into text. So exactly one file,
 * `src/plugin.ts`, may name the peer, and only through `import type`, which
 * the build erases. Asserted against the source because an import that tsup
 * marks external leaves no trace a bundle test could see.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const PEER_ALLOWED = "plugin.ts";
const PEER_REF = /["']@xano\/sdk(?:\/[^"']*)?["']/;

function tsFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsFiles(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

describe("the peer is types-only", () => {
  it("names @xano/sdk in no src file but plugin.ts", () => {
    const offenders = tsFiles(SRC).filter((rel) => rel !== PEER_ALLOWED && PEER_REF.test(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("reaches @xano/sdk from plugin.ts only through `import type`", () => {
    const text = readFileSync(join(SRC, PEER_ALLOWED), "utf8");
    // Every static import or re-export of the peer, however it is spread over lines.
    const statements = [...text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*["']@xano\/sdk(?:\/[^"']*)?["']/gm)].map((m) => m[0]);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s).toMatch(/^import type \{/);
    // A dynamic import or require would slip past the line check above.
    expect(text).not.toMatch(/(?:import|require)\s*\(\s*["']@xano\/sdk/);
  });

  it("covers the src tree, not an empty list", () => {
    expect(tsFiles(SRC)).toContain(PEER_ALLOWED);
  });
});

describe("the peer range", () => {
  it("PEER_RANGE matches package.json's peerDependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      peerDependencies: Record<string, string>;
    };
    expect(pkg.peerDependencies["@xano/sdk"]).toBe(PEER_RANGE);
  });
});
