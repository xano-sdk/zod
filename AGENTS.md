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
npm test            # vitest run — no backend needed
npm run test:e2e    # the parity suite: deploys test/e2e/fixtures to a Xano Engine on this machine
                    # through the installed SDK's CLI, then compares every schema with the server
npm pack --dry-run  # the tarball: dist/, README.md, llms.txt, LICENSE, package.json
```

Before committing: `npm run typecheck && npm run lint && npm test`. Before
changing what a schema checks: `npm run test:e2e` too (below). It needs a
machine that can run a Xano Engine, or `XANO_E2E_HOST` naming a backend that
already serves `test/e2e/fixtures/defs.ts` (deploy that file as a project's
`xano/index.ts`; `node_modules/.cache/e2e-project/` holds one after a local
run). When neither is reachable, say so and stop; never report the step as done.

To test against unreleased SDK work, install a tarball built in `sdk-dev`
without touching the pin:

```bash
(cd ../sdk-dev && npm run build && npm pack --pack-destination /tmp/sdk-pack)
npm install --no-save /tmp/sdk-pack/xano-sdk-<version>.tgz
```

A later plain `npm install` or `npm ci` puts the pinned SDK back.

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
- `test/e2e/`: the parity suite, `npm run test:e2e`. `fixtures/defs.ts` is a
  workspace with one endpoint per input declaration (every type, flag and
  method, plus a dbLink); `helpers/backend.ts` deploys it to a Xano Engine on
  this machine through the installed SDK's own CLI (or uses `XANO_E2E_HOST`, a
  backend already serving it, such as a cloud ephemeral deployed from the
  throwaway project under `node_modules/.cache/e2e-project/`); `parity.e2e.ts`
  sends each case to the schema and the server and compares the verdicts, and
  the messages where the schema's are this module's own. Cases the two are
  known to disagree on carry the reason, and the suite asserts that exact
  disagreement, so a server change surfaces. `XANO_E2E_KEEP=1` leaves the
  engine running between runs; by default it is stopped, since nothing else
  reclaims one. Not part of `npm test`: it needs the CLI and a machine that can
  run an engine.
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
  an `Object.prototype` member admits the inherited member (and the object's
  `__zodOwnKeys` check takes that member back off the parsed value); an input
  named `__proto__` is a computed key, never a bare one; file refs, uploads
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
  and `__zodText` / `__zodOwnKeys` are pure top-level arrows. `routes.gen.ts` exists so a frontend
  addresses the backend without a runtime; a top-level `z.object(...)` call is a
  side effect a bundler must keep, and it would put zod into every bundle that
  imports `routePath`. `emitted-bundle` asserts that bundle has no zod, against a
  control that does.
- **Check, never transform.** A schema must return the value it was given.
  `trim`/`lower`/`upper`/`salt` are the server's to apply; they only decide what
  copy the checks run on. No `.trim()`, `.toLowerCase()`, `.default()`,
  `.transform()` or coercion in an emitted schema. `__zodOwnKeys` is not an
  exception: it removes a key zod itself copied off `Object.prototype`, so the
  parsed value has exactly the keys it was given.
- **Don't guess a check; measure it.** A pattern is translated only when the
  two regex dialects agree on every construct in it, and it is compiled here
  before it is emitted. Anything else is left to the server, as is a pattern
  without the `u` flag against a non-ASCII value: the parity suite found one
  backend matching bytes there and another characters, so only the server can
  say; the same for a `u` pattern that uses `\s`, `\d`, `\w` or `\b`, which
  one backend reads as Unicode classes and another as ASCII. A guessed check that rejects a value the server accepts is worse than
  none; where backends differ, the schema takes the lenient reading (`$`
  without `D` may match before a final newline on some backends, so the
  translation lets it). The module's contract is to accept everything the
  server accepts and refuse what it refuses, so the server's own rules are
  mirrored exactly as observed: a text input is trimmed before measuring only when its methods say
  `trim` (the last of `trim`/`notrim` wins), a password and an email always; a
  required text, email, password, uuid, date or json input, or a required
  tableRef to a uuid-keyed table, reads `""` as missing before any other check,
  with the server's `Missing param: <name>`;
  a password of `""` or `"0"` then passes unchecked; `startsWith` is checked
  before the case fold and the fold before the whitelist, `prevent` and
  `pattern`, whatever the declared order; a vector must have its declared size.
  The parity suite (`npm run test:e2e`) is the oracle for all of this: before
  changing a rule, add the declaration and payloads there and watch the server.
- **A gap the parity suite pins is documented, and closed in three places.**
  The suite marks the cases where schema and server are known to disagree, with
  the reason: values the server coerces (the schema holds the core type), an
  omitted optional input whose default fails its methods (the description
  carries no default), a pattern stored without its error text (the server
  refuses every value), the members of a stored file reference and a file
  upload sent as JSON, a date's format, an enum with no values. Each is in
  README's "What a schema does not do" and in `llms.txt`. Closing one means
  changing `render.ts`, the suite's expectation and both docs in one commit.
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
this repo's files, before every release (see Release, step 3).

## The SDK-pipeline helper

`test/helpers/sdk-pipeline.ts` drives the INSTALLED SDK's own planner and
composer, so the emitted-file suites test what a user's project actually gets,
not a hand-rolled composition. Those functions are not on any published subpath,
so the helper finds each of `planRouteManifest`, `renderPlannedManifest` and
`composeRoutesManifest` in `node_modules/@xano/sdk/dist/` by the module that
defines and exports it (they need not share a chunk), and fails naming any it
cannot find.

Consequences:

- The suites need an SDK build that contains the `routesManifest` hook: the
  peer floor (`1.0.6`, the `devDependencies` pin) or later, or a tarball of
  `sdk-dev` (Commands above).
- A refactor in the SDK that renames those functions breaks the
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
- `devDependencies` pin the TESTED versions exactly, no caret: `zod` `4.6.5`,
  `@xano/sdk` `1.0.6`. README.md and
  llms.txt state both the ranges and the tested versions. Change all three in the
  same commit.

## Release

Patch only: `1.0.x`, whatever the change. No bump unless the owner asks.

1. README.md and llms.txt carry the current peer ranges and tested versions,
   matching the `devDependencies` pins.
2. `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build`.
3. From `sdk-dev`, run the SDK's source-leak check over `README.md`, `llms.txt`,
   `AGENTS.md`, `SECURITY.md`, `package.json`, `src/` and `test/`. Zero hits.
4. `npm pack --dry-run` shows `dist/` (the two entries, their shared chunk and
   `.d.ts` files, no `.map`), `README.md`, `llms.txt`, `LICENSE`, `package.json`, and nothing else.
5. From a green tree on `main`:

   ```bash
   npm version patch -m "chore(release): %s"
   npm run release          # prepublishOnly rebuilds dist/
   git push --follow-tags
   ```

6. Draft the GitHub release from `.github/RELEASE_TEMPLATE.md`.
   Publishing it (not a prerelease) fires `.github/workflows/release-slack.yml`,
   which posts the release to Slack through the org secret `SLACK_WEBHOOK_URL`.
   The job first runs `.github/scripts/test_slack_release_message.py`, which
   renders `RELEASE_TEMPLATE.md` through the real builder, so a malformed
   payload fails the workflow instead of reaching Slack. The builder and its
   test match `sdk-dev`'s except for the repo and package names; port fixes
   between them. Check a draft locally with
   `cd .github/scripts && python3 test_slack_release_message.py`. To re-announce,
   run the workflow by hand with the tag.
7. Marketplace: the listing (slug `zod`, `kind: "toolchain"`,
   `npm_package: "@xano-sdk/zod"`, no `includes`, empty `register_snippet`) is
   seed data in the Release Manager repo, added by PR and synced with its
   `marketplace:sync -- --write`. Verify with `xanosdk marketplace details zod`,
   then `xanosdk marketplace install zod` in a scaffolded project adds
   `@xano-sdk/zod` and `zod`, and `npm run xano:check` is green.
