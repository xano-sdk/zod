/**
 * The SDK's input description → this module's section of `routes.gen.ts`:
 * `ROUTE_SCHEMAS`, `CHANNEL_SCHEMAS` and `MESSAGE_SCHEMAS`, keyed exactly like
 * the core `RouteInputs`, `ChannelInputs` and `MessageInputs` types the section
 * lands beside, plus a type-level check that each schema's output IS its core
 * type.
 *
 * ── Why this mirrors the core type rendering rule for rule ──────────────────
 *
 * The SDK renders those types from the same description, and the emitted check
 * fails the user's typecheck on any entry where `z.output` of the schema is not
 * the same type as the core type. So every rule of the core
 * renderer has its twin here: `required` decides `.optional()`; a list's
 * `z.array` comes before `.nullable()` (a nullable list, never a list of
 * nullables); an optional key named after an `Object.prototype` member also
 * admits the inherited member; the SDK value types the file cannot import (file
 * refs, uploads, geo values) are written out structurally; a dbLink's columns
 * are spread into the surrounding object, a key reached twice is the union of
 * its declarations, and a dbLink whose columns are unknown leaves the object
 * open.
 *
 * ── What a schema checks ────────────────────────────────────────────────────
 *
 * What the engine checks, as the engine checks it; a check that cannot be
 * reproduced faithfully (a pattern in syntax JavaScript reads differently) is
 * left to the server rather than guessed at. Validating methods become checks; transforming methods (`trim`, `lower`, `upper`, `salt`) are
 * never applied to the value, because the server applies them to what it
 * receives and a client-side copy would change the payload. They still shape
 * the CHECKS: the engine trims a text input before measuring it and case-folds
 * it before matching a pattern, so the checks run on a normalized copy of the
 * value, never on the value itself.
 *
 * ── Bundle cost ─────────────────────────────────────────────────────────────
 *
 * `routes.gen.ts` exists so a frontend can address the backend without paying
 * for a runtime. Each map is built inside a `@__PURE__` factory and every helper
 * is a pure top-level expression, so a bundle that imports only `ROUTES` or
 * `routePath` drops zod and every schema.
 */
import type { InputDescription, InputMethod, RouteInputSet, RouteInputs, RoutesManifestSection } from "./plugin.js";

/**
 * `Object.prototype`'s members, as the core renderer lists them. An optional
 * key with one of these names is widened by the core type, and must be here:
 * zod reads an absent key off the object, which for these names finds the
 * inherited member, so a plain `{}` would otherwise fail the key's schema.
 */
const OBJECT_MEMBERS: ReadonlySet<string> = new Set([
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
]);

/**
 * A stored file reference, member for member as the core type writes it. Closed
 * like that type, so parsing keeps exactly the members it lists.
 */
const FILE_REF =
  "z.object({ path: z.string().optional(), name: z.string().optional(), type: z.string().optional(), " +
  "size: z.number().optional(), access: z.string().optional(), meta: z.unknown().optional(), url: z.string().optional() })";

/** A file upload: the core type is an opaque marker, so anything but a missing value passes. */
const FILE_UPLOAD = `z.custom<{ readonly __fileUpload?: never }>((v) => v !== undefined && v !== null, "Expected a file")`;

const POSITION = "z.object({ lng: z.number(), lat: z.number() })";

/** Each stored geo type: its `type` name and its `data` nesting. */
const GEO: Readonly<Record<string, string>> = {
  geo_point: `z.object({ type: z.literal("point"), data: ${POSITION} })`,
  geo_multipoint: `z.object({ type: z.literal("points"), data: z.array(${POSITION}) })`,
  geo_linestring: `z.object({ type: z.literal("path"), data: z.array(${POSITION}) })`,
  geo_multilinestring: `z.object({ type: z.literal("paths"), data: z.array(z.array(${POSITION})) })`,
  geo_polygon: `z.object({ type: z.literal("poly"), data: z.array(${POSITION}) })`,
  geo_multipolygon: `z.object({ type: z.literal("polys"), data: z.array(z.array(${POSITION})) })`,
};

