# Example: acme-orders, branch `feature/order-service-layer`

A small Express + Postgres service. The branch is the kind of change a coding agent leaves behind: one commit that moves order logic into a service and a repository and adds a Redis read cache, plus a test file and an architecture note it created but didn't commit.

- `meta.json`, `pr.diff`: what `collect` produced (local mode, base `main`).
- `explain.json`: the explanation, written following SKILL.md. It shows every section: intent checks, architecture impact with a layered diagram (including a removed edge), conventions from `CLAUDE.md`, two flows with before/after cases (one failure case), decisions, attention, five steps with notes and pseudocode, stopped behaviour, skip, and unchecked claims.

Rebuild it with:

```sh
node ../../scripts/explain-pr.mjs build .
```
