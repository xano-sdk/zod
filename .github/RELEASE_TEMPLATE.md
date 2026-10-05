<!--
  Release notes template for @xano-sdk/zod.

  Copy the body below (from the summary paragraph down), fill it in, and paste
  it into the GitHub release. HTML comments like this one are invisible on the
  rendered release page, so the guidance can stay in the draft while you write.

  Release title (the GitHub release `name`, not the tag):

      vX.Y.Z — Three-to-five word theme

  It has to stand alone: "v1.0.2 — Patterns the server reads", not "v1.0.2"
  and not "Release 1.0.2". Hard cap 150 characters.

  The body follows the shape the SDK's and the other modules' releases use, so
  a Slack announcement can be built from it the same way:

    - Everything BEFORE the first `##` is the summary block. Budget ~1200
      characters. Keep the summary + install snippet under that.
    - Every `##` heading is one itemized change; the first 8 are what a reader
      sees. Write each heading as a claim that survives on its own, with no
      body text under it for context.
    - Headings that are pure structure — Notes, Misc, Other, Compatibility,
      Verification, Housekeeping, Credits, Full changelog — are not changes.
      Use them freely for real structure; just don't hide a change under one.
    - Bold, links, and inline code carry over. Avoid images and tables above
      the first heading.

  Versioning is patch-only (1.0.x), whatever the change.
-->

<!--
  Summary: one paragraph, 2-4 sentences. What this release is about and why
  someone should take it. No story, no changelog restatement — the headings
  below do the itemizing. Say if regenerating `routes.gen.ts` changes the
  committed file (it usually does: the block names the module version), and
  if a schema now accepts or rejects something it did not before.
-->

SUMMARY PARAGRAPH.

```bash
npx xanosdk marketplace install zod      # or: npm install @xano-sdk/zod@X.Y.Z
npm run xano:routes                      # regenerate routes.gen.ts, then commit it
```

<!--
  One `##` per change. The heading is the title — a specific claim, not a
  category ("A pattern with \\z is left to the server", not "Pattern fixes").
  Under it: what was wrong or what is new, what the emitted schema does now,
  and anything a user has to act on. Two or three sentences is usually right;
  a short before/after of the emitted line when the schema itself changed.

  Group several small related fixes under one heading with `**Bold lead-in.**`
  paragraphs rather than spending a heading.

  Mark anything that can break an existing build with ⚠️ in the heading — for
  example a schema that now rejects a body it used to accept, or a raised
  `@xano/sdk` peer floor.
-->

## First change, stated as a claim

What it did, what it does now, and what you have to change:

```ts
title: z.string().check(__zodText({ trim: true, max: 80 })),
```

## Second change, stated as a claim

Description.

## ⚠️ A change that can break an existing build

What breaks, for whom, and the migration. Lead with the breakage.

<!--
  Optional trailing structure — not itemized changes.
-->

## Compatibility

Peers: `@xano/sdk` `>=X.Y.Z <2.0.0`, `zod` `^4.0.0`. Tested against `@xano/sdk`
X.Y.Z and `zod` X.Y.Z.

## Notes

Anything worth recording that isn't a change: limits now stated rather than
discovered, docs that moved, known gaps.