/**
 * A uuid as the engine accepts it: any 8-4-4-4-12 hex string, whatever its
 * version bits (`z.uuid()` would refuse some), or the empty string, which the
 * engine binds as the nil uuid.
 */
const UUID = 'z.guid().or(z.literal(""))';

/** Scalar types with no methods the engine checks. */
const PLAIN: Readonly<Record<string, string>> = {
  date: "z.string()",
  epochms: "z.number()",
  bool: "z.boolean()",
  json: "z.unknown()",
  uuid: UUID,
  file: FILE_UPLOAD,
  blob: FILE_REF,
  blob_img: FILE_REF,
  blob_video: FILE_REF,
  blob_audio: FILE_REF,
  ...GEO,
};

/** A property name: bare when it is an identifier, else a string literal. */
function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** A method's first argument as a finite number, or undefined. */
function numericArg(method: InputMethod): number | undefined {
  const raw = method.args[0];
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patterns: PCRE as stored → a JavaScript regular expression, or nothing
// ─────────────────────────────────────────────────────────────────────────────

/** The closing delimiter for each bracket-style PCRE delimiter. */
const BRACKETS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}", "<": ">" };

/**
 * PCRE flags with a JavaScript equivalent. `D` (dollar matches only at the very
 * end) and `S` (study) need none: the first is how `$` already behaves, the
 * second changes no match.
 */
const FLAGS: Readonly<Record<string, string>> = { i: "i", m: "m", s: "s", u: "u", D: "", S: "" };

/**
 * Letter escapes that mean the same thing in PCRE and in a JavaScript regex.
 * Not `\v`: PCRE reads it as any vertical whitespace, JavaScript as one character.
 */
const SAME_ESCAPES = new Set(["d", "D", "w", "W", "s", "S", "b", "B", "n", "r", "t", "f"]);

/**
 * A stored pattern as a JavaScript regex literal that matches what the engine's
 * PCRE matches, or `undefined` when no such literal can be written with
 * confidence. An undefined pattern is not checked client-side at all: the
 * server still checks it, and a guess could refuse a value the server accepts.
 *
 * The engine takes the pattern as delimited PCRE (`/^a+$/i`) and, when it does
 * not compile that way, wraps it in `#` (`^a+$` → `#^a+$#`). Accepted: the
 * syntax the two dialects share — classes, the common escapes, groups,
 * lookaround, backreferences, named groups. Refused: any other letter escape
 * (`\A`, `\z`, `\h`, `\p`, `\Q`...), POSIX classes, inline flags, atomic and
 * other PCRE-only groups, and flags with no JavaScript counterpart (`x`, `U`,
 * `A`...). Whatever is accepted is then compiled here, so a pattern JavaScript
 * rejects is refused too.
 */
