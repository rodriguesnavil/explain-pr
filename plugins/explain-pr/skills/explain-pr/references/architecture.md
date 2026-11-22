# The architecture section

This is the heart of the page: how the change sits in the system and what it did to the system's shape.

```json
"architecture": {
  "summary": "One or two sentences on the structural change, or 'No structural change: …'.",
  "impact": [ ... ],
  "conventions": [ ... ],
  "diagram": { "title": "...", "layers": [ ... ], "nodes": [ ... ], "edges": [ ... ] }
}
```

## summary

Say the shape of the change. Some examples:

- "A three-layer split replaces route-level SQL, and a cache sits between the service and the database."
- "No structural change: the fix stays inside `RetryHandler`; callers and dependencies are unchanged."
- "Event publishing moves from a direct call to an outbox table drained by a new worker."

## impact

One entry per structural fact. Not one per file.

| Field | Values |
|---|---|
| `kind` | `module` (a new, removed or re-scoped unit) · `dependency` (a library or external service) · `api` (a public interface, route, exported function or CLI flag) · `data` (schema, migration, stored format, cache keys) · `config` (env var, flag, default) · `boundary` (who may call whom; a layer rule gained or lost) · `pattern` (a new way of doing something) · `infra` (deploy, jobs, queues) · `removal` · `security` |
| `change` | `added` · `removed` · `changed` |
| `title` | Short and concrete: "Redis via ioredis", "POST /orders now returns 400 for empty items" |
| `detail` | One sentence: what it means for the system |
| `files` | Path endings; they link to the step that shows them |

What counts as structural: anything that changes who depends on whom, what the system needs to run, what its public surface is, or what it stores. A renamed local variable does not. A function that moved to a new module does.

## conventions

Compare the change against the rules the repo writes down. Look in CLAUDE.md, AGENTS.md, ARCHITECTURE.md, `.cursor/rules`, `.cursorrules`, ADRs and the config's `instructions`.

```json
{ "source": "CLAUDE.md", "rule": "Routes must never import src/db.js directly", "status": "follows", "note": "The route now imports only the service." }
```

- `follows`: the change keeps the rule, especially where it touches what the rule governs.
- `departs`: the change does something the rule says not to. State it factually.
- `new`: the change introduces a pattern no rule covers yet (a first cache, a first queue). Use `source: "(no rule)"`.

Only list rules the change actually touches. With no convention docs, leave this empty, but still use `new` for genuinely new patterns.

## diagram

A component diagram of the parts around the change. The page draws it with three views:

- **Before:** `added` items are hidden.
- **What changed:** colour-coded; this is the default view.
- **After:** `removed` items are hidden.

So one diagram describes both the old and the new structure.

```json
"diagram": {
  "title": "Order request path",
  "layers": [
    { "id": "http", "label": "HTTP" },
    { "id": "domain", "label": "Domain" },
    { "id": "data", "label": "Data" },
    { "id": "infra", "label": "Infrastructure" }
  ],
  "nodes": [
    { "id": "routes", "label": "routes/orders.js", "kind": "api", "layer": "http", "status": "changed", "detail": "Now only calls the service.", "files": ["src/routes/orders.js"] },
    { "id": "service", "label": "orderService", "kind": "service", "layer": "domain", "status": "added", "files": ["src/services/orderService.js"] },
    { "id": "db", "label": "db.js (pg pool)", "kind": "module", "layer": "data", "status": "same" }
  ],
  "edges": [
    { "from": "routes", "to": "db", "label": "SQL in the route", "status": "removed" },
    { "from": "routes", "to": "service", "status": "added" }
  ]
}
```

### Choosing nodes

- Draw **3–12 nodes**: everything the change adds, removes or changes, plus the immediate neighbours that make it make sense (who calls it, what it calls).
- Pick one granularity and stick to it: modules or services for most changes, functions only for a change inside one module.
- `label`: the name a reader will find in the code (`orderService`, `routes/orders.js`, `Postgres`).
- `kind`: `ui` · `api` · `service` · `module` · `function` · `store` · `db` · `queue` · `external` · `config` · `job` · `test`. `db` and `store` get rounded boxes; `external` gets a dashed border.
- `status`:
  - `added`: new in this change.
  - `removed`: deleted.
  - `changed`: its responsibility or interface changed (internal-only edits don't count).
  - `same`: unchanged context.
- `detail`: shown on hover. One line on its role after the change.
- `files`: makes the box clickable; it jumps to the step showing that file.

### Choosing edges

- An edge is a call, import, message or data flow, from caller to callee.
- **Draw removed edges.** A connection that disappears ("the route no longer queries the db") is often the whole point of the change.
- `label` is optional. Use it for the nature of the connection (`read-through`, `publishes OrderPlaced`, `SQL in the route`), up to ~30 characters.
- An edge between a removed node and anything else should itself be `removed`.

### Layers

- Layers are drawn top to bottom in the order you list them. Use the repo's own vocabulary, from the config's `layers` or the architecture docs, or infer it from the folders (`ui`, `api`, `domain`, `data`, `infra`).
- Without `layers`, rows are computed from the edges (callers above callees), which works for small graphs.
- A node in a layer that isn't listed goes in an unlabelled bottom row: list every layer you use.
