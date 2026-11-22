## What this change does

**Order requests now go route → service → repository, and reading an order is served from a 5-minute Redis cache before Postgres is asked.**

The routes stop running SQL themselves. Business rules (the total, the new empty-order check) move into `orderService`, SQL moves into `orderRepository`, and reads are cached in Redis. Redis becomes a new runtime dependency for GET /orders/:id.

<sub>acme-orders · feature/order-service-layer · 8 files · +95 −12 · effort 2/5</sub>

### Intent vs code <sub>(from commit messages)</sub>

| | Claim | Note |
|---|---|---|
| ✅ | Routes now call `orderService` | `src/routes/orders.js` imports only ../services/orderService. |
| ✅ | Reads go through a 5-minute Redis cache | `TTL_SECONDS = 300` in `redisCache.js`; only `getOrder` reads the cache. |
| ✅ | Empty orders are rejected with 400 | Also a body with no items array at all now gets 400; before, it threw on `items.reduce`. |

### Architecture impact

A classic three-layer split replaces route-level SQL, and a cache sits between the service and the database. The layering matches what CLAUDE.md asks for.

- **🟢 added module:** Service layer: orderService — Owns `getOrder` and `placeOrder`, including the order total and the empty-order rule.
- **🟢 added module:** Repository layer: orderRepository — The same two SQL statements the route used to run, now behind `findById` and create.
- **🟢 added dependency:** Redis via ioredis — New runtime dependency, configured by `REDIS_URL`. GET /orders/:id now needs Redis reachable.
- **🔴 removed boundary:** Routes no longer touch the database — The direct import of `src/db.js` from the route is gone.
- **🟢 added config:** New env var REDIS_URL — Read once at startup when `redisCache.js` is loaded.

```mermaid
flowchart TD
  subgraph n_layer_http["HTTP"]
    n_routes["routes/orders.js (changed)"]
  end
  subgraph n_layer_domain["Domain"]
    n_service["orderService (added)"]
  end
  subgraph n_layer_data["Data"]
    n_repo["orderRepository (added)"]
    n_cache["redisCache (added)"]
    n_db["db.js (pg pool)"]
  end
  subgraph n_layer_infra["Infrastructure"]
    n_pg[("Postgres")]
    n_redis[("Redis (added)")]
  end
  n_routes -.->|"SQL in the route"| n_db
  n_routes --> n_service
  n_service -->|"read-through"| n_cache
  n_service --> n_repo
  n_repo --> n_db
  n_cache --> n_redis
  n_db --> n_pg
  linkStyle 0 stroke:#dc2626,stroke-dasharray:4 4
  linkStyle 1 stroke:#16a34a,stroke-width:2px
  linkStyle 2 stroke:#16a34a,stroke-width:2px
  linkStyle 3 stroke:#16a34a,stroke-width:2px
  linkStyle 4 stroke:#16a34a,stroke-width:2px
  linkStyle 5 stroke:#16a34a,stroke-width:2px
  classDef added fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef removed fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-dasharray:4 4
  classDef changed fill:#fef3c7,stroke:#d97706,color:#78350f
  class n_service,n_repo,n_cache,n_redis added
  class n_routes changed
```

| Convention | Source | Status | Note |
|---|---|---|---|
| Routes must never import `src/db.js` directly | CLAUDE.md | ✅ follows | Before this change the route did exactly that; now it doesn't. |
| Business rules live in src/services/, data access in src/repositories/ | CLAUDE.md | ✅ follows | The total and the new validation are in the service; SQL is in the repository. |
| New infrastructure dependencies need a note in `docs/architecture.md` | CLAUDE.md | ✅ follows | `docs/architecture.md` mentions Redis, but the file is still untracked: it is not committed yet. |
| Caching layer called from services | (no rule) | 🆕 new pattern | First cache in the codebase; nothing documents where caching may live. |

### Flow: GET /orders/:id

Reading one order. The route asks the service, which checks Redis before the database.

**Not in cache** — A miss costs one extra Redis round trip and stores the order for 5 minutes.

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_pg: SELECT * FROM orders WHERE id = 42 ✖
  n_pg-->>n_route: row ✖
  n_route-->>n_client: 200 order
```
</details>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_svc: getOrder(42) 🆕
  n_svc->>n_redis: GET order:42 🆕
  n_redis-->>n_svc: null 🆕
  n_svc->>n_pg: SELECT * FROM orders WHERE id = 42 🆕
  Note over n_pg: via orderRepository.findById
  n_pg-->>n_svc: row 🆕
  n_svc->>n_redis: SET order:42 EX 300 🆕
  n_svc-->>n_route: order 🆕
  n_route-->>n_client: 200 order
```

**In cache** — Postgres is not asked at all; the answer can be up to 5 minutes old.

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_pg: SELECT * FROM orders WHERE id = 42 ✖
  n_pg-->>n_route: row ✖
  n_route-->>n_client: 200 order
```
</details>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_svc: getOrder(42) 🆕
  n_svc->>n_redis: GET order:42 🆕
  n_redis-->>n_svc: cached order 🆕
  n_svc-->>n_route: order 🆕
  n_route-->>n_client: 200 order
```

**Redis unreachable** — The read fails even though Postgres is up: nothing catches the cache error. (Unchecked: what the client sees depends on Express error handling.)

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_pg: SELECT * FROM orders WHERE id = 42 ✖
  n_pg-->>n_route: row ✖
  n_route-->>n_client: 200 order ✖
