/**
 * Schema versus server: every declaration in the parity fixture is sent the
 * same payloads through its emitted schema and to a backend serving the
 * fixture, and the two verdicts are compared.
 *
 * The default expectation is agreement. Where the two are known to differ, the
 * case says how and why, and the suite asserts that exact difference, so a
 * server or module change that closes (or opens) a gap shows up here as a
 * failure to re-examine, not as silence. When both refuse a value and every
 * issue the schema raised is this module's own (a `custom` issue, not one of
 * zod's type or bound messages), the server's message must be among them.
 *
 * Needs a backend: `npm run test:e2e` deploys the fixture to a Xano Engine on
 * this machine through the installed SDK (see helpers/backend.ts), or set
 * `XANO_E2E_HOST` to a backend that already serves it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { emittedRoutesFile, scratchDir, writeFiles } from "../helpers/emitted.js";
import e2eWorkspace, { DBL, declarations } from "./fixtures/defs.js";
import { startBackend, type Backend } from "./helpers/backend.js";

interface Schema {
  safeParse(value: unknown): { success: boolean; error?: { issues: { code: string; message: string; path: PropertyKey[] }[] } };
}

/** The key left out of the body. */
const MISSING = Symbol("missing");

/** Why a schema and the server are known to disagree on a value. */
const WHY = {
  coercion: "the server coerces the value to the declared type; the schema holds the core type",
  omitted: "the server binds an omitted input to its default and runs the methods on that; the description carries no default",
  pattern: "a pattern stored with one argument fails on the server for every value",
  empty_enum: "an enum with no values accepts anything on the server; the core type is never",
  file_ref: "the server requires every member of a stored file reference; the type lists them optional",
  file_upload: "a file upload cannot be sent as JSON; the schema admits any value but null",
  date: "the server parses a date permissively and refuses what it cannot read; the schema takes any string",
  non_ascii: "a pattern without the u flag is matched byte by byte on some backends and character by character on others, so the schema leaves a non-ASCII value to the server",
  dollar: "without the D flag some backends let $ match before a final newline and others do not; the schema takes the lenient reading",
  multiline_end: "under the m flag some backends let ^ match after a final newline and others do not; the schema takes the lenient reading",
  unicode_classes: "under the u flag some backends read \\s, \\d, \\w and \\b as Unicode classes and others as ASCII, so the schema leaves a non-ASCII value to the server",
} as const;

type Outcome = "pass" | "fail";

interface Divergence {
  readonly zod: Outcome;
  /** `either`: backends differ, so only the schema's verdict is asserted. */
  readonly server: Outcome | "either";
  readonly why: keyof typeof WHY;
}

interface Case {
  /** The endpoint name: a key of `declarations`, or DBL. */
  readonly route: string;
  /** The value of `v` (DBL: the whole body), or MISSING. */
  readonly value: unknown;
  readonly diverges?: Divergence;
}

const agree = (route: string, ...values: unknown[]): Case[] => values.map((value) => ({ route, value }));
const gap = (why: keyof typeof WHY, zod: Divergence["zod"], server: Divergence["server"], route: string, ...values: unknown[]): Case[] =>
  values.map((value) => ({ route, value, diverges: { zod, server, why } }));
/** The schema leaves the value to the server, whose backends disagree on it. */
const serverOnly = (why: keyof typeof WHY, route: string, ...values: unknown[]): Case[] => gap(why, "pass", "either", route, ...values);
/** The server accepts, the schema refuses: a type the server coerces. */
const coerced = (route: string, ...values: unknown[]): Case[] => gap("coercion", "fail", "pass", route, ...values);
/** The schema accepts, the server refuses: an omitted input whose default fails its methods. */
const omitted = (route: string, ...values: unknown[]): Case[] => gap("omitted", "pass", "fail", route, ...(values.length === 0 ? [MISSING] : values));

const FILE_REF = { path: "/x.png", name: "x.png", type: "image", mime: "image/png", size: 10, access: "public", meta: {}, url: "u" };

