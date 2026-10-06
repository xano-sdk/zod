/**
 * The workspace the parity suite deploys and probes.
 *
 * One endpoint per input declaration, each with a single input named `v` that
 * the endpoint echoes back, so every verdict the server returns is attributable
 * to that one declaration: the server stops at its first failing input, and an
 * endpoint with several inputs would answer for whichever failed first. The
 * declarations cover every input type the module renders, each flag, and every
 * method it maps or deliberately leaves to the server. A key is the endpoint's
 * name: `POST <key>` is its route and `/api:e2e/<key>` its path.
 *
 * This file is also the entry the suite deploys, so it exports the workspace
 * as its default and imports nothing but the SDK.
 */
import { apiGroup, c, f, input, inp, query, table, workspace } from "@xano/sdk";
import type { InputDescriptor, MethodArg, TextMethod } from "@xano/sdk";

/** Text methods the authoring types do not list but a stored workspace carries (`notrim`, `prevent`). */
const stored = (...methods: string[]): MethodArg<TextMethod>[] => methods as MethodArg<TextMethod>[];

export const api = apiGroup({ name: "e2e", canonical: "e2e" });

export const things = table({
  name: "things",
  schema: { name: f.text({ required: true, methods: ["min:2"] }), qty: f.int(), note: f.text({ methods: ["trim", "max:3"] }) },
});

/** A table with a uuid primary key, for the uuid-keyed tableRef declarations. */
export const docs = table({ name: "docs", idType: "uuid", schema: { title: f.text() } });

