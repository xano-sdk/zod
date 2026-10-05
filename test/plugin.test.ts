import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import plugin, { assertSdkVersion } from "../src/plugin.js";
import { renderZodSection } from "../src/render.js";
import type { RouteInputs } from "@xano/sdk/plugin";

describe("the toolchain plugin", () => {
  it("default-exports a toolchain plugin whose kind matches the manifest", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      xanosdk: { kind: string; plugin: string };
    };
    expect(plugin.kind).toBe("toolchain");
    expect(pkg.xanosdk).toEqual({ kind: plugin.kind, plugin: "./dist/plugin.js" });
  });

  it("contributes the enabled config block, the same on every call", () => {
    expect(plugin.contributes?.({})).toEqual({ config: { enabled: true } });
    expect(plugin.contributes?.({ anything: "else" })).toEqual(plugin.contributes?.({}));
  });
});

describe("routesManifest", () => {
  const inputs: RouteInputs = {
    routes: [{ key: "GET a", inputs: [{ name: "n", type: "int", required: true, nullable: false, list: false, methods: [] }] }],
    channels: [],
    messages: [],
  };

  it("returns the rendered section, importing z from zod", () => {
    const section = plugin.routesManifest?.({ inputs, config: { enabled: true }, sdkVersion: "1.0.6" });
    expect(section?.imports).toEqual([{ from: "zod", names: ["z"] }]);
    expect(section).toEqual(renderZodSection(inputs));
  });

  it.each(["1.0.5", "2.0.0"])("refuses SDK %s, outside the peer range, before rendering", (sdkVersion) => {
    expect(() => plugin.routesManifest?.({ inputs, config: {}, sdkVersion })).toThrow(/requires @xano\/sdk >=1\.0\.6 <2\.0\.0/);
  });

  it("asks no questions", () => {
    expect(plugin.questions).toBeUndefined();
  });
});

describe("assertSdkVersion", () => {
  it.each(["1.0.6", "1.0.7", "1.9.99"])("accepts %s", (v) => {
    expect(() => assertSdkVersion(v)).not.toThrow();
  });

  it.each(["1.0.5", "1.0.0", "0.9.0", "2.0.0", "3.1.0"])("refuses %s, naming the range", (v) => {
    expect(() => assertSdkVersion(v)).toThrow(/@xano-sdk\/zod requires @xano\/sdk >=1\.0\.6 <2\.0\.0/);
  });

  it.each(["0.0.0-dev", "1.0.5-beta.1", "not-a-version", ""])("lets %j through (prerelease or unparsable)", (v) => {
    expect(() => assertSdkVersion(v)).not.toThrow();
  });
});