const CASES: readonly Case[] = [
  // ── text: flags ──
  ...agree("t_req", MISSING, "", "   ", null, "  ok  ", "ok"),
  ...agree("t_opt", MISSING, "", "x"),
  ...coerced("t_opt", null),
  ...agree("t_null", null, MISSING, ""),
  ...agree("t_def", MISSING, "", "x"),
  ...agree("t_opt_def", MISSING, ""),
  // ── text: trim and the length bounds ──
  ...agree("t_min", "", "ab", "  ab  ", "abc", null),
  ...omitted("t_min"),
  ...agree("t_req_min", "", "   ", "ab", "abc", MISSING),
  ...agree("t_null_min", MISSING, null, "", "ab", "abc"),
  ...agree("t_def_min", MISSING, "ab", ""),
  ...agree("t_def_short", "abc"),
  ...omitted("t_def_short"),
  ...agree("t_trim_min", "  ab  ", "  abc  ", "   "),
  ...omitted("t_trim_min"),
  ...agree("t_min_trim", "  ab  "),
  ...agree("t_max", " ab ", "abc", "abcd", MISSING),
  ...agree("t_trim_max", " abc ", " abcd "),
  ...agree("t_notrim_max", " ab "),
  ...agree("t_trim_notrim_max", " abc "),
  ...agree("t_notrim_trim_max", " abc "),
  ...agree("t_req_trim", "   ", "  x  ", ""),
  ...agree("t_lower_max", "ABCD", "ABC"),
  // ── text: startsWith ──
  ...agree("t_sw", "abc", "@x", "", "  @x"),
  ...omitted("t_sw"),
  ...agree("t_req_sw", "", "abc", "@x"),
  ...agree("t_trim_sw", "  abc  ", "  @x  "),
  ...agree("t_sw_min", "ab", "@ab", "@a"),
  ...omitted("t_sw_min"),
  ...agree("t_upper_sw", "abc", "ABc"),
  ...agree("t_sw_upper", "abc", "ABc"),
  // ── text: the whitelist and blocked phrases ──
  ...agree("t_alpha", "abc", "ABC", "ab1", "", MISSING, "é"),
  ...agree("t_digit_ok", "12-3", "12a"),
  ...agree("t_ok_upper", "abc", "ABC", "abd"),
  ...agree("t_prevent", "xadminx", "ADMIN", "adm", MISSING),
  ...agree("t_lower_prevent", "ADMIN"),
  // ── text: patterns ──
  ...agree("t_pat_err", "ab1", "abc", ""),
  ...omitted("t_pat_err"),
  ...agree("t_pat_noerr", "abc", "ab1"),
  ...omitted("t_pat_noerr"),
  ...agree("t_req_pat", "", "ab1"),
  ...agree("t_lower_pat", "ABC", "ab1"),
  ...agree("t_pat_lower", "ABC", "ab1"),
  ...agree("t_pat_i", "ABC", "abcd"),
  ...agree("t_pat_two", "ab", "abc"),
  ...serverOnly("non_ascii", "t_pat_two", "\u00e9", "\u00e9\u00e9", "a\u00e9", "\u{1F600}", "\u{1F600}\u{1F600}"),
  ...agree("t_pat_two_u", "\u00e9", "\u00e9\u00e9", "\u{1F600}", "\u{1F600}\u{1F600}"),
  ...agree("t_pat_nonspace", "ab", "a b", "a\u00a0b", "a\u2028b"),
  ...agree("t_pat_space", " ", "\t", "x"),
  ...serverOnly("non_ascii", "t_pat_space", "\u00a0", "\u2028"),
  ...agree("t_pat_word", "ab_1", "a-b"),
  ...serverOnly("non_ascii", "t_pat_word", "\u00e9"),
  ...agree("t_pat_fold", "e"),
  ...serverOnly("non_ascii", "t_pat_fold", "\u00e9", "\u00c9"),
  ...agree("t_pat_dot", "a", "\r", "\n", "ab", ""),
  ...serverOnly("non_ascii", "t_pat_dot", "\u2028", "\u2029"),
  ...agree("t_pat_dot_s", "\n", "\r", "a"),
  ...agree("t_pat_end", "a", "a\r", "a\n\n", "\na", "a\r\n"),
  ...serverOnly("dollar", "t_pat_end", "a\n"),
  ...agree("t_pat_end_d", "a", "a\n"),
  ...agree("t_pat_multi", "a\nb", "b\nc", "a\rb", "b", "a\r\nb", "b\r\n", "ab"),
  ...agree("t_pat_multi_empty", "", "x", "\n", "x\n", "a\n\n", "ab"),
  ...serverOnly("multiline_end", "t_pat_multi_empty", "ab\n"),
  ...agree("t_pat_space_u", " ", "\t", "x"),
  ...serverOnly("unicode_classes", "t_pat_space_u", "\u00a0", "\u2028", "\u3000"),
  ...agree("t_pat_nonspace_u", "ab", "a b"),
  ...serverOnly("unicode_classes", "t_pat_nonspace_u", "a\u00a0b", "a\u2028b"),
  ...agree("t_pat_word_u", "ab_1", "a-b"),
  ...serverOnly("unicode_classes", "t_pat_word_u", "\u00e9", "\u0663"),
  ...agree("t_pat_digit_u", "123", "12a"),
  ...serverOnly("unicode_classes", "t_pat_digit_u", "\u0663"),
  ...gap("pattern", "pass", "fail", "t_pat_single", "abc", MISSING),
  ...gap("pattern", "fail", "fail", "t_pat_single", "ab1"),
  // ── text: lists ──
  ...agree("t_list", [], ["a"], ["ab", "cd", "ef"], ["ab"], null, [""]),
  ...omitted("t_list"),
  ...coerced("t_list", "ab"),
  ...agree("t_list_req", MISSING, [], null, [""]),
  ...coerced("t_list_req", ""),
  ...agree("t_list_opt", MISSING, []),
  ...coerced("t_list_opt", null, ""),
  ...agree("t_list_trim", ["  x  "], ["  xy  "]),
  ...agree("t_list_max", MISSING, [], ["a", "b", "c"]),
  ...agree("l_null_min", MISSING, null, [], [1]),
  // ── email ──
  ...agree("e_req", MISSING, "", "   ", "bad", "  a@b.co  ", null, "A@B.CO"),
  ...agree("e_opt", MISSING, "", "bad"),
  ...coerced("e_opt", null),
  ...agree("e_lower", "A@B.CO"),
  ...agree("e_null", null),
  ...agree("e_list", ["a@b.co", ""], ["bad"], [], MISSING),
  // ── password ──
  ...agree("p_req", MISSING, "", "0", "   ", null),
  ...agree("p_opt", "", MISSING),
  ...coerced("p_opt", null),
  ...agree("p_min", "Pa0!ab", "  Pa0!ab  ", "        ", "Passw0rd", "0", "", MISSING),
  ...agree("p_req_min", "", "short", "0"),
  ...agree("p_max", "Passw0rd!xx", "  Passw0rd  "),
  ...agree("p_policy", "ab1!", "Ab1!", "ÄÄÄÄ1!", "Ab1", "AB1!", "ab12!", MISSING),
  ...agree("p_salt", "anything"),
  // ── numbers ──
  ...agree("i_req", MISSING, "", null, "abc", true, 0, -5),
  ...coerced("i_req", "100", 12.5, "0"),
  ...agree("i_opt", MISSING, 0),
  ...coerced("i_opt", "", null),
  ...agree("i_null", null),
  ...agree("i_bounds", -1, 11, 5, 0, 10, MISSING),
  ...agree("i_min1", 0, 1),
  ...omitted("i_min1"),
  ...agree("i_max_neg", 0, -1),
  ...omitted("i_max_neg"),
  ...agree("i_null_min", MISSING, null, 0, 1),
  ...agree("i_def_min", MISSING, 0),
  ...agree("d_req", "", MISSING, null, 0),
  ...coerced("d_req", "1.5"),
  ...agree("d_bounds", 1.5, -0.1, 0.5, 0, 1, MISSING),
  ...agree("d_min", 0.4, 0.5),
  ...omitted("d_min"),
  ...agree("d_null", null),
  ...agree("i_list", [], [1], [1, 2, 3]),
  ...omitted("i_list"),
  ...coerced("i_list", ["1"], 5),
  ...agree("i_list_opt", MISSING, [], [1]),
  ...coerced("i_list_opt", null),
  ...agree("v3", [1, 2], [1, 2, 3], [1, 2, 3, 4], null, ["a"], MISSING),
  ...agree("r_int", 999, 0, MISSING),
  ...coerced("r_int", "5", null),
  ...agree("r_bounds", 0, 1),
  ...omitted("r_bounds"),
  ...agree("r_req", MISSING, 0, "", null),
  ...agree("ru_opt", MISSING, null, "", "00000000-0000-0000-0000-000000000000", "not-a-uuid"),
  ...agree("ru_req", MISSING, null, "", "00000000-0000-0000-0000-000000000000", "12345678-1234-1234-1234-123456789abc"),
  // ── the rest of the scalars ──
  ...agree("b_req", MISSING, null, "", false, true),
  ...coerced("b_req", "yes", 1, "false", 0),
  ...agree("b_opt", MISSING),
  ...coerced("b_opt", "", null),
  ...agree(
    "u_req",
    "",
    "0",
    "not-a-uuid",
    "12345678-1234-1234-1234-123456789abc",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    MISSING,
    null,
    "00000000-0000-0000-0000-000000000000",
  ),
  ...agree("u_opt", null, "", MISSING, "not-a-uuid"),
  ...agree("u_strict", ""),
  ...coerced("u_strict", null),
  ...agree("dt_req", "", MISSING, null, "2024-01-01", "2024-1-1", "01/02/2024", "2024-01-01T10:00:00Z", "2024-13-45", "2024-02-30", "yesterday", "20240101", "   ", "0"),
  ...gap("date", "pass", "fail", "dt_req", "garbage"),
  ...coerced("dt_req", 1700000000000, 0),
  ...agree("dt_opt", null, "", MISSING),
  ...gap("date", "pass", "fail", "dt_opt", "garbage"),
  ...agree("ts_req", "", "garbage", MISSING, null, 1700000000000, 0),
  ...coerced("ts_req", "2024-01-01T00:00:00Z", "1700000000000"),
  ...agree("ts_opt", null, MISSING),
  ...coerced("ts_opt", ""),
  ...agree("j_req", MISSING, null, "", "str", 0, {}, [], false),
  ...agree("j_opt", null, "", MISSING),
  ...agree("en_req", "zzz", "", MISSING, null, "a"),
  ...agree("en_opt", MISSING),
  ...coerced("en_opt", "", null),
  ...agree("en_num", 1, 3, MISSING),
  ...coerced("en_num", "1"),
  ...agree("en_empty", MISSING),
  ...gap("empty_enum", "fail", "pass", "en_empty", "anything", "", null),
  // ── objects ──
  ...agree("o_req", MISSING, {}, { s: "x" }, { s: "ok", t: " abcd " }, { s: "ok", t: " abc " }, "str", null, { s: "ok", extra: 1 }, { s: "" }, { s: "ok" }),
  ...coerced("o_req", { s: "ok", n: "5" }),
  ...agree("o_opt", {}, MISSING),
  ...coerced("o_opt", null, "str"),
  ...agree("o_min", { mm: "abc" }, { mm: "" }),
  ...omitted("o_min", {}, MISSING),
  ...agree("o_opt_req_child", {}, { s: "x" }, null),
  ...omitted("o_opt_req_child"),
  ...agree("o_null_min", MISSING, null, { mm: "abc" }),
  ...omitted("o_null_min", {}),
  // ── files ──
  ...agree("img", "str", null, MISSING, FILE_REF),
  ...gap("file_ref", "pass", "fail", "img", { path: "/x.png" }, { path: "/x.png", name: "x", type: "image", mime: "image/png", size: 1 }),
  ...coerced("img", ""),
  ...agree("att", null, MISSING),
  ...gap("file_ref", "pass", "fail", "att", { path: "/x.pdf", name: "x" }, { path: "/x.pdf", name: "x", type: "attachment", mime: "application/pdf", size: 1 }),
  ...coerced("att", ""),
  ...agree("fl", null, MISSING, ""),
  ...gap("file_upload", "pass", "fail", "fl", "str", {}, 1),
  // ── a dbLink's columns, as the request body ──
  ...agree(DBL, { name: "ok" }, { name: "" }, { name: "x" }, {}, { name: "ok", note: " abcd " }, { name: "ok", note: " abc " }),
  ...coerced(DBL, { name: "ok", qty: "5" }),
];

