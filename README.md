# explain-pr

**Understand what a pull request or a branch does, and what it did to your architecture, before you merge or commit it.**

`explain-pr` is a skill for **Claude Code** and **Cursor**. Point it at a GitHub PR, or just run it on your current branch. It writes one guided HTML page and a Markdown summary you can paste into the PR description.

It explains the change and doesn't review it. Code quality is a job for your reviewer agent or linter. explain-pr answers the questions that remain after review: *what does this change actually do, and how does it reshape the system?*

> Built for agent workflows: one agent writes the code, another reviews it, and you read one page to understand what you're about to commit.

## What's on the page

| Section | What it tells you |
|---|---|
| **One-sentence summary** | What changes for whoever meets this change |
| **Intent vs code** | Each claim from the PR description, commit messages or linked issue, checked against the code: ✓ matches, ~ partial, ✕ mismatch, ? unchecked, plus important changes nobody mentioned |
| **Architecture impact** | New or removed modules, dependencies, APIs, data, config and boundaries, compared with your `CLAUDE.md`, `AGENTS.md`, `.cursor/rules` and ADRs: follows, departs, or introduces a new pattern |
| **Architecture diagram** | Layered component diagram with **Before / What changed / After** views; hover a box to trace its connections, click it to jump to its code |
| **Behaviour flows** | Interactive sequence diagrams: pick a case (cache hit, cache miss, Redis down…) and flip between **Before this change** and **With this change**. New calls are marked NEW, removed ones GONE |
| **Decisions made** | The design choices visible in the code: what was chosen, over what, and why |
| **Worth a closer look** | Tagged callouts: behaviour change, breaking, new dependency, migration, subtle, uncommitted… |
| **Walkthrough** | The diff cut into 2–7 steps in reading order (cause before effect), with notes pinned to the lines that matter and optional pseudocode |
| **What stopped happening** | Removed behaviour, the easiest thing to miss in a diff |
| **Files you can skip** | Lockfiles, generated code, snapshots |
| **Not verified** | Anything that would need the code to run. explain-pr never runs it |

Examples (download the `.html` and open it in a browser):

- [`examples/acme-orders.html`](examples/acme-orders.html): an agent's branch that adds a service layer, a repository and a Redis cache, with uncommitted files. [Markdown version](examples/acme-orders.md).
- [`examples/starlette-3435.html`](examples/starlette-3435.html): a real merged PR, [encode/starlette#3435](https://github.com/encode/starlette/pull/3435), which adds HTTP Early Hints. [Markdown version](examples/starlette-3435.md).

## Install

You need **Node 18+**. For pull requests you also need the **GitHub CLI**, signed in (`gh auth login`). Local branches need only `git`.

### Claude Code: plugin

```text
/plugin marketplace add rodriguesnavil/explain-pr
/plugin install explain-pr@explain-pr
```

Then run `/explain-pr:explain-pr`, or just ask "explain this branch".

### Cursor: plugin

```sh
git clone https://github.com/rodriguesnavil/explain-pr.git
mkdir -p ~/.cursor/plugins/local
cp -R explain-pr/plugins/explain-pr ~/.cursor/plugins/local/explain-pr
```

Restart Cursor (or run **Developer: Reload Window**) and check **Settings → Customize**. You get the skill, the `/explain-pr` command and a rule that tells the agent when to use it. Teams can import the repo as a team marketplace instead. See [docs/install-cursor.md](docs/install-cursor.md).

### Both at once: skill only

Cursor also reads skills from `~/.claude/skills`, so one copy serves both editors:

```sh
git clone https://github.com/rodriguesnavil/explain-pr.git
./explain-pr/install.sh          # skill → ~/.claude/skills, /explain-pr command → ~/.cursor/commands
```

More detail: [docs/install-claude-code.md](docs/install-claude-code.md) · [docs/install-cursor.md](docs/install-cursor.md)

## Use

| You say | It explains |
|---|---|
| `/explain-pr https://github.com/org/repo/pull/123` | That pull request (read-only, through the GitHub API) |
| `/explain-pr` or "what did the agent change?" | The current branch vs. the default branch, **including uncommitted and untracked files** |
| `/explain-pr --base develop` | The current branch vs. `develop` |
| `/explain-pr --uncommitted` | Only what isn't committed yet |

In Claude Code the plugin command is `/explain-pr:explain-pr`; with the skill-only install it's `/explain-pr`.

The page opens in any browser. In Claude it can be published as an artifact; in Cursor the agent gives you the path and can open it. Full guide, including how to add it to an agent pipeline: [docs/usage.md](docs/usage.md).

## How it works

```text
collect ──► pr.diff + meta.json + context docs      (git / gh api, read-only)
   │
agent reads the change, its neighbours and your conventions
   │
agent writes explain.json                            (data only: no HTML)
   │
check ──► every hunk placed, every note on a real line, diagrams consistent
   │
build ──► <slug>.html  (self-contained page, ~80 KB, works offline)
          <slug>.md    (PR-description summary with Mermaid diagrams)
```

The agent only ever writes data. A fixed template draws it, so every page looks the same and the agent can't produce broken HTML. The CLI has zero dependencies and ships inside the skill folder; nothing is installed from npm. Details: [docs/how-it-works.md](docs/how-it-works.md).

## Configure

Optionally add `.explain-pr.yaml` to your repo root to set the base branch, your architecture layers, extra docs to read, files to always skip, and per-path instructions. See [docs/config.md](docs/config.md).

## License

MIT © rodriguesnavil
