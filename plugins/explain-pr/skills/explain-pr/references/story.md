# The story: steps, notes, and the rest

`steps` is the diff cut into the order a reader can follow. `check` places every hunk of `pr.diff`, and fails unless each one is in exactly one step or one `skip` group.

```json
"steps": [{
  "title": "Put the order rules in a service",
  "why": "orderService.getOrder reads through the cache; placeOrder validates items and computes the total.",
  "effect": "Two behaviour changes: cached reads, and 400 for empty items.",
  "pseudocode": "getOrder(id):\n  cache hit → return\n  miss → repo.findById, cache it",
  "hunks": [
    { "file": "src/services/orderService.js", "notes": [["if (cached) return cached", "Cache hit: Postgres is skipped"]] },
    { "file": "src/routes/orders.js", "hunks": [0] }
  ]
}]
```

## Steps

| Field | What goes in it |
|---|---|
| `title` | What the step does, as a short sentence in sentence case, under ~70 characters: "Add a Redis cache with a 5-minute expiry". |
| `why` | 1–3 plain sentences on what changes and how, naming real functions and values. |
| `effect` | Optional. One sentence on the consequence for callers, users or the system: "No behaviour change" is a useful thing to say. |
| `pseudocode` | Optional. Only for dense logic (nested conditions, retries, state machines). Strip syntax and error handling down to a few lines. |
| `hunks` | `{ file, hunks?, notes? }[]`. `file` is a path or any unique ending of one. `hunks` picks that file's hunks by 0-based index in diff order; leave it out for all of them. Split one file's hunks across steps when they do different jobs. |

### Order

Cause before effect, so each step only uses what earlier steps introduced:

1. The types, schema, constants and config the change needs.
2. The new or changed logic.
3. The wiring: routes, registration, dependency injection, exports.
4. Tests, after the code they prove.
5. Docs last (or in `skip`).

Use 2–7 steps. A one-line change gets one step.

## Notes

A note is `[lineText, note, nth?]` or `{ "line": lineText, "note": "...", "nth": 2, "side": "old" }`.

- It attaches to the first line in the chosen hunks whose text **contains** `lineText`. Added lines are searched first, then unchanged lines, then removed lines (`side: "old"` searches only removed lines).
- `lineText` is a substring of one line: no newlines. Leading spaces count.
- When several lines match, pass `nth` (1-based) or use a longer substring.
- "no line … contains" means nothing matched: look for a typo, a tab, or a line in a different hunk than the ones you picked.

Write notes on the lines a reader would otherwise have to stop and work out: a new branch, a changed default, a guard, the line that makes a removed behaviour stop. Use 1–4 notes per file. A note says what the line does or what it means, in plain words: "Missing orders are not cached, so a 404 is always re-checked." Don't restate the code ("Calls cache.set").

## What stopped happening

For every removed or changed line, ask what used to happen that now doesn't. Read the base version of the function, not just the hunk. Put the answers in `stopped`. These are often the most important facts on the page.

## Skip

Lockfiles, generated code, snapshots, pure renames and formatting-only files go in `skip` groups with a one-line `why`. `init` pre-fills the obvious ones. Docs can go in a step when they explain the change (an architecture note), or in `skip` otherwise.

## Style

- Plain words, short sentences, present tense: "The route now calls the service".
- Name things the way the code does. Wrap identifiers, paths and values in backticks (`orderService`, `TTL_SECONDS = 300`): the page shows them as inline code, and the Markdown summary keeps them.
- No grading: avoid "good", "bad", "should", "clean", "proper".
- Numbers and names over adjectives: "300 s", not "a short time".
