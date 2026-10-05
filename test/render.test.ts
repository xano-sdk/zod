import { describe, it, expect } from "vitest";
import type { InputDescription, InputMethod } from "@xano/sdk/plugin";
import { pcreToRegex, renderZodSection } from "../src/render.js";

type Flags = Partial<{ required: boolean; nullable: boolean; list: false | { min?: number; max?: number }; methods: InputMethod[] }>;

/** One described input with the common flags defaulted to "optional, not nullable, single, no methods". */
function inp<T extends Record<string, unknown> & { type: string }>(name: string, rest: T, flags: Flags = {}): InputDescription {
  return { name, required: false, nullable: false, list: false, methods: [], ...flags, ...rest } as unknown as InputDescription;
}

const m = (name: string, ...args: string[]): InputMethod => ({ name, args });

/** The schema line one route's inputs render to, for the row named `name`. */
function row(inputs: InputDescription[], name: string): string {
  const { source } = renderZodSection({ routes: [{ key: "POST x", inputs }], channels: [], messages: [] });
  const line = source.split("\n").find((l) => l.trimStart().startsWith(`${name}: `));
  if (line === undefined) throw new Error(`no row ${name} in:\n${source}`);
  return line.trim();
}

describe("renderZodSection: one expression per described type", () => {
  it.each([
    ["text", { type: "text" }, "z.string()"],
    ["date", { type: "date" }, "z.string()"],
    ["int", { type: "int" }, "z.int()"],
    ["decimal", { type: "decimal" }, "z.number()"],
    ["epochms", { type: "epochms" }, "z.number()"],
    ["bool", { type: "bool" }, "z.boolean()"],
    ["json", { type: "json" }, "z.unknown()"],
    ["uuid", { type: "uuid" }, 'z.guid().or(z.literal(""))'],
    ["email", { type: "email" }, "z.string().check(__zodText({ email: true }))"],
    ["password", { type: "password" }, "z.string()"],
    ["vector", { type: "vector", size: 3 }, "z.array(z.number())"],
    ["tableRef int", { type: "tableRef", keyType: "int", table: "t" }, "z.int()"],
    ["tableRef uuid", { type: "tableRef", keyType: "uuid", table: "t" }, 'z.guid().or(z.literal(""))'],
    ["string enum", { type: "enum", values: ["a", "b"] }, 'z.enum(["a","b"])'],
    ["numeric enum", { type: "enum", values: [1, 2] }, "z.literal([1, 2])"],
    ["empty enum", { type: "enum", values: [] }, "z.never()"],
    ["unknown", { type: "unknown", storedType: "weird" }, "z.unknown()"],
    ["geo_point", { type: "geo_point" }, 'z.object({ type: z.literal("point"), data: z.object({ lng: z.number(), lat: z.number() }) })'],
    ["geo_multipolygon", { type: "geo_multipolygon" }, 'z.object({ type: z.literal("polys"), data: z.array(z.array(z.object({ lng: z.number(), lat: z.number() }))) })'],
  ])("%s", (_label, rest, expected) => {
    expect(row([inp("v", rest, { required: true })], "v")).toBe(`v: ${expected},`);
  });

  it("writes a file reference as an object of its optional members, and an upload as an opaque value", () => {
    expect(row([inp("v", { type: "blob_img" }, { required: true })], "v")).toMatch(/^v: z\.object\(\{ path: z\.string\(\)\.optional\(\), .*url: z\.string\(\)\.optional\(\) \}\),$/);
    expect(row([inp("v", { type: "file" }, { required: true })], "v")).toBe(
      'v: z.custom<{ readonly __fileUpload?: never }>((v) => v !== undefined && v !== null, "Expected a file"),',
    );
  });

  it("wraps a list in z.array before nullable, never the element", () => {
    expect(row([inp("v", { type: "int" }, { required: true, list: {} })], "v")).toBe("v: z.array(z.int()),");
    expect(row([inp("v", { type: "int" }, { required: true, list: {}, nullable: true })], "v")).toBe("v: z.array(z.int()).nullable(),");
    expect(row([inp("v", { type: "enum", values: ["a"] }, { required: true, list: {} })], "v")).toBe('v: z.array(z.enum(["a"])),');
  });

  it("puts list bounds on the array and element methods on the element", () => {
    expect(row([inp("v", { type: "int" }, { required: true, list: { min: 1, max: 3 }, methods: [m("max", "9")] })], "v")).toBe(
      "v: z.array(z.int().max(9)).min(1).max(3),",
    );
  });

  it("marks an input that is not required optional, and nullable before optional", () => {
    expect(row([inp("v", { type: "int" })], "v")).toBe("v: z.int().optional(),");
    expect(row([inp("v", { type: "int" }, { nullable: true })], "v")).toBe("v: z.int().nullable().optional(),");
  });

  it("leaves json's nullable off a scalar, where unknown already admits null, but keeps it on a list", () => {
    expect(row([inp("v", { type: "json" }, { required: true, nullable: true })], "v")).toBe("v: z.unknown(),");
    expect(row([inp("v", { type: "json" }, { required: true, nullable: true, list: {} })], "v")).toBe("v: z.array(z.unknown()).nullable(),");
  });

  it("renders an obj input as a nested z.object of its children", () => {
    const source = renderZodSection({
      routes: [{ key: "POST x", inputs: [inp("addr", { type: "obj", children: [inp("street", { type: "text" }, { required: true }), inp("unit", { type: "text" })] }, { required: true })] }],
      channels: [],
      messages: [],
    }).source;
    expect(source).toContain(`    addr: z.object({
      street: z.string(),
      unit: z.string().optional(),
    }),`);
  });

  it("admits the inherited member on an optional key named after one, as the core type does", () => {
    expect(row([inp("toString", { type: "text" })], "toString")).toBe(
      'toString: z.union([z.string(), z.custom<Object["toString"]>((v) => v === Object.prototype["toString"])]).optional(),',
    );
    expect(row([inp("valueOf", { type: "text" }, { required: true })], "valueOf")).toBe("valueOf: z.string(),");
  });

  it("quotes a key that is not an identifier", () => {
    expect(row([inp("first-name", { type: "text" }, { required: true })], '"first-name"')).toBe('"first-name": z.string(),');
  });
});

