import { describe, it, expect } from "vitest";
import { transform } from "esbuild";
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
    ["email", { type: "email" }, "z.string().check(__zodText({ trim: true, email: true }))"],
    ["password", { type: "password" }, "z.string()"],
    ["vector", { type: "vector", size: 3 }, "z.array(z.number()).length(3)"],
    ["tableRef int", { type: "tableRef", keyType: "int", table: "t" }, "z.int()"],
    ["tableRef uuid", { type: "tableRef", keyType: "uuid", table: "t" }, 'z.guid().or(z.literal(""))'],
    ["string enum", { type: "enum", values: ["a", "b"] }, 'z.enum(["a","b"])'],
    ["numeric enum", { type: "enum", values: [1, 2] }, "z.literal([1, 2])"],
    ["empty enum", { type: "enum", values: [] }, "z.never()"],
    ["unknown", { type: "unknown", storedType: "weird" }, "z.unknown()"],
    ["geo_point", { type: "geo_point" }, 'z.object({ type: z.literal("point"), data: z.object({ lng: z.number(), lat: z.number() }) })'],
    ["geo_multipolygon", { type: "geo_multipolygon" }, 'z.object({ type: z.literal("polys"), data: z.array(z.array(z.object({ lng: z.number(), lat: z.number() }))) })'],
  ])("%s", (_label, rest, expected) => {
    expect(row([inp("v", rest)], "v")).toBe(`v: ${expected}.optional(),`);
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
    expect(row([inp("v", { type: "json" }, { nullable: true })], "v")).toBe("v: z.unknown().optional(),");
    expect(row([inp("v", { type: "json" }, { required: true, nullable: true, list: {} })], "v")).toBe("v: z.array(z.unknown()).nullable(),");
  });

  it("renders an obj input as a nested z.object of its children", () => {
    const source = renderZodSection({
      routes: [{ key: "POST x", inputs: [inp("addr", { type: "obj", children: [inp("street", { type: "text" }, { required: true }), inp("unit", { type: "text" })] }, { required: true })] }],
      channels: [],
      messages: [],
    }).source;
    expect(source).toContain(`    addr: z.object({
      street: z.string().check(__zodRequired("street")),
      unit: z.string().optional(),
    }),`);
  });

  it("admits the inherited member on an optional key named after one, as the core type does", () => {
    expect(row([inp("toString", { type: "text" })], "toString")).toBe(
      'toString: z.union([z.string(), z.custom<Object["toString"]>((v) => v === Object.prototype["toString"])]).optional(),',
    );
    expect(row([inp("valueOf", { type: "text" }, { required: true })], "valueOf")).toBe('valueOf: z.string().check(__zodRequired("valueOf")),');
  });

  it("quotes a key that is not an identifier", () => {
    expect(row([inp("first-name", { type: "text" }, { required: true })], '"first-name"')).toBe('"first-name": z.string().check(__zodRequired("first-name")),');
  });
});

