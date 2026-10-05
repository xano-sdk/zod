# Security policy

## Reporting a vulnerability

Report it privately, not in a public issue:

**[Open a private security advisory](https://github.com/xano-sdk/zod/security/advisories/new)**

Include what you found, how to reproduce it, and what an attacker could do with
it. A proof of concept helps; a redacted one is fine.

We will acknowledge the report and keep you updated as we work through it. We
are a small team and do not promise a fixed response window — if you have not
heard anything after a week, please ping the advisory thread.

Please give us a chance to ship a fix before disclosing publicly. We will credit
you in the release notes unless you would rather we did not.

## Supported versions

Only the latest published `@xano-sdk/zod` release receives fixes. There are no
maintained release branches — upgrade to the newest version to pick up security
patches.

## Scope

This policy covers the `@xano-sdk/zod` package and this repository, including
the zod schemas it adds to your project's `routes.gen.ts`.

The `xanosdk` CLI and `@xano/sdk` have their own policy in
[xano-sdk/sdk](https://github.com/xano-sdk/sdk). Vulnerabilities in `zod`
itself belong to [colinhacks/zod](https://github.com/colinhacks/zod), and
vulnerabilities in the Xano platform are out of scope here — report those
through Xano's own security channels.