describe("renderZodSection: methods", () => {
  it("text min/max become length bounds, measured on the trimmed value the engine measures", () => {
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("min", "3"), m("max", "8")] })], "v")).toBe(
      "v: z.string().check(__zodText({ trim: true, min: 3, max: 8 })),",
    );
    // notrim turns the engine's default trim off, so the bounds measure the raw value.
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("notrim"), m("max", "8")] })], "v")).toBe(
      "v: z.string().check(__zodText({ max: 8 })),",
    );
  });

  it("int and decimal min/max become value bounds", () => {
    expect(row([inp("v", { type: "int" }, { required: true, methods: [m("min", "1"), m("max", "10")] })], "v")).toBe("v: z.int().min(1).max(10),");
    expect(row([inp("v", { type: "decimal" }, { required: true, methods: [m("min", "0"), m("max", "1.5")] })], "v")).toBe(
      "v: z.number().min(0).max(1.5),",
    );
  });

  it("maps pattern, startsWith and the character whitelist", () => {
    expect(
      row([inp("v", { type: "text" }, { required: true, methods: [m("startsWith", "@"), m("pattern", "^[a-z]+$", "lowercase only"), m("alphaOk"), m("ok", "_")] })], "v"),
    ).toBe('v: z.string().check(__zodText({ trim: true, startsWith: "@", ok: "abcdefghijklmnopqrstuvwxyz_", pattern: /^[a-z]+$/, patternError: "lowercase only" })),');
  });

  it("folds case only for the checks that run after the engine's lower/upper", () => {
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("upper"), m("pattern", "/^[A-Z]+$/")] })], "v")).toBe(
      'v: z.string().check(__zodText({ trim: true, fold: "upper", pattern: /^[A-Z]+$/ })),',
    );
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("lower"), m("max", "3")] })], "v")).toBe(
      "v: z.string().check(__zodText({ trim: true, max: 3 })),",
    );
  });

  it("maps the password policy as one count each, on the value the engine always trims", () => {
    expect(row([inp("v", { type: "password" }, { required: true, methods: [m("min", "8"), m("minDigit", "1"), m("minSymbol", "2")] })], "v")).toBe(
      'v: z.string().check(__zodText({ trim: true, min: 8, atLeast: [[/[0-9]/g, 1, "numbers"], [/[!-\\/:-@[-`{-~]/g, 2, "punctuation symbols"]] })),',
    );
  });

  it.each([
    ["trim", [m("trim")]],
    ["lower", [m("lower")]],
    ["upper", [m("upper")]],
    ["all three", [m("lower"), m("upper"), m("trim")]],
  ])("text %s alone produces no check — a transform is the server's to apply", (_label, methods) => {
    expect(row([inp("v", { type: "text" }, { required: true, methods })], "v")).toBe("v: z.string(),");
  });

  it("password salt alone produces no check", () => {
    expect(row([inp("v", { type: "password" }, { required: true, methods: [m("salt", "abc")] })], "v")).toBe("v: z.string(),");
  });

  it("a pattern zod cannot match faithfully is left to the server, not guessed", () => {
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("pattern", "/\\Aabc\\z/")] })], "v")).toBe("v: z.string(),");
  });

  it("a required input with a default stays required: no .default(), no .optional()", () => {
    // The description carries no default at all; required is the only flag that matters.
    expect(row([inp("qty", { type: "int" }, { required: true, methods: [m("min", "1")] })], "qty")).toBe("qty: z.int().min(1),");
  });

  it("declares the text helper only when some input uses it", () => {
    const without = renderZodSection({ routes: [{ key: "GET x", inputs: [inp("a", { type: "int" })] }], channels: [], messages: [] }).source;
    expect(without).not.toContain("__zodText");
    const using = renderZodSection({ routes: [{ key: "GET x", inputs: [inp("a", { type: "email" })] }], channels: [], messages: [] }).source;
    expect(using).toContain("const __zodText =");
  });
});

