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

/** A valid "POST scalars" body: every required key, and no optional one. */
const SCALARS = {
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

  it("rejects an over-length string, measured as the engine measures it: raw, unless the input says trim", () => {
    expect(messages(route("POST validated"), { ...valid, handle: "@abcdefghij" })).toEqual([
      "handle: Input does not meet maximum length requirement of 8 characters",
    ]);
    // handle declares no trim: padding counts against max, and the prefix check sees it.
    expect(messages(route("POST validated"), { ...valid, handle: "  @abcdefg  " })).toEqual([
      "handle: Input does not meet maximum length requirement of 8 characters",
      "handle: Invalid format detected. Expected @ but received   @abcdefg  ",
    ]);
    // padded declares trim: the engine trims before measuring, so padding does not count.
    expect(route("POST validated").safeParse({ ...valid, padded: "  @abcdefg  " }).success).toBe(true);
  });

  it("refuses the empty string on a required text, email, password, uuid, date or json input, as the server's missing param", () => {
    expect(messages(route("POST scalars"), { ...SCALARS, text: "" })).toEqual(["text: Missing param: text"]);
    expect(messages(route("POST scalars"), { ...SCALARS, address: { street: "" } })).toEqual(["address.street: Missing param: street"]);
    // The required check runs first: "" on a required text with a minimum is missing, not short.
    expect(messages(route("POST validated"), { ...valid, handle: "" })).toEqual(["handle: Missing param: handle"]);
    // An optional input, and the elements of a list, may be empty.
    expect(route("POST scalars").safeParse({ ...SCALARS, email: "", password: "", uuid: "", date: "", json: "" }).success).toBe(true);
    expect(route("POST lists").safeParse({ text: [""], email: [""], uuid: [""] }).success).toBe(true);
  });

  it("checks a vector's size, as the server does", () => {
    expect(route("POST scalars").safeParse({ ...SCALARS, embedding: [1, 2, 3] }).success).toBe(true);
    expect(route("POST scalars").safeParse({ ...SCALARS, embedding: [1, 2] }).success).toBe(false);
    expect(route("POST scalars").safeParse({ ...SCALARS, embedding: [1, 2, 3, 4] }).success).toBe(false);
    expect(route("POST lists").safeParse({ text: ["a"], embedding: [[1, 2], [3, 4]] }).success).toBe(true);
    expect(route("POST lists").safeParse({ text: ["a"], embedding: [[1]] }).success).toBe(false);
  });

  it("checks a pattern against the case-folded value the engine checks, without folding the value", () => {
    expect(route("POST validated").parse({ ...valid, code: "ab" })).toEqual({ ...valid, code: "ab" });
    expect(messages(route("POST validated"), { ...valid, code: "a1" })).toEqual(["code: Invalid pattern."]);
  });

  it("applies the whitelist, startsWith, numeric bounds, list bounds and password policy", () => {
    const schema = route("POST validated");
    expect(messages(schema, { ...valid, pin: "12a" })).toEqual(["pin: Invalid characters detected."]);
    expect(messages(schema, { ...valid, handle: "abc" })).toEqual(["handle: Invalid format detected. Expected @ but received abc"]);
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
    expect(route("POST scalars").safeParse(SCALARS).success).toBe(true);
    expect(route("POST scalars").safeParse({ ...SCALARS, toString: 3 }).success).toBe(false);
  });

  it("accepts the email the engine accepts, including empty, and rejects a malformed one", () => {
    const body = { text: ["a"] };
    expect(route("POST lists").safeParse({ ...body, email: ["a@b.co", ""] }).success).toBe(true);
    expect(route("POST lists").safeParse({ ...body, email: ["not an email"] }).success).toBe(false);
  });

  it("checks an email trimmed, as the server always trims it, and sends it untrimmed", () => {
    const body = { text: ["a"], email: [" a@b.co ", "\ta@b.co\n", "  "] };
    expect(route("POST lists").parse(body)).toEqual(body);
  });

  it("leaves no own key behind for an absent optional key named after an Object.prototype member", () => {
    const parsed = route("POST scalars").parse(SCALARS) as object;
    expect(Object.hasOwn(parsed, "toString")).toBe(false);
    expect(Object.hasOwn(parsed, "constructor")).toBe(false);
    expect(parsed).toEqual(SCALARS);
    // A key the caller did send is kept.
    expect(route("POST scalars").parse({ ...SCALARS, toString: "s", constructor: 2 })).toEqual({ ...SCALARS, toString: "s", constructor: 2 });
  });

  it("declares an input named __proto__ as an own key of the shape", () => {
    const schema = route("POST proto") as Schema & { shape: object };
    expect(Object.keys(schema.shape)).toEqual(["__proto__", "other"]);
    expect(Object.getPrototypeOf(schema.shape)).toBe(Object.prototype);
    // Whether zod then validates a declared `__proto__` depends on the zod version; the other keys are checked either way.
    expect(schema.safeParse({ other: 1 }).error?.issues.map((i) => i.path)).toContainEqual(["other"]);
  });
});