export function pcreToRegex(stored: string): string | undefined {
  if (stored === "") return undefined;
  let body = stored;
  let pcreFlags = "";
  const open = stored[0]!;
  if (!/[A-Za-z0-9\\\s]/.test(open)) {
    const close = BRACKETS[open] ?? open;
    const end = stored.lastIndexOf(close);
    if (end > 0 && /^[A-Za-z]*$/.test(stored.slice(end + 1))) {
      body = stored.slice(1, end);
      pcreFlags = stored.slice(end + 1);
    }
  }
  let flags = "";
  for (const f of pcreFlags) {
    const js = FLAGS[f];
    if (js === undefined) return undefined;
    if (!flags.includes(js)) flags += js;
  }

  let source = "";
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "\\") {
      const next = body[i + 1];
      if (next === undefined) return undefined;
      if (/[A-Za-z]/.test(next)) {
        if (next === "x" && /^[0-9A-Fa-f]{2}$/.test(body.slice(i + 2, i + 4))) {
          source += body.slice(i, i + 4);
          i += 3;
          continue;
        }
        if (next === "c" && /[A-Za-z]/.test(body[i + 2] ?? "")) {
          source += body.slice(i, i + 3);
          i += 2;
          continue;
        }
        if (!SAME_ESCAPES.has(next)) return undefined;
      } else if (/[0-9]/.test(next)) {
        // A single-digit backreference outside a class; octal and multi-digit forms differ.
        if (inClass || next === "0" || /[0-9]/.test(body[i + 2] ?? "")) return undefined;
      }
      source += c + next;
      i++;
      continue;
    }
    if (inClass) {
      if (c === "[" && body[i + 1] === ":") return undefined;
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
      // A leading `]` (or `^]`) is a literal in PCRE and closes the class in JavaScript.
      const lead = body[i + 1] === "^" ? body[i + 2] : body[i + 1];
      if (lead === "]") return undefined;
    } else if (c === "(" && body[i + 1] === "?") {
      const after = body.slice(i + 2);
      if (!/^(?::|=|!|<=|<!|<[A-Za-z])/.test(after)) return undefined;
    }
    if (c === "/") source += "\\/";
    else if (c === "\n") source += "\\n";
    else if (c === "\r") source += "\\r";
    else if (c === " ") source += "\\u2028";
    else if (c === " ") source += "\\u2029";
    else source += c;
  }
  try {
    new RegExp(source, flags);
  } catch {
    return undefined;
  }
  return `/${source}/${flags}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text, email and password checks
// ─────────────────────────────────────────────────────────────────────────────

/** Which helper declarations the rendered section uses. */
interface Uses {
  text: boolean;
}

/**
 * The engine's checks on a text-family input, as the emitted `__zodText` rules
 * literal's members, in the helper's order. Empty when nothing is checked.
 */
function textRules(type: "text" | "email" | "password", methods: readonly InputMethod[]): string[] {
  const has = (name: string): boolean => methods.some((m) => m.name === name);
  // The engine trims a text input unless told not to, a password always, an email only when told to.
  const trim = type === "password" || (type === "text" ? !has("notrim") || has("trim") : has("trim"));

  if (type === "email") {
    // The engine's email input accepts the empty string, and checks the format of anything else.
    return [...(trim ? ["trim: true"] : []), "email: true"];
  }

  let fold: string | undefined;
  let ok = "";
  const prevent: string[] = [];
  let pattern: string | undefined;
  let patternError = "";
  const atLeast: string[] = [];
  let min: number | undefined;
  let max: number | undefined;
  let startsWith: string | undefined;
  for (const m of methods) {
    const arg = m.args[0] ?? "";
    switch (m.name) {
      case "min":
        min = numericArg(m) ?? min;
        break;
      case "max":
        max = numericArg(m) ?? max;
        break;
      case "startsWith":
        // The engine skips an empty prefix, and reads "0" as empty.
        if (type === "text" && arg !== "" && arg !== "0") startsWith = arg;
        break;
      // The engine lowercases, then uppercases: with both set, upper wins.
      case "lower":
        if (type === "text" && fold !== '"upper"') fold = '"lower"';
        break;
      case "upper":
        if (type === "text") fold = '"upper"';
        break;
      case "alphaOk":
        if (type === "text") ok += "abcdefghijklmnopqrstuvwxyz";
        break;
      case "digitOk":
        if (type === "text") ok += "0123456789";
        break;
      case "ok":
        if (type === "text") ok += arg;
        break;
      case "prevent":
        if (type === "text" && arg !== "") prevent.push(arg);
        break;
      case "pattern":
        if (type === "text") {
          pattern = pcreToRegex(arg);
          patternError = m.args[1]?.trim() ?? "";
        }
        break;
      case "minAlpha":
      case "minLowerAlpha":
      case "minUpperAlpha":
      case "minDigit":
      case "minSymbol": {
        const n = numericArg(m);
        if (type === "password" && n !== undefined && n > 0) atLeast.push(PASSWORD_CLASSES[m.name]!(n));
        break;
      }
      // trim, notrim (read above), salt, and anything unknown: nothing to check.
    }
  }
  const checks = [
    ...(min !== undefined ? [`min: ${min}`] : []),
    ...(max !== undefined ? [`max: ${max}`] : []),
    ...(startsWith !== undefined ? [`startsWith: ${JSON.stringify(startsWith)}`] : []),
    ...(ok !== "" ? [`ok: ${JSON.stringify(ok)}`] : []),
    ...(prevent.length > 0 ? [`prevent: ${JSON.stringify(prevent)}`] : []),
    ...(pattern !== undefined ? [`pattern: ${pattern}`, ...(patternError !== "" ? [`patternError: ${JSON.stringify(patternError)}`] : [])] : []),
    ...(atLeast.length > 0 ? [`atLeast: [${atLeast.join(", ")}]`] : []),
  ];
  if (checks.length === 0) return [];
  // A fold only matters to the checks that run after it.
  const folds = fold !== undefined && (ok !== "" || prevent.length > 0 || pattern !== undefined);
  return [...(trim ? ["trim: true"] : []), ...(folds ? [`fold: ${fold}`] : []), ...checks];
}

/**
 * The engine's password strength counts, one regex each over ASCII classes
 * (the engine counts ASCII characters only).
 */
const PASSWORD_CLASSES: Readonly<Record<string, (n: number) => string>> = {
  minAlpha: (n) => `[/[A-Za-z]/g, ${n}, "letters"]`,
  minLowerAlpha: (n) => `[/[a-z]/g, ${n}, "lowercase letters"]`,
  minUpperAlpha: (n) => `[/[A-Z]/g, ${n}, "uppercase letters"]`,
  minDigit: (n) => `[/[0-9]/g, ${n}, "numbers"]`,
  minSymbol: (n) => `[/[!-\\/:-@[-\`{-~]/g, ${n}, "punctuation symbols"]`,
};

/**
 * The helper every checked text-family input calls. Emitted once, and only when
 * some input uses it. A pure top-level arrow, so a bundle that never touches a
 * schema drops it.
 */
const TEXT_HELPER = `/**
 * The engine's checks on a text, email or password input, run on the value as
 * the engine checks it — trimmed of the six characters the engine trims (space,
 * tab, newline, carriage return, NUL, vertical tab), and case-folded (ASCII
 * only) before a whitelist, blocked phrase or pattern — while
 * the value itself is left exactly as it will be sent.
 */
const __zodText =
  (rules: {
    readonly trim?: boolean;
    readonly fold?: "lower" | "upper";
    readonly email?: boolean;
    readonly min?: number;
    readonly max?: number;
    readonly startsWith?: string;
    readonly ok?: string;
    readonly prevent?: readonly string[];
    readonly pattern?: RegExp;
    readonly patternError?: string;
    readonly atLeast?: readonly (readonly [RegExp, number, string])[];
  }) =>
  (ctx: z.core.ParsePayload<string>): void => {
    const fail = (message: string): void => {
      ctx.issues.push({ code: "custom", message, input: ctx.value });
    };
    const lower = (s: string): string => s.replace(/[A-Z]+/g, (c) => c.toLowerCase());
    let v = rules.trim === true ? ctx.value.replace(/^[ \\t\\n\\r\\0\\x0B]+|[ \\t\\n\\r\\0\\x0B]+$/g, "") : ctx.value;
    if (rules.email === true) {
      if (v !== "" && !/^[a-zA-Z0-9.!#$%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(v)) {
        fail("Invalid email format.");
      }
      return;
    }
    const length = [...v].length;
    if (rules.min !== undefined && length < rules.min) fail(\`Input does not meet minimum length requirement of \${rules.min} characters\`);
    if (rules.max !== undefined && length > rules.max) fail(\`Input does not meet maximum length requirement of \${rules.max} characters\`);
    if (rules.startsWith !== undefined && !v.startsWith(rules.startsWith)) fail(\`Invalid format detected. Expected \${rules.startsWith}\`);
    if (rules.fold === "lower") v = lower(v);
    if (rules.fold === "upper") v = v.replace(/[a-z]+/g, (c) => c.toUpperCase());
    if (rules.ok !== undefined) {
      const ok = lower(rules.ok);
      if ([...v].some((c) => !ok.includes(lower(c)))) fail("Invalid characters detected.");
    }
    if (rules.prevent?.some((phrase) => v.includes(phrase)) === true) fail("Invalid characters detected.");
    if (rules.pattern !== undefined && !rules.pattern.test(v)) fail(rules.patternError ?? "Invalid pattern.");
    for (const [re, n, what] of rules.atLeast ?? []) {
      if ((v.match(re)?.length ?? 0) < n) fail(\`Weak password detected. Please use at least \${n} \${what}.\`);
    }
  };
`;

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

type ValueInput = Exclude<InputDescription, { type: "dbLink" }>;

/** `.min(n)`/`.max(n)` for each numeric bound method, in stored order. */
function numberBounds(d: ValueInput): string {
  let out = "";
  for (const m of d.methods) {
    if (m.name !== "min" && m.name !== "max") continue;
    const n = numericArg(m);
    if (n !== undefined) out += `.${m.name}(${n})`;
  }
  return out;
}

/** One value, before its list and nullable flags: the base type and its checks. */
function baseSchema(d: ValueInput, indent: string, uses: Uses): string {
  switch (d.type) {
    case "text":
    case "email":
    case "password": {
      const rules = textRules(d.type, d.methods);
      if (rules.length === 0) return "z.string()";
      uses.text = true;
      return `z.string().check(__zodText({ ${rules.join(", ")} }))`;
    }
    case "int":
      return `z.int()${numberBounds(d)}`;
    case "decimal":
      return `z.number()${numberBounds(d)}`;
    case "enum":
      if (d.values.length === 0) return "z.never()";
      if (d.values.every((v) => typeof v === "string")) return `z.enum(${JSON.stringify(d.values)})`;
      return `z.literal([${d.values.map((v) => (typeof v === "number" ? String(v) : JSON.stringify(v))).join(", ")}])`;
    case "vector":
      return "z.array(z.number())";
    case "tableRef":
      return d.keyType === "uuid" ? UUID : `z.int()${numberBounds(d)}`;
    case "obj":
      return objectSchema(d.children, indent, uses);
    case "unknown":
      return "z.unknown()";
    default:
      return PLAIN[d.type] ?? "z.unknown()";
  }
}

/** One input's full value schema: base, then `z.array` for a list, then `.nullable()`. */
function valueSchema(d: ValueInput, indent: string, uses: Uses): string {
  let schema = baseSchema(d, indent, uses);
  if (d.list !== false) {
    schema = `z.array(${schema})`;
    if (d.list.min !== undefined) schema += `.min(${d.list.min})`;
    if (d.list.max !== undefined) schema += `.max(${d.list.max})`;
  }
  // The core type writes `unknown | null` as `unknown`; so does this.
  const unknownBase = d.list === false && (d.type === "json" || d.type === "unknown");
  if (d.nullable && !unknownBase) schema += ".nullable()";
  return schema;
}

/**
 * The object schema of one input list, at `indent`.
 *
 * A dbLink contributes its columns as keys of THIS object, because the engine
 * expands the link at the level it is declared on; a dbLink whose columns are
 * unknown leaves the object open. A key reached twice renders once, as the
 * union of its schemas, required only when every declaration is.
 */
function objectSchema(inputs: readonly InputDescription[], indent: string, uses: Uses): string {
  const keys = new Map<string, { schemas: string[]; required: boolean }>();
  let open = false;
  const inner = `${indent}  `;
  const visit = (list: readonly InputDescription[]): void => {
    for (const d of list) {
      if (d.type === "dbLink") {
        if (d.columns === undefined) open = true;
        else visit(d.columns);
        continue;
      }
      const schema = valueSchema(d, inner, uses);
      const seen = keys.get(d.name);
      if (seen === undefined) {
        keys.set(d.name, { schemas: [schema], required: d.required });
      } else {
        if (!seen.schemas.includes(schema)) seen.schemas.push(schema);
        seen.required &&= d.required;
      }
    }
  };
  visit(inputs);

  const rows = [...keys].map(([name, { schemas, required }]) => {
    // An absent optional key named after an Object.prototype member reads as
    // the inherited member, which the core type admits and so must this.
    const all =
      !required && OBJECT_MEMBERS.has(name)
        ? [...schemas, `z.custom<Object[${JSON.stringify(name)}]>((v) => v === Object.prototype[${JSON.stringify(name)}])`]
        : schemas;
    const schema = all.length === 1 ? all[0]! : `z.union([${all.join(", ")}])`;
    return `${inner}${propertyName(name)}: ${schema}${required ? "" : ".optional()"},`;
  });
  const factory = open ? "z.looseObject" : "z.object";
  return rows.length === 0 ? `${factory}({})` : `${factory}({\n${rows.join("\n")}\n${indent}})`;
}

/** One exported map, built inside a pure factory so an unused map costs a bundle nothing. */
function schemaMap(name: string, doc: string, sets: readonly RouteInputSet[], uses: Uses): string {
  const rows = sets.map((set) => `  ${JSON.stringify(set.key)}: ${objectSchema(set.inputs, "  ", uses)},`);
  const body = rows.length === 0 ? "{}" : `{\n${rows.join("\n")}\n}`;
  return `${doc}\nexport const ${name} = /* @__PURE__ */ (() => (${body}))();\n`;
}

/** The per-key assertions for one map against its core type. */
function checks(map: string, core: string, sets: readonly RouteInputSet[]): string[] {
  return [
    `  __ZodExpect<${JSON.stringify(`keys of ${map}`)}, __ZodSame<keyof typeof ${map}, keyof ${core}>>,`,
    ...sets.map((set) => {
      const key = JSON.stringify(set.key);
      return `  __ZodExpect<${key}, __ZodSame<z.output<(typeof ${map})[${key}]>, ${core}[${key}]>>,`;
    }),
  ];
}

/**
 * This module's section of `routes.gen.ts` for one input description: the three
 * schema maps and the type-level check that binds each entry to its core type.
 * Pure: the same description renders the same text.
 */
export function renderZodSection(inputs: RouteInputs): RoutesManifestSection {
  const uses: Uses = { text: false };
  const maps = [
    schemaMap(
      "ROUTE_SCHEMAS",
      `/**
 * A zod schema for the request inputs of every endpoint, keyed exactly like
 * ROUTES. z.output of each schema is RouteInputs[key], checked below.
 */`,
      inputs.routes,
      uses,
    ),
    schemaMap(
      "CHANNEL_SCHEMAS",
      "/** A zod schema for the path params of every realtime channel, keyed exactly like CHANNELS. */",
      inputs.channels,
      uses,
    ),
    schemaMap(
      "MESSAGE_SCHEMAS",
      `/**
 * A zod schema for the payload of every realtime message, keyed
 * "<channel key> <message name>" like MessageInputs.
 */`,
      inputs.messages,
      uses,
    ),
  ];

  const source = `${uses.text ? `${TEXT_HELPER}\n` : ""}${maps.join("\n")}
/**
 * The check that each schema above and the type for its key are the same type,
 * after removing the \`| undefined\` zod adds to an optional key (so it holds
 * with and without exactOptionalPropertyTypes) and reading zod's empty object
 * (\`Record<string, never>\`) as the core's \`{}\`. Identity, not assignability:
 * types that are assignable both ways can still differ by an optional key, and
 * a schema missing one would strip it at parse. An entry that disagrees fails
 * typecheck on its own line. Types only.
 */
type __ZodExact<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Record<string, never>
    ? {}
    : T extends object
      ? { [K in keyof T]: __ZodExact<Exclude<T[K], undefined>> }
      : T;
type __ZodSame<A, B> =
  (<T>() => T extends __ZodExact<A> ? 1 : 2) extends <T>() => T extends __ZodExact<B> ? 1 : 2 ? true : false;
type __ZodExpect<_Key extends string, _Same extends true> = _Same;
export type __ZodSchemaChecks = [
${[
  ...checks("ROUTE_SCHEMAS", "RouteInputs", inputs.routes),
  ...checks("CHANNEL_SCHEMAS", "ChannelInputs", inputs.channels),
  ...checks("MESSAGE_SCHEMAS", "MessageInputs", inputs.messages),
].join("\n")}
];`;

  return { imports: [{ from: "zod", names: ["z"] }], source };
}
