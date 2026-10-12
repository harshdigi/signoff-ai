# Writing flow docs

Flow docs describe how the product's business flows work, in the code of the open folder. Every claim carries a
`file:line` anchor into a repo, so the docs can be checked and drift shows up instead of hiding.

## Where a doc goes

One folder per business flow, a `CLAUDE.md` inside it. Folders nest when a flow has variants worth documenting apart:

```
payments/CLAUDE.md                 the shared machinery
payments/refunds/CLAUDE.md         one variant
```

A parent doc carries what is shared, the vocabulary, and a map of its children. A child carries only what differs.
If a child mostly repeats its parent, it should not exist.

The docs folder also has:
- `CLAUDE.md` at its top: an index, one line per flow doc with what it covers.
- `docs-meta.json`: `{ "verified_at": "<date>", "repos": { "<repo folder>": { "commit": "<sha>" } } }`, the commits
  the docs were written against.

## Anchor everything

Every factual claim gets an anchor in backticks: `` `app/services/payments/create.rb:12-20` ``, relative to the repo
root. When the open folder holds several repos, prefix the repo folder: `` `web-app/src/pages/checkout.tsx:40` ``.
Check each anchor points at the lines you mean before you write it.

## Structure

Not a rigid template, but these earn their place in most flow docs:
1. **One paragraph** on what the flow is and who it serves.
2. **Entry points**: routes with their full paths (walk the enclosing route blocks, not just the grep hit), jobs,
   or the service class.
3. **The sequence**: what happens in order, anchored. A code block for a pipeline, a table for a dispatch.
4. **Decisions**: why the code is shaped this way, and what was rejected.
5. **Do not**: the mistakes this flow invites.
6. **Related**: links to neighbouring docs.
7. In each parent doc, **Known gaps**: what you did not trace.

Aim for 100 to 250 lines. Past that, the flow probably has variants that want their own folders.

## What makes them worth reading

Anyone can read the code. A doc earns its place with what the code does not say at a glance:
- **Why, not what.** That a service creates four records is visible in seconds. Which check is load-bearing for the
  whole chain is not.
- **Rejected alternatives**, and the reason.
- **Fallbacks that hide failures**: name the fallback, what triggers it, and what silently goes wrong.
- **Locking, idempotency and ordering** constraints, and what breaks without them.
- **Traps**: a value in two lists that should be exclusive, a name that means two things.
- **Known bugs marked in the code**: quote the TODO.

Much of this reasoning is already in code comments. Quote it in a blockquote with its anchor instead of
paraphrasing; a quote stays honest when you are not sure you understood.

## Honesty

- The code is authoritative; the docs are not. Say so where they disagree.
- Label inference: "inferred, not traced" is a complete sentence.
- Record gaps instead of guessing.

## Never write sensitive data

No secrets, keys or tokens, and no personal or customer data (account or card numbers, ID numbers, emails, phone
numbers), even when it sits in a constant or a test fixture. Name the constant instead. Where the code logs such
data, say so without reproducing it.

## Keeping them true

- `signoff docs verify` lists anchors whose file is gone or whose lines are past the end of the file.
- `signoff docs touched` lists docs anchored on the files your branch changed. After a code change, read what each
  says about those files and fix what is now false. If nothing changed in behaviour, say so and do not edit.