describe("the text helper, run as the emitted file runs it", () => {
  const valid = { handle: "@abc", secret: "Passw0rd", qty: 2 };
  const schema = (): Schema => route("POST validated");
  const check = (key: string, value: string): string[] => messages(schema(), { ...valid, [key]: value });

  it("reports a short value with the server's minimum-length message, measured trimmed when the input says trim", () => {
    expect(check("handle", "@a")).toEqual(["handle: Input does not meet minimum length requirement of 3 characters"]);
    expect(check("padded", "  @a  ")).toEqual(["padded: Input does not meet minimum length requirement of 3 characters"]);
    // handle declares no trim: the padding is six characters, and the prefix check sees it, as the server reports.
    expect(check("handle", "  @a  ")).toEqual(["handle: Invalid format detected. Expected @ but received   @a  "]);
  });

  it("trims exactly the six characters the server trims: space, tab, newline, carriage return, NUL, vertical tab", () => {
    expect(check("padded", "\0\x0B \t@abcdefg\n\r \0")).toEqual([]);
    // Form feed and a no-break space are not trimmed: they count, and the prefix check sees them.
    expect(check("padded", "\f@abcdefg")).toEqual([
      "padded: Input does not meet maximum length requirement of 8 characters",
      "padded: Invalid format detected. Expected @ but received \f@abcdefg",
    ]);
    expect(check("padded", "\u00A0@abc")).toEqual(["padded: Invalid format detected. Expected @ but received \u00A0@abc"]);
  });

  it("counts characters, not UTF-16 units: an astral character is one", () => {
    expect(check("handle", "@abcdef\u{1F600}")).toEqual([]);
    expect(check("handle", "@abcdefg\u{1F600}")).toEqual(["handle: Input does not meet maximum length requirement of 8 characters"]);
  });

  it("measures a notrim input raw", () => {
    expect(check("raw", "abc")).toEqual([]);
    expect(check("raw", "abc ")).toEqual(["raw: Input does not meet maximum length requirement of 3 characters"]);
  });

  it("reports each missing password class with the server's message", () => {
    expect(check("policy", "12")).toEqual([
      "policy: Weak password detected. Please use at least 1 punctuation symbols, like: $@^&*%^.",
      "policy: Weak password detected. Please use at least 1 lowercase letters.",
      "policy: Weak password detected. Please use at least 2 letters.",
    ]);
    expect(check("policy", "1b!")).toEqual(["policy: Weak password detected. Please use at least 2 letters."]);
    expect(check("policy", "ab!")).toEqual([]);
  });

  it('passes a password of "" or "0" untouched, as the server does before any check — but a required one reads "" as missing', () => {
    expect(schema().parse({ ...valid, policy: "" })).toEqual({ ...valid, policy: "" });
    expect(schema().parse({ ...valid, secret: "0" })).toEqual({ ...valid, secret: "0" });
    expect(check("secret", "")).toEqual(["secret: Missing param: secret"]);
    // Emptiness is judged before trimming: blanks still fail the length check.
    expect(check("secret", "  ")).toContain("secret: Input does not meet minimum length requirement of 8 characters");
  });

  it("blocks a phrase found in the case-folded value, and sends the value as given", () => {
    expect(check("blocked", "ADMIN")).toEqual(["blocked: Invalid characters detected."]);
    expect(check("blocked", "xAdMiNx")).toEqual(["blocked: Invalid characters detected."]);
    expect(schema().parse({ ...valid, blocked: "Adm" })).toEqual({ ...valid, blocked: "Adm" });
    expect(check("shouted", "root")).toEqual(["shouted: Invalid characters detected."]);
    expect(check("shouted", "roo")).toEqual([]);
  });

  it("leaves a non-ASCII value to the server when the pattern lacks the u flag, and checks ASCII as before", () => {
    // Without u, one backend reads "é" as two bytes and another as one character: only the server knows.
    expect(check("pair", "\u00e9")).toEqual([]);
    expect(check("pair", "\u00e9\u00e9")).toEqual([]);
    expect(check("pair", "ab")).toEqual([]);
    expect(check("pair", "abc")).toEqual(["pair: Invalid pattern."]);
    // With u every backend counts characters, and so does JavaScript, so the check runs.
    expect(check("pair_u", "\u00e9")).toEqual(["pair_u: Invalid pattern."]);
    expect(check("pair_u", "\u00e9\u00e9")).toEqual([]);
    expect(check("pair_u", "\u{1F600}")).toEqual(["pair_u: Invalid pattern."]);
    expect(check("pair_u", "\u{1F600}\u{1F600}")).toEqual([]);
  });

  it("leaves a non-ASCII value to the server when a u pattern uses a class escape, which backends read differently", () => {
    expect(check("word_u", "ab_1")).toEqual([]);
    expect(check("word_u", "a-b")).toEqual(["word_u: Invalid pattern."]);
    expect(check("word_u", "\u00e9")).toEqual([]);
    expect(check("word_u", "\u0663")).toEqual([]);
  });

  it("lets a dollar match before a final newline, as the server's regex engine may", () => {
    expect(check("slug", "abc\n")).toEqual([]);
    expect(check("slug", "abc\n\n")).toEqual(["slug: Invalid pattern."]);
  });

  it("an empty-body pattern matches everything", () => {
    expect(check("anything", "")).toEqual([]);
    expect(check("anything", "x y")).toEqual([]);
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
