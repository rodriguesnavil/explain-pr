# Configuration: `.explain-pr.yaml`

Optional. Put it at the root of a repository (`.explain-pr.yaml`, `.explain-pr.yml` or `.explain-pr.json`). `collect` finds it, at the PR's head for pull requests, and the agent follows it.

```yaml
# Default base branch for local changes (otherwise origin's default branch).
base: main

# Your architecture's layers, top to bottom. The diagram uses these names.
layers: [ui, api, domain, data, infra]

# Extra docs the agent reads before explaining (files or folders).
# CLAUDE.md, AGENTS.md, ARCHITECTURE.md, docs/architecture.md, .cursorrules,
# .cursor/rules/ and docs/adr/ are always read when present.
context:
  - docs/system-overview.md
  - docs/decisions/

# Files that always go in "Files you can skip".
skip:
  - "**/*.generated.ts"
  - "src/locales/**"
  - "openapi/*.json"

# Free-text guidance for every explanation in this repo.
instructions: |
  The payments provider (Stripe) is always an external node.
  "Worker" means the BullMQ consumers in src/jobs.

# Guidance for specific paths.
paths:
  - path: "src/billing/**"
    instructions: "Always show the ledger and the payment provider in the diagram."
  - path: "migrations/**"
    instructions: "Explain each migration's effect on existing rows, and its deploy ordering."
```

| Key | Effect |
|---|---|
| `base` | Passed to `collect --base` for local changes |
| `layers` | Used as `architecture.diagram.layers` |
| `context` | Read in addition to the standard convention docs |
| `skip` | Matching files are put in `skip` groups |
| `instructions` | Applied to every explanation |
| `paths[].instructions` | Applied when the change touches matching files |

## Environment

| Variable | Effect |
|---|---|
| `EXPLAIN_PR_HOME` | Where work folders are created (default: `$TMPDIR/explain-pr`) |