/** Every declaration under test, by endpoint name. */
export const declarations: Readonly<Record<string, InputDescriptor>> = {
  // ── text: flags ──
  t_req: input.text({ required: true }),
  t_opt: input.text(),
  t_null: input.text({ nullable: true }),
  t_def: input.text({ required: true, default: "dflt" }),
  t_opt_def: input.text({ default: "hi" }),
  // ── text: trim and the length bounds ──
  t_min: input.text({ methods: ["min:3"] }),
  t_req_min: input.text({ required: true, methods: ["min:3"] }),
  t_null_min: input.text({ nullable: true, methods: ["min:3"] }),
  t_def_min: input.text({ default: "hello", methods: ["min:3"] }),
  t_def_short: input.text({ default: "x", methods: ["min:3"] }),
  t_trim_min: input.text({ methods: ["trim", "min:3"] }),
  t_min_trim: input.text({ methods: ["min:3", "trim"] }),
  t_max: input.text({ methods: ["max:3"] }),
  t_trim_max: input.text({ methods: ["trim", "max:3"] }),
  t_notrim_max: input.text({ methods: stored("notrim", "max:3") }),
  t_trim_notrim_max: input.text({ methods: stored("trim", "notrim", "max:3") }),
  t_notrim_trim_max: input.text({ methods: stored("notrim", "trim", "max:3") }),
  t_req_trim: input.text({ required: true, methods: ["trim"] }),
  t_lower_max: input.text({ methods: ["lower", "max:3"] }),
  // ── text: startsWith, before the case fold whatever the order ──
  t_sw: input.text({ methods: ["startsWith:@"] }),
  t_req_sw: input.text({ required: true, methods: ["startsWith:@"] }),
  t_trim_sw: input.text({ methods: ["trim", "startsWith:@"] }),
  t_sw_min: input.text({ methods: ["startsWith:@", "min:3"] }),
  t_upper_sw: input.text({ methods: ["upper", "startsWith:AB"] }),
  t_sw_upper: input.text({ methods: ["startsWith:AB", "upper"] }),
  // ── text: the whitelist and blocked phrases ──
  t_alpha: input.text({ methods: ["alphaOk"] }),
  t_digit_ok: input.text({ methods: ["digitOk", "ok:-"] }),
  t_ok_upper: input.text({ methods: ["ok:ABC"] }),
  t_prevent: input.text({ methods: stored("prevent:admin") }),
  t_lower_prevent: input.text({ methods: stored("lower", "prevent:admin") }),
  // ── text: patterns (stored with their error text; see t_pat_single for one without) ──
  t_pat_err: input.text({ methods: [{ name: "pattern", arg: ["^[a-z]+$", "letters only please"] }] }),
  t_pat_noerr: input.text({ methods: [{ name: "pattern", arg: ["^[a-z]+$", ""] }] }),
  t_req_pat: input.text({ required: true, methods: [{ name: "pattern", arg: ["^[a-z]+$", "letters only"] }] }),
  t_lower_pat: input.text({ methods: ["lower", { name: "pattern", arg: ["^[a-z]+$", ""] }] }),
  t_pat_lower: input.text({ methods: [{ name: "pattern", arg: ["^[a-z]+$", ""] }, "lower"] }),
  t_pat_i: input.text({ methods: [{ name: "pattern", arg: ["/^abc$/i", ""] }] }),
  t_pat_two: input.text({ methods: [{ name: "pattern", arg: ["/^.{2}$/", ""] }] }),
  t_pat_two_u: input.text({ methods: [{ name: "pattern", arg: ["/^.{2}$/u", ""] }] }),
  t_pat_nonspace: input.text({ methods: [{ name: "pattern", arg: ["/^\\S+$/", ""] }] }),
  t_pat_space: input.text({ methods: [{ name: "pattern", arg: ["/^\\s$/", ""] }] }),
  t_pat_word: input.text({ methods: [{ name: "pattern", arg: ["/^\\w+$/", ""] }] }),
  t_pat_fold: input.text({ methods: [{ name: "pattern", arg: ["/^\u00e9$/i", ""] }] }),
  t_pat_dot: input.text({ methods: [{ name: "pattern", arg: ["/^.$/", ""] }] }),
  t_pat_dot_s: input.text({ methods: [{ name: "pattern", arg: ["/^.$/s", ""] }] }),
  t_pat_end: input.text({ methods: [{ name: "pattern", arg: ["/^a$/", ""] }] }),
  t_pat_end_d: input.text({ methods: [{ name: "pattern", arg: ["/^a$/D", ""] }] }),
  t_pat_multi: input.text({ methods: [{ name: "pattern", arg: ["/^b$/m", ""] }] }),
  t_pat_multi_empty: input.text({ methods: [{ name: "pattern", arg: ["/^x?$/m", ""] }] }),
  t_pat_space_u: input.text({ methods: [{ name: "pattern", arg: ["/^\\s$/u", ""] }] }),
  t_pat_nonspace_u: input.text({ methods: [{ name: "pattern", arg: ["/^\\S+$/u", ""] }] }),
  t_pat_word_u: input.text({ methods: [{ name: "pattern", arg: ["/^\\w+$/u", ""] }] }),
  t_pat_digit_u: input.text({ methods: [{ name: "pattern", arg: ["/^\\d+$/u", ""] }] }),
  t_pat_single: input.text({ methods: ["pattern:^[a-z]+$"] }),
  // ── text: lists ──
  t_list: input.list(input.text({ methods: ["min:2"] }), { list: { min: 1, max: 2 } }),
  t_list_req: input.list(input.text(), { required: true }),
  t_list_opt: input.list(input.text()),
  t_list_trim: input.list(input.text({ methods: ["trim", "min:2"] })),
  t_list_max: input.list(input.text(), { list: { max: 2 } }),
  l_null_min: input.list(input.int(), { nullable: true, list: { min: 1 } }),
  // ── email ──
  e_req: input.email({ required: true }),
  e_opt: input.email(),
  e_lower: input.email({ methods: ["lower"] }),
  e_null: input.email({ nullable: true }),
  e_list: input.list(input.email()),
  // ── password ──
  p_req: input.password({ required: true }),
  p_opt: input.password(),
  p_min: input.password({ methods: ["min:8"] }),
  p_req_min: input.password({ required: true, methods: ["min:8"] }),
  p_max: input.password({ methods: ["max:10"] }),
  p_policy: input.password({ methods: ["minAlpha:2", "minLowerAlpha:1", "minUpperAlpha:1", "minDigit:1", "minSymbol:1"] }),
  p_salt: input.password({ methods: ["salt:abc"] }),
  // ── numbers ──
  i_req: input.int({ required: true }),
  i_opt: input.int(),
  i_null: input.int({ nullable: true }),
  i_bounds: input.int({ methods: ["min:0", "max:10"] }),
  i_min1: input.int({ methods: ["min:1"] }),
  i_max_neg: input.int({ methods: ["max:-1"] }),
  i_null_min: input.int({ nullable: true, methods: ["min:1"] }),
  i_def_min: input.int({ default: 5, methods: ["min:1"] }),
  d_req: input.decimal({ required: true }),
  d_bounds: input.decimal({ methods: ["min:0", "max:1"] }),
  d_min: input.decimal({ methods: ["min:0.5"] }),
  d_null: input.decimal({ nullable: true }),
  i_list: input.list(input.int(), { list: { min: 1, max: 2 } }),
  i_list_opt: input.list(input.int()),
  v3: input.vector(3),
  r_int: input.tableRef(things),
  r_bounds: input.tableRef(things, { methods: ["min:1"] }),
  r_req: input.tableRef(things, { required: true }),
  ru_opt: input.tableRef(docs),
  ru_req: input.tableRef(docs, { required: true }),
  // ── the rest of the scalars ──
  b_req: input.bool({ required: true }),
  b_opt: input.bool(),
  u_req: input.uuid({ required: true }),
  u_opt: input.uuid(),
  u_strict: input.uuid({ nullable: false }),
  dt_req: input.date({ required: true }),
  dt_opt: input.date(),
  ts_req: input.timestamp({ required: true }),
  ts_opt: input.timestamp(),
  j_req: input.json({ required: true }),
  j_opt: input.json(),
  en_req: input.enum(["a", "b"], { required: true }),
  en_opt: input.enum(["a", "b"]),
  en_num: input.enum([1, 2]),
  en_empty: input.enum([]),
  // ── objects ──
  o_req: input.object({ s: f.text({ required: true, methods: ["min:2"] }), n: f.int(), t: f.text({ methods: ["trim", "max:3"] }) }, { required: true }),
  o_opt: input.object({ s: f.text() }),
  o_min: input.object({ mm: f.text({ methods: ["min:3"] }) }),
  o_opt_req_child: input.object({ s: f.text({ required: true }) }),
  o_null_min: input.object({ mm: f.text({ methods: ["min:3"] }) }, { nullable: true }),
  // ── files ──
  img: input.image(),
  att: input.attachment(),
  fl: input.file(),
};

const endpoints = Object.entries(declarations).map(([name, v]) =>
  query({
    name,
    verb: "POST",
    apiGroup: api,
    input: { v },
    stack: [],
    // A password binds as its hash, which is nothing to echo.
    response: name.startsWith("p_") ? { ok: c.bool(true) } : { v: inp("v") },
  }),
);

/** The endpoint whose request is a dbLink's expanded columns rather than `v`. */
export const DBL = "dbl";

/** A dbLink beside nothing: the linked table's columns are the request. */
export const dbl = query({
  name: DBL,
  verb: "POST",
  apiGroup: api,
  input: { things__: input.dbLink(things) },
  stack: [],
  response: { name: inp("name"), qty: inp("qty"), note: inp("note") },
});

export default workspace("zod-e2e")
  .registerTables([things, docs])
  .registerApiGroups([api])
  .registerQueries([...endpoints, dbl]);
