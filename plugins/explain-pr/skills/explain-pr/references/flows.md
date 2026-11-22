# Behaviour flows

A flow is a sequence diagram of one behaviour the change touches. The reader picks a **case** (a row of chips) and flips between **Before this change** and **With this change**. The page works out on its own which calls are new, which are gone, and which are the same, by comparing the two lists. So show every case whose outcome changed with both sides.

```json
"flows": [{
  "id": "get",
  "title": "GET /orders/:id",
  "description": "One sentence on what this flow is.",
  "participants": [
    { "id": "client", "label": "Client" },
    { "id": "svc", "label": "orderService" },
    { "id": "redis", "label": "Redis" }
  ],
  "cases": [{
    "id": "hit",
    "label": "In cache",
    "before": [ { "from": "client", "to": "svc", "text": "getOrder(42)" }, ... ],
    "after":  [ { "from": "client", "to": "svc", "text": "getOrder(42)" }, ... ],
    "beforeOutcome": "Every read queried Postgres.",
    "outcome": "Postgres is not asked; the answer can be 5 minutes old."
  }]
}]
```

## Picking what to draw

1. **Name the behaviour as calls between parts**: who asks whom, and what comes back. Draw the answer that decides each path even when it's empty. A cache returning `null` is why the request goes on to the database.
2. **Name the conditions** that choose between paths. Each becomes a case: "In cache / Not in cache / Redis unreachable", or "Valid / Empty items". Use 1–4 cases per flow.
3. **Write each case as one sentence first**: what is asked, what comes back, what that means, and how it ends. Then draw from the sentence. Each sentence should be readable straight off its diagram.
4. **Show the before** whenever the change alters an outcome. Without it the change itself is invisible. Leave out `before` only for a behaviour that didn't exist; the page then shows a "New flow" badge.
5. **Cover every behaviour the change names.** If the description promises two things, each gets a case or a flow.
6. **Check each case can happen.** Read what stands in front of the path (guards, middleware, flags, auth). If the outcome depends on a setting, say so in a label ("201 · if RBAC is off") or make it a case.
7. Use **3–5 participants** and at most **~10 messages** per side. Cut to the calls around the change. Use 1–3 flows per page.

## Messages

| Field | What it does |
|---|---|
| `from`, `to` | Participant ids. The same id twice draws a self-call loop (for local computation worth showing). |
| `text` | What is sent or returned, concretely: `GET order:42`, `SELECT … WHERE id = 42`, `201 order`, `null`. |
| `reply` | `true` for a return value or response (drawn dashed). |
| `error` | `true` for a failure (drawn red). Every failure the case's sentence names should be red. |
| `note` | A small italic line under the arrow: "via orderRepository.findById". |
| `change` | Optional override of the automatic marking: `new` · `changed` · `gone` · `same`. Use `changed` when the same call now carries something different (for example `text` went from `retry · 1s` to `retry · 60s`, which would otherwise read as one gone call and one new call). |

Automatic marking compares `from|to|text` between `before` and `after`. In the After view, messages not in Before are **NEW**. In the Before view, messages not in After are **GONE**. Keep the unchanged messages' text identical on both sides so they read as unchanged.

## Outcomes

`outcome` (after) and `beforeOutcome` are shown under the diagram as "Now: …" and "Before: …". One sentence each, about the result for the caller: what they get back and what it means.

## When a flow doesn't fit

Pure refactors with identical behaviour, docs, styling and config-only changes have little to diagram. Leave `flows` empty and let the architecture diagram and steps carry the page. For a refactor, one flow whose `before` and `after` show the same outcome through different parts can still help.