describe("renderZodSection: methods", () => {
  it("text min/max become length bounds, measured on the raw value unless the input says trim", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("min", "3"), m("max", "8")] })], "v")).toBe(
      "v: z.string().check(__zodText({ min: 3, max: 8 })).optional(),",
    );
    // The engine trims before measuring only when told to.
    expect(row([inp("v", { type: "text" }, { methods: [m("trim"), m("min", "3"), m("max", "8")] })], "v")).toBe(
      "v: z.string().check(__zodText({ trim: true, min: 3, max: 8 })).optional(),",
    );
  });

  it("the last of trim and notrim wins, wherever they sit among the other methods", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("trim"), m("notrim"), m("max", "8")] })], "v")).toBe(
      "v: z.string().check(__zodText({ max: 8 })).optional(),",
    );
    expect(row([inp("v", { type: "text" }, { methods: [m("notrim"), m("max", "8"), m("trim")] })], "v")).toBe(
      "v: z.string().check(__zodText({ trim: true, max: 8 })).optional(),",
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
      row([inp("v", { type: "text" }, { methods: [m("startsWith", "@"), m("pattern", "^[a-z]+$", "lowercase only"), m("alphaOk"), m("ok", "_")] })], "v"),
    ).toBe('v: z.string().check(__zodText({ startsWith: "@", ok: "abcdefghijklmnopqrstuvwxyz_", pattern: /^[a-z]+(?=\\n?$)/, patternError: "lowercase only" })).optional(),');
  });

  it("folds case only for the checks that run after the engine's lower/upper", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("upper"), m("pattern", "/^[A-Z]+$/")] })], "v")).toBe(
      'v: z.string().check(__zodText({ fold: "upper", pattern: /^[A-Z]+(?=\\n?$)/ })).optional(),',
    );
    expect(row([inp("v", { type: "text" }, { methods: [m("lower"), m("max", "3")] })], "v")).toBe(
      "v: z.string().check(__zodText({ max: 3 })).optional(),",
    );
  });

  it("marks a u pattern that uses a class escape, which backends read differently for non-ASCII values", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("pattern", "/^\\w+$/u")] })], "v")).toBe(
      "v: z.string().check(__zodText({ pattern: /^\\w+(?=\\n?$)/u, patternAscii: true })).optional(),",
    );
    // Without u, or without such an escape, there is nothing to mark.
    expect(row([inp("v", { type: "text" }, { methods: [m("pattern", "/^\\w+$/")] })], "v")).toBe(
      "v: z.string().check(__zodText({ pattern: /^\\w+(?=\\n?$)/ })).optional(),",
    );
    expect(row([inp("v", { type: "text" }, { methods: [m("pattern", "/^.{2}$/u")] })], "v")).toBe(
      "v: z.string().check(__zodText({ pattern: /^[^\\n]{2}(?=\\n?$)/u })).optional(),",
    );
  });

  it("maps the password policy as one count each, on the value the engine always trims", () => {
    expect(row([inp("v", { type: "password" }, { methods: [m("min", "8"), m("minDigit", "1"), m("minSymbol", "2")] })], "v")).toBe(
      'v: z.string().check(__zodText({ trim: true, password: true, min: 8, atLeast: [[/[0-9]/g, 1, "numbers"], [/[!-\\/:-@[-`{-~]/g, 2, "punctuation symbols, like: $@^&*%^"]] })).optional(),',
    );
  });

  it("an email is always trimmed: the server trims it whatever its methods", () => {
    expect(row([inp("v", { type: "email" }, { methods: [m("notrim")] })], "v")).toBe(
      "v: z.string().check(__zodText({ trim: true, email: true })).optional(),",
    );
  });

  it("maps each blocked phrase, skipping an empty one, on the folded value", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("lower"), m("prevent", "admin"), m("prevent", ""), m("prevent", "root")] })], "v")).toBe(
      'v: z.string().check(__zodText({ fold: "lower", prevent: ["admin","root"] })).optional(),',
    );
    expect(row([inp("v", { type: "text" }, { methods: [m("prevent", "")] })], "v")).toBe("v: z.string().optional(),");
  });

  it.each([
    ["trim", [m("trim")]],
    ["notrim", [m("notrim")]],
    ["lower", [m("lower")]],
    ["upper", [m("upper")]],
    ["all of them", [m("lower"), m("upper"), m("trim")]],
  ])("text %s alone produces no check — a transform is the server's to apply", (_label, methods) => {
    expect(row([inp("v", { type: "text" }, { methods })], "v")).toBe("v: z.string().optional(),");
  });

  it("password salt alone produces no check", () => {
    expect(row([inp("v", { type: "password" }, { methods: [m("salt", "abc")] })], "v")).toBe("v: z.string().optional(),");
  });

  it("a pattern zod cannot match faithfully is left to the server, not guessed", () => {
    expect(row([inp("v", { type: "text" }, { methods: [m("pattern", "/\\Aabc\\z/")] })], "v")).toBe("v: z.string().optional(),");
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

describe("renderZodSection: the server's required check", () => {
  it.each([
    ["text", { type: "text" }, 'z.string().check(__zodRequired("v"))'],
    ["email", { type: "email" }, 'z.string().check(__zodRequired("v"), __zodText({ trim: true, email: true }))'],
    ["password", { type: "password" }, 'z.string().check(__zodRequired("v"))'],
    ["uuid", { type: "uuid" }, 'z.guid().or(z.literal("")).check(__zodRequired("v"))'],
    ["date", { type: "date" }, 'z.string().check(__zodRequired("v"))'],
    ["json", { type: "json" }, 'z.unknown().check(__zodRequired("v"))'],
    ["tableRef to a uuid table", { type: "tableRef", keyType: "uuid", table: "t" }, 'z.guid().or(z.literal("")).check(__zodRequired("v"))'],
  ])("a required %s refuses the empty string as missing", (_label, rest, expected) => {
    expect(row([inp("v", rest, { required: true })], "v")).toBe(`v: ${expected},`);
  });

  it("runs before the text checks, so a required text with a minimum reports the server's missing param for the empty string", () => {
    expect(row([inp("v", { type: "text" }, { required: true, methods: [m("min", "3")] })], "v")).toBe(
      'v: z.string().check(__zodRequired("v"), __zodText({ min: 3 })),',
    );
  });

  it.each([
    ["int", { type: "int" }, "z.int()"],
    ["decimal", { type: "decimal" }, "z.number()"],
    ["bool", { type: "bool" }, "z.boolean()"],
    ["epochms", { type: "epochms" }, "z.number()"],
    ["enum", { type: "enum", values: ["a"] }, 'z.enum(["a"])'],
    ["tableRef to an int table", { type: "tableRef", keyType: "int", table: "t" }, "z.int()"],
    ["unknown", { type: "unknown", storedType: "weird" }, "z.unknown()"],
  ])("a required %s carries no such check: its type refuses the empty string already, or is not known", (_label, rest, expected) => {
    expect(row([inp("v", rest, { required: true })], "v")).toBe(`v: ${expected},`);
  });

  it("checks a single value, never the elements of a required list, and sits before nullable", () => {
    expect(row([inp("v", { type: "text" }, { required: true, list: {} })], "v")).toBe("v: z.array(z.string()),");
    expect(row([inp("v", { type: "text" }, { required: true, nullable: true })], "v")).toBe('v: z.string().check(__zodRequired("v")).nullable(),');
    // json drops nullable (unknown admits null) but keeps the check.
    expect(row([inp("v", { type: "json" }, { required: true, nullable: true })], "v")).toBe('v: z.unknown().check(__zodRequired("v")),');
  });

  it("declares the helper only when some input uses it", () => {
    const without = renderZodSection({ routes: [{ key: "GET x", inputs: [inp("a", { type: "text" })] }], channels: [], messages: [] }).source;
    expect(without).not.toContain("__zodRequired");
    const using = renderZodSection({ routes: [{ key: "GET x", inputs: [inp("a", { type: "text" }, { required: true })] }], channels: [], messages: [] }).source;
    expect(using).toContain("const __zodRequired =");
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
    name: z.string().check(__zodRequired("name")),
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
    expect(source).toContain('name: z.union([z.string().check(__zodRequired("name")), z.int()]).optional(),');
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

describe("renderZodSection: keys that are not plain property names", () => {
  it("writes an input named __proto__ as a computed key, so it is an own key of the shape", () => {
    const { source } = renderZodSection({ routes: [{ key: "POST x", inputs: [inp("__proto__", { type: "int" }, { required: true })] }], channels: [], messages: [] });
    expect(source).toContain('    ["__proto__"]: z.int(),\n');
  });

  it("drops a key whose value was read off Object.prototype, so parse returns only the keys it was given", () => {
    const { source } = renderZodSection({
      routes: [{ key: "POST x", inputs: [inp("toString", { type: "text" }), inp("valueOf", { type: "text" }, { required: true }), inp("constructor", { type: "int" })] }],
      channels: [],
      messages: [],
    });
    expect(source).toContain('  }).check(__zodOwnKeys(["toString","constructor"])),');
    expect(source).toContain("const __zodOwnKeys =");
    const plain = renderZodSection({ routes: [{ key: "POST x", inputs: [inp("a", { type: "text" })] }], channels: [], messages: [] }).source;
    expect(plain).not.toContain("__zodOwnKeys");
  });
});

/** A regex literal as `pcreToRegex` writes it, compiled. */
function compile(literal: string): RegExp {
  const end = literal.lastIndexOf("/");
  return new RegExp(literal.slice(1, end), literal.slice(end + 1));
}

describe("pcreToRegex", () => {
  it.each([
    ["^[a-z0-9-]+$", "/^[a-z0-9-]+(?=\\n?$)/"],
    ["/^[A-Z]+$/i", "/^[A-Z]+(?=\\n?$)/i"],
    ["#^a/b$#", "/^a\\/b(?=\\n?$)/"],
    ["~^\\d{3}-\\d{4}$~D", "/^\\d{3}-\\d{4}$/"],
    ["/^(?<year>\\d{4})-(\\d\\d)\\1$/", "/^(?<year>\\d{4})-(\\d\\d)\\1(?=\\n?$)/"],
    ["/^\\x41\\.$/", "/^\\x41\\.(?=\\n?$)/"],
    ["/^a\\$$/D", "/^a\\$$/"],
  ])("translates %j", (stored, expected) => {
    expect(pcreToRegex(stored)).toBe(expected);
  });

  it.each([
    ["/^a.b$/D", "/^a[^\\n]b$/", "dot stops at a newline only"],
    ["/^a.b$/sD", "/^a.b$/s", "dot under s matches everything, as in JavaScript"],
    ["/^\\s*x\\S$/D", "/^[\\t\\n\\v\\f\\r ]*x[^\\t\\n\\v\\f\\r ]$/", "\\s is six ASCII characters"],
    ["/[\\s,]+/", "/[\\t\\n\\v\\f\\r ,]+/", "\\s inside a class"],
    ["/^a$/", "/^a(?=\\n?$)/", "$ without D also matches before a final newline"],
    ["/^b$/m", "/(?<![^\\n])b(?![^\\n])/", "^ and $ under m turn at a newline only"],
    ["/a$/mi", "/a(?![^\\n])/i", "m is written out, the other flags kept"],
  ])("writes %j as %j, what the server matches (%s)", (stored, expected) => {
    expect(pcreToRegex(stored)).toBe(expected);
  });

  it("matches what the server matches for a dot, a whitespace escape, a dollar and a multiline anchor", () => {
    const dot = compile(pcreToRegex("/^a.b$/")!);
    expect(dot.test("a\rb")).toBe(true);
    expect(dot.test("a\u2028b")).toBe(true);
    expect(dot.test("a\nb")).toBe(false);
    const nonSpace = compile(pcreToRegex("/^\\S+$/")!);
    expect(nonSpace.test("a\u00a0b")).toBe(true);
    expect(nonSpace.test("a b")).toBe(false);
    expect(compile(pcreToRegex("/^\\s$/")!).test("\u00a0")).toBe(false);
    const dollar = compile(pcreToRegex("/^a$/")!);
    expect(dollar.test("a\n")).toBe(true);
    expect(dollar.test("a\n\n")).toBe(false);
    expect(dollar.test("a\r")).toBe(false);
    expect(compile(pcreToRegex("/^a$/D")!).test("a\n")).toBe(false);
    const multi = compile(pcreToRegex("/^b$/m")!);
    expect(multi.test("a\nb")).toBe(true);
    expect(multi.test("b\nc")).toBe(true);
    expect(multi.test("a\rb")).toBe(false);
    expect(multi.test("b\r\n")).toBe(false);
    // The server's ^ under m matches after a final newline too, so an empty match there passes.
    const empty = compile(pcreToRegex("/^x?$/m")!);
    expect(empty.test("ab\n")).toBe(true);
    expect(empty.test("a\n\n")).toBe(true);
    expect(empty.test("")).toBe(true);
  });

  it("refuses \\S inside a class, which has no class form", () => {
    expect(pcreToRegex("/[\\Sx]+/")).toBeUndefined();
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

  it('reads a stored "0" as no pattern, as the server does', () => {
    expect(pcreToRegex("0")).toBeUndefined();
  });

  it.each([
    ["//", "/(?:)/"],
    ["##", "/(?:)/"],
    ["~~i", "/(?:)/i"],
    ["a\\\nb", "/a\\nb/"],
    ["/a\\\rb/", "/a\\rb/"],
    ["/a\\\u2028b/", "/a\\u2028b/"],
    ["/a\\\u2029b/", "/a\\u2029b/"],
    ["/a\u2028b/", "/a\\u2028b/"],
  ])("writes %j as a literal no line break or comment can end early", (stored, expected) => {
    expect(pcreToRegex(stored)).toBe(expected);
  });

  it("matches what the server matches for an empty body and an escaped line break", () => {
    expect(compile(pcreToRegex("##")!).test("anything")).toBe(true);
    expect(compile(pcreToRegex("~~i")!).test("")).toBe(true);
    expect(compile(pcreToRegex("a\\\nb")!).test("a\nb")).toBe(true);
    expect(compile(pcreToRegex("a\\\nb")!).test("ab")).toBe(false);
    expect(compile(pcreToRegex("/a\\\u2028b/")!).test("a\u2028b")).toBe(true);
  });

  it("emits a section that still parses when a pattern has an empty body or an escaped line break", async () => {
    const patterns = ["//", "##", "~~i", "a\\\nb", "/a\\\rb/", "/a\\\u2028b/", "/a\\\u2029b/"];
    const { source } = renderZodSection({
      routes: [{ key: "POST x", inputs: patterns.map((p, i) => inp(`p${i}`, { type: "text" }, { required: true, methods: [m("pattern", p)] })) }],
      channels: [],
      messages: [],
    });
    const { code } = await transform(source, { loader: "ts", format: "esm" });
    for (let i = 0; i < patterns.length; i++) expect(code).toContain(`p${i}: z.string().check(`);
    expect(source).not.toMatch(/pattern: \/\//);
  });

  it.each([
    [" /abc/i", "/abc/i"],
    ["\t\n/abc/i", "/abc/i"],
    ["/abc/i ", "/abc/i"],
    ["/abc/ i\r\n", "/abc/i"],
    ["  ^a", "/  ^a/"],
  ])("reads %j as the server does: whitespace before the delimiter and among the flags is dropped", (stored, expected) => {
    expect(pcreToRegex(stored)).toBe(expected);
  });

  it("an undelimited pattern keeps its leading whitespace", () => {
    expect(compile(pcreToRegex("  ^a")!).test("  a")).toBe(false);
    expect(compile(pcreToRegex(" /abc/i")!).test("ABC")).toBe(true);
  });
});
