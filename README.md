# @xano-sdk/zod

Zod schemas for every endpoint, realtime channel and realtime message input in a
[Xano SDK](https://github.com/xano-sdk/sdk) project, generated into
`routes.gen.ts` beside the SDK's own input types and checked against them at
typecheck, so the schema and the type cannot drift.

> **Status: 1.0.x.** A toolchain module for the Xano SDK. Peers: `@xano/sdk`
> `>=1.0.6 <2.0.0` and `zod` `^4.0.0`. Built and tested against `@xano/sdk`
> 1.0.6 and `zod` 4.6.5.

## Use it

```bash
npx xanosdk marketplace install zod
```

That one command:

1. installs `@xano-sdk/zod`;
2. adds `zod` to the project as a direct dependency, with this module's range
   (`^4.0.0`), through the project's own package manager (npm, yarn, pnpm or
   bun). A `zod` the project already declares is left alone, with a warning if
   its installed version is outside `^4.0.0`;
3. records the module in the project's `package.json` `"xanosdk"` block;
4. regenerates `xano/routes.gen.ts`, if the project has one, so
   `npm run xano:check` is green straight after the install. A project with no
   `routes.gen.ts` yet gets the schemas on its first `npm run xano:routes`.

This is a toolchain module: it extends the CLI and adds nothing to the
workspace. There is nothing to register in `xano/index.ts`, and it asks no
questions.

From then on, every write of `routes.gen.ts` (`xanosdk routes --emit`,
`npm run xano:routes`, `pull`, `generate`) includes the schemas, and
`xanosdk routes --emit --strict` (`npm run xano:check`) fails when the committed
file is stale.

### Installing by hand

`npm install @xano-sdk/zod` works under npm 7+, which installs the `zod` peer
for you. **Under yarn or pnpm, add `zod` yourself** (`yarn add zod@^4.0.0`,
`pnpm add zod@^4.0.0`): yarn installs no peers, and pnpm does not link one where
`routes.gen.ts` can import it. `npx xanosdk marketplace reinstall @xano-sdk/zod`
adds it for you, the same way `install` does.

## What you get

`routes.gen.ts` already exports, for every project, the types-only input maps
`RouteInputs`, `ChannelInputs` and `MessageInputs`. With this module installed it
also exports one zod schema per key of each:

| Export | Keyed like | Validates |
| --- | --- | --- |
| `ROUTE_SCHEMAS` | `ROUTES` / `RouteInputs` (`"POST listings"`, `"v1:GET vehicles"`) | an endpoint's request inputs |
| `CHANNEL_SCHEMAS` | `CHANNELS` / `ChannelInputs` (`"rooms/{room_id}"`) | a realtime channel's path params |
| `MESSAGE_SCHEMAS` | `MessageInputs` (`"rooms/{room_id} send"`) | a realtime message's payload |

For an endpoint declared as

```ts
input: {
  title: input.text({ required: true, methods: ["max:80"] }),
  price: input.int({ required: true, methods: ["min:0"] }),
  tags: input.list(input.text(), { list: { max: 5 } }),
},
```

the module writes (helpers trimmed):

```ts
export const ROUTE_SCHEMAS = /* @__PURE__ */ (() => ({
  "POST listings": z.object({
    title: z.string().check(__zodText({ trim: true, max: 80 })),
    price: z.int().min(0),
    tags: z.array(z.string()).max(5).optional(),
  }),
}))();
```

and a frontend uses it like this:

```ts
import { ROUTES, ROUTE_SCHEMAS, routePath, type RouteInputs } from "../xano/routes.gen";

async function createListing(draft: unknown) {
  const body: RouteInputs["POST listings"] = ROUTE_SCHEMAS["POST listings"].parse(draft);
  return fetch(BASE + routePath("POST listings"), {
    method: ROUTES["POST listings"].verb,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

`parse` returns the value it was given, unchanged: a schema checks, it never
rewrites what you send.

Realtime is where this pays most. A message payload the server rejects is
delivered to nobody, and only the sender learns why. Check it before you send:

```ts
const send = MESSAGE_SCHEMAS["rooms/{room_id} send"].safeParse(payload);
if (!send.success) return showErrors(send.error.issues);
```

The file is still the SDK's. The module's part sits after the SDK's sections
between `// xanosdk:begin @xano-sdk/zod` and `// xanosdk:end @xano-sdk/zod`, with
a line naming the module version that wrote it. Edits inside the block are
overwritten on the next write. The file imports `z` from `zod` and never imports
`@xano/sdk`.

## The schemas cannot drift from the types

Both are generated from one input description that the SDK builds, and the
module also emits a type-level check, `__ZodSchemaChecks`, with one entry per
key. Each entry asserts that `z.output` of the schema and the core type for the
same key are the **same type**: each must be assignable to the other, after
removing the `| undefined` zod adds to an optional key, so the check holds with
and without `exactOptionalPropertyTypes`.

The check runs in both directions. A one-way check such as `satisfies` would pass
a schema that left out an optional key, and zod would then strip that key from
every body at parse. Here, a schema that is too strict, too loose, typed wrong or
missing a key fails the project's typecheck on the line for that key, and the
key set of each map must match its type's exactly.

The check is types only. It adds nothing to a bundle.

## Bundle cost

`routes.gen.ts` exists so a frontend can address the backend without the SDK's
runtime. This module keeps that true: each map is built inside a
`/* @__PURE__ */` factory and every helper is a pure top-level expression, so a
bundle that imports only `ROUTES`, `routePath` or the types contains no zod and
no schema. You pay for zod only in the bundles that use a schema.

