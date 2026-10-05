/**
 * The emitted schemas at runtime, loaded from the real composed file: they
 * accept what the server accepts, reject what it rejects, and never change the
 * value they pass.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { emittedRoutesFile, scratchDir, writeFiles } from "./helpers/emitted.js";

interface Schema {
  parse(value: unknown): unknown;
  safeParse(value: unknown): { success: boolean; data?: unknown; error?: { issues: { message: string; path: PropertyKey[] }[] } };
}
interface Manifest {
  ROUTE_SCHEMAS: Record<string, Schema>;
  CHANNEL_SCHEMAS: Record<string, Schema>;
  MESSAGE_SCHEMAS: Record<string, Schema>;
}

let m: Manifest;
let dir: string | undefined;

beforeAll(async () => {
  const { code } = await transform(await emittedRoutesFile(), { loader: "ts", format: "esm", target: "es2022" });
  dir = writeFiles(scratchDir("emit-runtime"), { "routes.gen.mjs": code });
  m = (await import(pathToFileURL(join(dir, "routes.gen.mjs")).href)) as Manifest;
});

afterAll(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

const route = (key: string): Schema => m.ROUTE_SCHEMAS[key]!;
const messages = (schema: Schema, value: unknown): string[] =>
  schema.safeParse(value).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];

describe("ROUTE_SCHEMAS", () => {
  const valid = { handle: "@abc", secret: "Passw0rd", qty: 2 };

  it("accepts a valid payload and returns it unchanged", () => {
    const body = { ...valid, code: " ab ", tags: ["a", "bb"], ratio: 0.5 };
    expect(route("POST validated").parse(body)).toEqual(body);
  });

  it("rejects a missing required field", () => {
    const { handle: _handle, ...rest } = valid;
    expect(route("POST validated").safeParse(rest).success).toBe(false);
  });

  it("rejects a value outside the enum", () => {
    expect(route("POST signup").safeParse({ name: "a", age: 1, plan: "gold" }).success).toBe(false);
    expect(route("POST signup").safeParse({ name: "a", age: 1, plan: "pro" }).success).toBe(true);
  });

  it("rejects an over-length string, measured as the engine measures it", () => {
    expect(messages(route("POST validated"), { ...valid, handle: "@abcdefghij" })).toEqual([
      "handle: Input does not meet maximum length requirement of 8 characters",
    ]);
    // The engine trims before measuring: padding does not count against max.
    expect(route("POST validated").safeParse({ ...valid, handle: "  @abcdefg  " }).success).toBe(true);
  });

  it("checks a pattern against the case-folded value the engine checks, without folding the value", () => {
    expect(route("POST validated").parse({ ...valid, code: "ab" })).toEqual({ ...valid, code: "ab" });
    expect(messages(route("POST validated"), { ...valid, code: "a1" })).toEqual(["code: Invalid pattern."]);
  });

  it("applies the whitelist, startsWith, numeric bounds, list bounds and password policy", () => {
    const schema = route("POST validated");
    expect(messages(schema, { ...valid, pin: "12a" })).toEqual(["pin: Invalid characters detected."]);
    expect(messages(schema, { ...valid, handle: "abc" })).toEqual(["handle: Invalid format detected. Expected @"]);
    expect(schema.safeParse({ ...valid, qty: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, qty: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, tags: [] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, tags: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(schema.safeParse({ ...valid, tags: ["toolong"] }).success).toBe(false);
    expect(messages(schema, { ...valid, secret: "password1" })).toEqual([
      "secret: Weak password detected. Please use at least 1 uppercase letters.",
    ]);
  });

  it("parses a dbLink body carrying the expanded columns without stripping a key", () => {
    const body = {
      name: "Ada",
      age: 36,
      avatar: { path: "/a.png", name: "a.png", type: "image", size: 10, meta: { width: 1 } },
      prefs: { theme: "dark", beta: true },
      plan: "free",
    };
    expect(route("POST signup").parse(body)).toEqual(body);
  });

  it("accepts a body that omits an optional key named after an Object.prototype member", () => {
    const body = {
      text: "t",
      text_default: "d",
      bool: null,
      timestamp: 1,
      image: null,
      status: "draft",
      doc: "00000000-0000-0000-0000-000000000000",
      address: { street: "Main" },
      valueOf: "v",
    };
    expect(route("POST scalars").safeParse(body).success).toBe(true);
    expect(route("POST scalars").safeParse({ ...body, toString: 3 }).success).toBe(false);
  });

  it("accepts the email the engine accepts, including empty, and rejects a malformed one", () => {
    const body = { text: ["a"] };
    expect(route("POST lists").safeParse({ ...body, email: ["a@b.co", ""] }).success).toBe(true);
    expect(route("POST lists").safeParse({ ...body, email: ["not an email"] }).success).toBe(false);
  });
});

describe("CHANNEL_SCHEMAS and MESSAGE_SCHEMAS", () => {
  it("validates a channel's path params", () => {
    expect(m.CHANNEL_SCHEMAS["rooms/{room_id}"]!.safeParse({ room_id: 1 }).success).toBe(true);
    expect(m.CHANNEL_SCHEMAS["rooms/{room_id}"]!.safeParse({ room_id: "1" }).success).toBe(false);
    expect(m.CHANNEL_SCHEMAS["lobby"]!.safeParse({}).success).toBe(true);
  });

  it('validates the "rooms/{room_id} send" payload', () => {
    const send = m.MESSAGE_SCHEMAS["rooms/{room_id} send"]!;
    expect(send.safeParse({ body: "hi" }).success).toBe(true);
    expect(send.safeParse({ body: "hi", attachments: null }).success).toBe(true);
    expect(send.safeParse({ body: "hi", attachments: [{ path: "/x.png" }] }).success).toBe(true);
    expect(send.safeParse({}).success).toBe(false);
    expect(send.safeParse({ body: 1 }).success).toBe(false);
  });
});
