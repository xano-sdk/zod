# AGENTS.md — `@xano-sdk/zod`

For working ON this repo. If you are an agent USING the published package, read
`llms.txt` instead. This file is not in the npm tarball.

## What this is

A Xano SDK **toolchain module**. The SDK's `routes.gen.ts` writer hands it a
description of every endpoint, channel and message input (the same description
the SDK renders `RouteInputs` / `ChannelInputs` / `MessageInputs` from), and it
returns a block of TypeScript: `ROUTE_SCHEMAS`, `CHANNEL_SCHEMAS`,
`MESSAGE_SCHEMAS` and the `__ZodSchemaChecks` type that binds each schema to its
core type. The SDK composes that block into the file.

There is no runtime. The module turns a description into text; it never imports
zod and never imports `@xano/sdk` as a value. It registers nothing, asks no
questions, and adds nothing to the workspace.

This is a single public repo (`xano-sdk/zod`). Unlike the XanoScript module it
vendors no engine source, so there is no private twin and no public mirror.
Everything committed here is public.

## Commands

```bash
npm run build       # tsup → dist/index.js, dist/plugin.js (+ .d.ts)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm test            # vitest run
npm pack --dry-run  # the tarball: dist/, README.md, llms.txt, LICENSE, package.json
```

Before committing: `npm run typecheck && npm run lint && npm test`.

**The emitted-file suites need an SDK with the `routesManifest` hook** (see
"The SDK-pipeline helper" below). Until that SDK is on npm, install it from a
tarball built in `sdk-dev`:

```bash
(cd ../sdk-dev && npm run build && npm pack --pack-destination /tmp/sdk-pack)
npm install --no-save /tmp/sdk-pack/xano-sdk-<version>.tgz
```

`--no-save` keeps `package.json` and the lockfile on the published pin. A later
plain `npm install` or `npm ci` puts the published SDK back, and those suites
then fail by name.

## Layout

- `src/plugin.ts`: the default-exported `ToolchainPlugin` the SDK loads
  (`"xanosdk": { "kind": "toolchain", "plugin": "./dist/plugin.js" }`), the peer
  range and its backstop check. The only file that names `@xano/sdk`, and only
  through `import type`.
- `src/render.ts`: input description → section text. Every mapping decision is
  here.
- `src/index.ts`: the direct entry, re-exporting `renderZodSection` and
  `PEER_RANGE` for code and tests that skip the loader.
- `test/render.test.ts`: one expression per input type, method and flag, and
  the PCRE translation.
- `test/emitted-typecheck.test.ts`, `test/emitted-runtime.test.ts`,
  `test/emitted-bundle.test.ts`: a REAL `routes.gen.ts`, rendered through the
  installed SDK from `test/fixtures/defs.ts`, then run under strict `tsc`, parsed
  with real zod, and bundled with esbuild.
- `test/helpers/sdk-pipeline.ts`: reaches the installed SDK's planner and
  composer (below). `test/helpers/emitted.ts`: writes the emitted file under
  `node_modules/.cache/` so `import "zod"` resolves.
- `test/plugin.test.ts`: the plugin's shape, its config block, and the peer
  backstop.
- `test/peer-free.test.ts`: the peer is types-only, and `PEER_RANGE` matches
  `package.json`.
- `test/published-docs.test.ts`: the tarball's file set and its doc links.

## Rules that bite

Each one fails in a USER's project, not here, unless a test catches it.

- **Mirror the core types, rule for rule.** The SDK renders `RouteInputs` and
  its siblings from the same description, and the emitted check requires
  `z.output` of each schema to BE that type. So every rule in the SDK's type
  renderer has a twin in `render.ts`: `required` decides `.optional()`; a list's
  `z.array` wraps before `.nullable()`; `json`/`unknown` scalars drop `nullable`
  (the core writes `unknown | null` as `unknown`); an optional key named after
  an `Object.prototype` member admits the inherited member; file refs, uploads
  and geo values are written structurally because the file cannot import the
  SDK's types; dbLink columns spread into the surrounding object, a key reached
  twice is the union of its declarations, and unknown columns leave the object
  loose. When the SDK changes a rule, change the twin and extend
  `render.test.ts`; `emitted-typecheck` is what tells you which one moved.
- **The identity check stays an identity check.** `__ZodSame` compares the two
  types for identity after normalizing zod's `| undefined` on optional keys and
  its empty object. Do not "simplify" it to `satisfies` or to one-way
  assignability: a schema missing an optional key passes those, and zod then
  strips the key from every parsed body. `emitted-typecheck` proves the check
  fails on a too-strict schema, a wrong type, a missing optional key and a
  required key made optional. Keep all four.
- **Pure factories, pure helpers.** Each map is `/* @__PURE__ */ (() => ({...}))()`
  and `__zodText` is a pure top-level arrow. `routes.gen.ts` exists so a frontend
  addresses the backend without a runtime; a top-level `z.object(...)` call is a
  side effect a bundler must keep, and it would put zod into every bundle that
  imports `routePath`. `emitted-bundle` asserts that bundle has no zod, against a
  control that does.