## What a schema checks

A schema checks what the server checks, as the server checks it. Where a check
cannot be reproduced exactly, it is left to the server, because a guess could
reject a value the server would accept.

| Input | Schema |
| --- | --- |
| `text` | `z.string()`, plus the checks below |
| `email` | `z.string()` with the server's email format; the empty string passes, as it does on the server |
| `password` | `z.string()`, plus length and the strength counts below |
| `int` | `z.int()` with `min` / `max` as value bounds |
| `decimal` | `z.number()` with `min` / `max` as value bounds |
| `bool` | `z.boolean()` |
| `timestamp` | `z.number()` (epoch milliseconds) |
| `date` | `z.string()` |
| `uuid` | any 8-4-4-4-12 hex string, or `""` |
| `enum` | `z.enum([...])`, or `z.literal([...])` for numeric values |
| `json` | `z.unknown()` |
| `vector` | `z.array(z.number())` |
| `object` | a nested `z.object` of its fields |
| `tableRef` | the linked table's id: `z.int()`, or a uuid for a uuid table |
| `dbLink` | the linked table's columns, spread into the surrounding object (as the server expands them); an open object when the columns are unknown |
| `file` (upload) | any value except `null` / `undefined` |
| `image`, `video`, `audio`, `attachment` | an object of the stored file reference's optional members |
| geo types | `{ type, data }` with `{ lng, lat }` positions |

Across all of them: a list input becomes `z.array(...)` with its list `min` /
`max`; a nullable input adds `.nullable()` (to the list, not its elements); an
input that is not required adds `.optional()`. A required input with a default
stays required. There is no `.default()`, because the core type requires the key.

### Text checks

`min`, `max`, `startsWith`, `pattern`, the character whitelist (`alphaOk`,
`digitOk`, `ok`), `prevent`, and on a password `minAlpha`, `minLowerAlpha`,
`minUpperAlpha`, `minDigit` and `minSymbol` are checked, and they produce the
messages the server returns.

They run on the value **as the server measures it**. The server trims a text
input (unless `notrim`) and a password before checking, and case-folds a text
input with `lower` / `upper` before the whitelist, `prevent` and `pattern`. The
schema runs its checks on a trimmed, folded copy and leaves the value itself
alone, so `"  @abc  "` passes a `max:6` and is sent with its spaces.

### What a schema does not do

- **Transforms are not applied.** `trim`, `lower`, `upper` and a password's
  `salt` change the value, and the server applies them to what it receives. A
  client-side copy would change the payload, so the schema only uses them to
  decide how to check.
- **A pattern JavaScript reads differently is not checked.** Patterns are stored
  in the server's regex dialect (PCRE). One that uses only the syntax the two
  dialects share is translated and checked. One that uses `\A`, `\z`, `\h`,
  `\p{...}`, POSIX classes, inline flags, atomic groups, or a flag JavaScript has
  no equivalent for is skipped, and the server still checks it.
- **A vector's size is not enforced.** Any array of numbers passes.
- **A password's empty-value exception is not mirrored.** The server skips its
  password strength checks for `""` and `"0"`. The schema applies them, so with a
  strength rule set it rejects those two values.
- **Disabled methods and methods the module does not know produce no check.**

## When the module fails

If the module fails to load, or throws while writing its section, the SDK
refreshes its own sections anyway and keeps this module's previous block as it
was, with a `routes.module-failed` warning naming the module. A module that never
wrote a block contributes nothing that run. Under `routes --emit --strict`
(`npm run xano:check`), the same failure is fatal: a check must not pass on a
file it could not regenerate.

An SDK outside the peer range is refused by name before any schema is written.

## Removing it

```bash
npx xanosdk marketplace remove @xano-sdk/zod
```

This uninstalls the module, drops its config, and regenerates `routes.gen.ts`
without the block. `zod` stays a dependency of the project: the install added it,
but your own code may import it too. Remove it yourself if nothing else does.

## Read before production

- **The server is the authority.** A schema that passes is a strong hint, not a
  guarantee: skipped patterns, transforms and a few server-only rules are still
  checked only on the server. Handle a server rejection whether or not the
  schema passed.
- **Inputs only.** There are no response schemas. Response shapes exist only as
  TypeScript inference on defs, so use `InferResponse` on an `import type` of the
  def.
- **Commit `routes.gen.ts`, and pin one module version per project.** The block
  names the module version that wrote it. Two machines with different
  `@xano-sdk/zod` versions write different bytes, and `xano:check` reports drift.
  A lockfile keeps them the same.
- **`zod` must resolve where `routes.gen.ts` lives.** The file imports it. If
  `zod` is missing, the project's typecheck fails on that import.
- **The server's error messages, not zod's.** Text checks report the messages the
  server returns for the same failure, so a UI that shows server errors can show
  these the same way. Type failures (a number where a string belongs) use zod's
  own messages.

## Versioning

`@xano-sdk/zod` releases as `1.0.x`. The `@xano/sdk` peer floor is the first SDK
that lets a toolchain module add a section to `routes.gen.ts`, because on an
older SDK this module would load and do nothing. The ceiling is the SDK's next
major. The `zod` peer is zod 4's classic API; zod 3 and `zod/mini` are not
supported.

## For agents

[`llms.txt`](llms.txt), shipped in the package, is the same material for a
coding agent, with the constraints it must follow.

## Issues and source

Bugs and requests are welcome as
[issues](https://github.com/xano-sdk/zod/issues). A wrong schema is most useful
with the input declaration that produced it, the schema the module wrote, and
the value the server accepted or rejected.

## License

MIT