describe("renderZodSection: dbLink", () => {
  const columns = [inp("name", { type: "text" }, { required: true }), inp("age", { type: "int" })];

  it("spreads the linked table's columns into the surrounding object", () => {
    const source = renderZodSection({
      routes: [{ key: "POST signup", inputs: [{ name: "user__", type: "dbLink", table: "t", columns }, inp("plan", { type: "enum", values: ["free"] }, { required: true })] }],
      channels: [],
      messages: [],
    }).source;
    expect(source).toContain(`  "POST signup": z.object({
    name: z.string(),
    age: z.int().optional(),
    plan: z.enum(["free"]),
  }),`);
    expect(source).not.toContain("user__");
  });

  it("renders a key declared twice once, as the union, required only when both are", () => {
    const source = renderZodSection({
      routes: [{ key: "POST x", inputs: [{ name: "l", type: "dbLink", table: "t", columns }, inp("name", { type: "int" })] }],
      channels: [],
      messages: [],
    }).source;
    expect(source).toContain("name: z.union([z.string(), z.int()]).optional(),");
  });

  it("leaves the object open when the linked table's columns are unknown", () => {
    const source = renderZodSection({
      routes: [{ key: "POST x", inputs: [{ name: "l", type: "dbLink", table: "t", columns: undefined }, inp("plan", { type: "text" })] }],
      channels: [],
      messages: [],
    }).source;
    expect(source).toContain(`  "POST x": z.looseObject({
    plan: z.string().optional(),
  }),`);
  });
});