- **Check, never transform.** A schema must return the value it was given.
  `trim`/`lower`/`upper`/`salt` are the server's to apply; they only decide what
  copy the checks run on. No `.trim()`, `.toLowerCase()`, `.default()`,
  `.transform()` or coercion in an emitted schema.
- **Don't guess a check.** A pattern is translated only when the two regex
  dialects agree on every construct in it, and it is compiled here before it is
  emitted. Anything else is left to the server. A guessed check that rejects a
  value the server accepts is worse than none. The same goes for a vector's
  size, and for the server's habit of skipping password strength checks on `""`
  and `"0"`: that one is deliberately NOT mirrored, and the README says so.
- **The hook is pure and synchronous.** `routesManifest` touches no filesystem
  and returns the same text for the same input; every writer of `routes.gen.ts`
  must produce identical bytes or `xano:check` flips between them. No clock, no
  environment, no config-dependent output (the config block carries nothing the
  section reads).
- **Imports: `zod` only.** The SDK refuses `@xano/sdk*`, relative and `node:`
  specifiers in a section, and the file must stay free of `@xano/sdk`.
- **The peer is types-only.** Only `src/plugin.ts` may name `@xano/sdk`, through
  `import type`; tsup marks both peers external. `peer-free.test.ts` asserts it.
- **Describe the engine by behavior only.** This repo is public. Comments, docs,
  tests and commit messages say what the server does ("the server trims a text
  input before measuring it"), never which engine class, file, function or
  repository does it.

### Why no source-leak list lives here

The SDK enforces its no-engine-internals rule with a list of forbidden names. That
list is itself made of engine internals, so committing a copy to a public repo
would publish exactly what it guards. The check runs from `sdk-dev` instead, over
this repo's files, before every release (see Release, step 4).

## The SDK-pipeline helper

`test/helpers/sdk-pipeline.ts` drives the INSTALLED SDK's own planner and
composer, so the emitted-file suites test what a user's project actually gets,
not a hand-rolled composition. Those functions are not on any published subpath,
so the helper scans `node_modules/@xano/sdk/dist/` for a `routes-manifest-*.js`
chunk exporting `planRouteManifest`, `renderPlannedManifest` and
`composeRoutesManifest`, and fails by name when none does.

Consequences:

- The suites need an SDK build that contains the `routesManifest` hook: the
  first release with it (the peer floor) or a tarball of `sdk-dev` (Commands
  above). The published `1.0.5` pin in `devDependencies` does not have it.
- A refactor in the SDK that renames those exports or the chunk breaks the
  helper, not the module. Fix the helper, not the suites.

## The peer range

- `@xano/sdk`: `>=1.0.6 <2.0.0`. The floor is the first SDK with the
  `routesManifest` hook. Every toolchain hook is optional, so on an older SDK the
  module would load, register and contribute nothing, silently. Raise the floor
  only when a newer SDK type or behavior becomes load-bearing, and verify it by
  installing that version and running the suite. The ceiling is the next major.
  `MIN_SDK` / `MAX_SDK_EXCLUSIVE` in `src/plugin.ts` must match `package.json`
  (`peer-free.test.ts` checks).
- `zod`: `^4.0.0`, the classic API the emitted code uses (`z.int()`,
  `z.guid()`, `.check()`, `z.core.ParsePayload`). The SDK adds it to the user's
  project as a direct dependency on install.
- `devDependencies` pin the TESTED versions exactly, no caret: `zod` `4.6.5`;
  `@xano/sdk` moves to the floor release once it is on npm. README.md and
  llms.txt state both the ranges and the tested versions. Change all three in the
  same commit.

## Release

Patch only: `1.0.x`, whatever the change. No bump unless the owner asks.

1. The SDK release carrying the `routesManifest` hook is on npm. Move the
   `@xano/sdk` devDependency pin to it (exact), `npm install`, and drop the
   `--no-save` tarball step from Commands.
2. README.md and llms.txt carry the current peer ranges and tested versions.
3. `npm run typecheck && npm run lint && npm test && npm run build`.
4. From `sdk-dev`, run the SDK's source-leak check over `README.md`, `llms.txt`,
   `AGENTS.md`, `SECURITY.md`, `package.json`, `src/` and `test/`. Zero hits.
5. `npm pack --dry-run` shows `dist/` (the two entries, their shared chunk and
   `.d.ts` files, no `.map`), `README.md`, `llms.txt`, `LICENSE`, `package.json`, and nothing else.
6. From a green tree on `main`:

   ```bash
   npm version patch -m "chore(release): %s"
   npm run release          # prepublishOnly rebuilds dist/
   git push --follow-tags
   ```

7. Draft the GitHub release from `.github/RELEASE_TEMPLATE.md`.
8. Marketplace: the listing (slug `zod`, `kind: "toolchain"`,
   `npm_package: "@xano-sdk/zod"`, no `includes`, empty `register_snippet`) is
   seed data in the Release Manager repo, added by PR and synced with its
   `marketplace:sync -- --write`. Verify with `xanosdk marketplace details zod`,
   then `xanosdk marketplace install zod` in a scaffolded project adds
   `@xano-sdk/zod` and `zod`, and `npm run xano:check` is green.
