# explain.json

One file, in the work folder next to `pr.diff` and `meta.json`. `check` validates it against the diff; `build` turns it into the page and the Markdown summary. The header (repo, number, title, author, base, head, file counts) comes from `meta.json`, so leave those out.

Complete example: `examples/acme-orders/explain.json`.

## Top level

| Field | Required | What goes in it |
|---|---|---|
| `version` | yes | `1` |
| `summary` | yes | **One sentence**: what changes for whoever meets this change. Not "This PR refactors…" but "Order reads are now served from a 5-minute Redis cache before Postgres is asked." Under ~200 characters. |
| `overview` | | 2–4 plain sentences of context: what moved where, and the one thing to keep in mind. |
| `title` | | Override the title from meta.json (rarely needed). |
| `kind` | | `feature` · `fix` · `refactor` · `perf` · `chore` · `docs` · `test` · `mixed` |
| `effort` | | `{ score: 1-5, why }`: how much effort it takes to *understand* the change. 1 = trivial, 3 = a few interacting parts, 5 = many subsystems or subtle concurrency. |
| `intent` | | `{ source, checks: [...] }`; see below. |
| `architecture` | | `{ summary, impact, conventions, diagram }`; see `architecture.md`. |
| `flows` | | Sequence diagrams; see `flows.md`. |
| `decisions` | | `{ title, chose?, over?, why, where?: [path or path:line] }[]` |
| `attention` | | `{ tag, title, why, step? }[]` |
| `steps` | yes | The diff in reading order; see `story.md`. |
| `stopped` | | `{ what, why?, where? }[]`: behaviour that no longer happens. |
| `skip` | | `{ kind, why, files: [path endings] }[]`: files not worth reading. |
| `unchecked` | | `string[]`: claims that would need the code to run. |

## intent

```json
"intent": {
  "source": "PR description",
  "checks": [
    { "claim": "Reads go through a 5-minute cache", "status": "matches", "note": "TTL_SECONDS = 300 in redisCache.js" },
    { "claim": "No behaviour change", "status": "mismatch", "note": "Empty orders now get 400; before they were stored" }
  ]
}
```

- `source`: where the stated intent came from: `"PR description"`, `"commit messages"`, `"linked issue #12"`, or `"none"`.
- `status`, one of:
  - `matches`: the code does what the claim says.
  - `partial`: it does some of it, or only in some cases.
  - `mismatch`: the code does something else.
  - `unchecked`: it needs the code to run.
  - `unstated`: the code does something important that the description never mentions.
- Take each concrete claim from the description and the linked issues. Add an `unstated` row for significant changes nobody mentioned (a new dependency, a changed default, a removed path).
- With no stated intent, set `source: "none"` and leave `checks` empty. The page will say it can only describe what the code does.

## decisions

The design choices visible in the code: what was picked, over what, and why it follows from the code or its context.

```json
{ "title": "Read-through cache in the service", "chose": "caching in orderService.getOrder", "over": "caching in the route or repository", "why": "Keeps routes thin; the service decides what is cacheable.", "where": ["src/services/orderService.js:6-12"] }
```

`why` is what the code and docs show, not your opinion. If the reason isn't visible, say "Not stated; the effect is …".

## attention

What a reader should not miss, tagged. These explain; they don't grade.

| Tag | Use for |
|---|---|
| `Behaviour change` | An observable outcome is now different |
| `Breaking` | A caller, API consumer or stored data must change |
| `New dependency` | A new library, service or runtime requirement |
| `Migration` | Schema or data changes, or ordering between deploys |
| `Subtle` | Easy to misread: ordering, short-circuits, defaults, concurrency |
| `Security-sensitive` | Touches auth, secrets, permissions or input trust |
| `Uncommitted` | Local mode: part of the change isn't committed yet |
| `Unchecked` | Matters, but can only be settled by running the code |

`step` (1-based) also shows the callout inside that step.

## stopped

Removed behaviour is the easiest thing to miss in a diff. For each removed or changed line, ask what used to happen and no longer does.

```json
{ "what": "Empty orders are no longer stored with a total of 0", "why": "placeOrder throws 400 before the insert", "where": "src/services/orderService.js" }
```

## skip

```json
{ "kind": "Lockfile", "why": "Regenerated for ioredis.", "files": ["package-lock.json"] }
```

Typical kinds: `Lockfile`, `Generated`, `Snapshots`, `Docs`, `Rename only`, `Formatting`, `Fixtures`. A file in `skip` can't also be in a step.