const show = (value: unknown): string => (value === MISSING ? "<omitted>" : JSON.stringify(value));

let backend: Backend | undefined;
let schemas: Record<string, Schema>;
let dir: string | undefined;

beforeAll(async () => {
  const { code } = await transform(await emittedRoutesFile(e2eWorkspace), { loader: "ts", format: "esm", target: "es2022" });
  dir = writeFiles(scratchDir("e2e-parity"), { "routes.gen.mjs": code });
  const manifest = (await import(pathToFileURL(join(dir, "routes.gen.mjs")).href)) as { ROUTE_SCHEMAS: Record<string, Schema> };
  schemas = manifest.ROUTE_SCHEMAS;
  backend = startBackend();
  console.log(`parity: ${CASES.length} cases against ${backend.label}`);
});

afterAll(() => {
  backend?.stop();
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

interface Verdict {
  readonly pass: boolean;
  readonly messages: string[];
}

interface SchemaVerdict extends Verdict {
  /** Whether every issue is this module's own, so its message is one the server would send. */
  readonly custom: boolean;
}

function fromSchema(route: string, body: unknown): SchemaVerdict {
  const schema = schemas[`POST ${route}`];
  if (schema === undefined) throw new Error(`no schema for POST ${route}`);
  const result = schema.safeParse(body);
  const issues = result.error?.issues ?? [];
  return { pass: result.success, messages: issues.map((i) => i.message), custom: issues.every((i) => i.code === "custom") };
}

async function fromServer(route: string, body: unknown): Promise<Verdict> {
  const res = await fetch(`${backend!.url}/api:e2e/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let message = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // Not JSON: the text is the message.
  }
  return { pass: res.ok, messages: res.ok ? [] : [`${res.status} ${message}`] };
}

describe("the parity fixture", () => {
  it("has at least one case for every declaration", () => {
    expect([...new Set(CASES.map((c) => c.route))].sort()).toEqual([...Object.keys(declarations), DBL].sort());
  });
});

describe("schema versus server", () => {
  for (const c of CASES) {
    const name = `${c.route} = ${show(c.value)}${c.diverges === undefined ? "" : `  (${c.diverges.why})`}`;
    it(name, async () => {
      const body = c.route === DBL ? c.value : c.value === MISSING ? {} : { v: c.value };
      const zod = fromSchema(c.route, body);
      const server = await fromServer(c.route, body);
      const detail = `\n  schema: ${zod.pass ? "pass" : zod.messages.join(" | ")}\n  server: ${server.pass ? "pass" : server.messages.join(" | ")}`;
      if (c.diverges === undefined) {
        expect(zod.pass, `verdicts differ${detail}`).toBe(server.pass);
        if (!zod.pass && zod.custom) {
          const serverMessage = server.messages[0]!.replace(/^\d{3} /, "");
          expect(zod.messages, `messages differ${detail}`).toContain(serverMessage);
        }
      } else {
        expect(zod.pass, `schema verdict moved: ${WHY[c.diverges.why]}${detail}`).toBe(c.diverges.zod === "pass");
        if (c.diverges.server !== "either") {
          expect(server.pass, `server verdict moved: ${WHY[c.diverges.why]}${detail}`).toBe(c.diverges.server === "pass");
        }
      }
    });
  }
});