```
</details>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_redis as Redis
  participant n_pg as Postgres
  n_client->>n_route: GET /orders/42
  n_route->>n_svc: getOrder(42) 🆕
  n_svc->>n_redis: GET order:42 🆕
  n_redis-->>n_svc: connection error 🆕 ⚠
  n_svc-->>n_route: throws 🆕 ⚠
```

### Flow: POST /orders

Placing an order. Validation and the total move into the service.

**Valid order** — Same result as before; the work just happens in the service.

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_pg as Postgres
  n_client->>n_route: POST /orders { items }
  n_route->>n_route: total = Σ price × qty ✖
  n_route->>n_pg: INSERT INTO orders … ✖
  n_pg-->>n_route: row ✖
  n_route-->>n_client: 201 order
```
</details>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_pg as Postgres
  n_client->>n_route: POST /orders { items }
  n_route->>n_svc: placeOrder(body) 🆕
  n_svc->>n_svc: total = Σ price × qty 🆕
  n_svc->>n_pg: INSERT INTO orders … 🆕
  Note over n_pg: via orderRepository.create
  n_pg-->>n_svc: row 🆕
  n_svc-->>n_route: order 🆕
  n_route-->>n_client: 201 order
```

**Empty items** — Rejected before anything is written.

<details><summary>Before this change</summary>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_pg as Postgres
  n_client->>n_route: POST /orders { items: [] }
  n_route->>n_pg: INSERT … total 0 ✖
  n_pg-->>n_route: row ✖
  n_route-->>n_client: 201 order (total 0) ✖
```
</details>

```mermaid
sequenceDiagram
  participant n_client as Client
  participant n_route as Route
  participant n_svc as orderService
  participant n_pg as Postgres
  n_client->>n_route: POST /orders { items: [] }
  n_route->>n_svc: placeOrder(body) 🆕
  n_svc-->>n_route: throws status 400 🆕 ⚠
  n_route-->>n_client: 400 an order needs at least one item 🆕 ⚠
```

### Decisions made

- **Read-through cache in the service.** Chose caching inside orderService.getOrder over caching in the route or the repository. Keeps the route thin and the repository a plain SQL wrapper; the service decides what is cacheable. <sub>`src/services/orderService.js:6-12`</sub>
- **Validation errors carry an HTTP status.** Chose an Error with err.status = 400 over a dedicated error class. Lets the route map it to a 400 with one check; other errors go to next(). <sub>`src/services/orderService.js:15-19`, ``src/routes/orders.js``</sub>
- **Fixed 5-minute TTL, no invalidation.** Chose expire after 300 s over deleting the key on writes. Simplest option; `cache.del` exists but nothing calls it yet. <sub>`src/cache/redisCache.js:4`</sub>

### Worth a closer look

- **[Behaviour change] Reads can be up to 5 minutes stale** — Nothing deletes order:<id> when an order changes. Today there is no update route, so it only matters once one is added. _(step 3)_
- **[New dependency] GET /orders/:id now fails when Redis is down** — `getOrder` awaits `cache.get` with no fallback to the repository. _(step 3)_
- **[Uncommitted] The tests and the architecture note are not committed** — `test/orderService.test.js` and `docs/architecture.md` exist only in the working tree. _(step 5)_

### Walkthrough

| Step | What | Files |
|---|---|---|
| 1 | **Move the SQL into an order repository** — `orderRepository` wraps the two statements the route used to run: `findById` returns the row or null, create inserts and returns the new row. | `src/repositories/orderRepository.js` |
| 2 | **Add a Redis cache with a 5-minute expiry** — `redisCache` connects once at load using `REDIS_URL` and stores JSON values with a 300-second TTL. | `src/cache/redisCache.js`<br>`package.json` |
| 3 | **Put the order rules in a service** — `orderService.getOrder` reads through the cache; `placeOrder` validates the items and computes the total before calling the repository. | `src/services/orderService.js` |
| 4 | **Thin the routes down to calls into the service** — The route now imports `orderService` instead of db and maps results to HTTP: null → 404, `err.status` 400 → 400, anything else → `next(err)`. | `src/routes/orders.js` |
| 5 | **Test the cache hit and the empty-order rule, and document Redis** — Two node:test cases mock the cache and repository; `docs/architecture.md` records the new request path and `REDIS_URL`. | `test/orderService.test.js`<br>`docs/architecture.md` |

### What stopped happening

- Empty orders are no longer stored with a total of 0 — `placeOrder` throws a 400 before the insert. <sub>`src/services/orderService.js`</sub>
- GET no longer always reads fresh data from Postgres — A cached copy is returned for up to 5 minutes. <sub>`src/services/orderService.js`</sub>

<details><summary>Files you can skip</summary>

- **Lockfile** — Regenerated for `ioredis`.: `package-lock.json`

</details>

<details><summary>Not verified (needs running the code)</summary>

- What a client receives when Redis is unreachable (depends on Express 4's handling of a rejected async handler).
- That `ioredis` 5.4.1 accepts the (key, value, 'EX', seconds) call form used in set().

</details>

<sub>Generated by [explain-pr](https://github.com/rodriguesnavil/explain-pr) at 4f43a17.</sub>