describe("renderZodSection: the section", () => {
  const section = renderZodSection({
    routes: [{ key: "GET a", inputs: [] }],
    channels: [{ key: "rooms/{id}", inputs: [inp("id", { type: "int" }, { required: true })] }],
    messages: [{ key: "rooms/{id} send", channel: "rooms/{id}", name: "send", inputs: [] }],
  });

  it("imports z from zod and nothing else", () => {
    expect(section.imports).toEqual([{ from: "zod", names: ["z"] }]);
    expect(section.source).not.toMatch(/^import /m);
  });

  it("builds every map inside a pure factory", () => {
    for (const name of ["ROUTE_SCHEMAS", "CHANNEL_SCHEMAS", "MESSAGE_SCHEMAS"]) {
      expect(section.source).toContain(`export const ${name} = /* @__PURE__ */ (() => (`);
    }
  });

  it("checks every key of every map against its core type, and the key sets", () => {
    for (const line of [
      '__ZodExpect<"keys of ROUTE_SCHEMAS", __ZodSame<keyof typeof ROUTE_SCHEMAS, keyof RouteInputs>>,',
      '__ZodExpect<"GET a", __ZodSame<z.output<(typeof ROUTE_SCHEMAS)["GET a"]>, RouteInputs["GET a"]>>,',
      '__ZodExpect<"rooms/{id}", __ZodSame<z.output<(typeof CHANNEL_SCHEMAS)["rooms/{id}"]>, ChannelInputs["rooms/{id}"]>>,',
      '__ZodExpect<"rooms/{id} send", __ZodSame<z.output<(typeof MESSAGE_SCHEMAS)["rooms/{id} send"]>, MessageInputs["rooms/{id} send"]>>,',
    ]) {
      expect(section.source).toContain(line);
    }
  });

  it("is a function of its input alone", () => {
    const again = renderZodSection({
      routes: [{ key: "GET a", inputs: [] }],
      channels: [{ key: "rooms/{id}", inputs: [inp("id", { type: "int" }, { required: true })] }],
      messages: [{ key: "rooms/{id} send", channel: "rooms/{id}", name: "send", inputs: [] }],
    });
    expect(again).toEqual(section);
  });

  it("renders empty maps for an empty description", () => {
    const { source } = renderZodSection({ routes: [], channels: [], messages: [] });
    expect(source).toContain("export const CHANNEL_SCHEMAS = /* @__PURE__ */ (() => ({}))();");
  });
});

describe("pcreToRegex", () => {
  it.each([
    ["^[a-z0-9-]+$", "/^[a-z0-9-]+$/"],
    ["/^[A-Z]+$/i", "/^[A-Z]+$/i"],
    ["#^a/b$#", "/^a\\/b$/"],
    ["~^\\d{3}-\\d{4}$~D", "/^\\d{3}-\\d{4}$/"],
    ["/^(?<year>\\d{4})-(\\d\\d)\\1$/", "/^(?<year>\\d{4})-(\\d\\d)\\1$/"],
    ["/^\\x41\\.$/", "/^\\x41\\.$/"],
  ])("translates %j", (stored, expected) => {
    expect(pcreToRegex(stored)).toBe(expected);
  });

  it.each([
    ["", "empty: the engine checks nothing"],
    ["/\\Aabc\\z/", "PCRE-only anchors"],
    ["/[[:alpha:]]+/", "POSIX class"],
    ["/(?i)abc/", "inline flags"],
    ["/(?>a+)b/", "atomic group"],
    ["/a b/x", "extended flag"],
    ["/\\p{L}+/u", "unicode property"],
    ["/a\\vb/", "\\v differs"],
    ["/[]a]/", "leading ] in a class"],
    ["/a++/", "possessive quantifier"],
  ])("refuses %j (%s)", (stored) => {
    expect(pcreToRegex(stored)).toBeUndefined();
  });
});
