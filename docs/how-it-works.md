# How it works

## Design

- **The agent writes data, never HTML.** `explain.json` describes the change; a fixed template (`assets/page.html`) draws it. Every page looks and behaves the same, and a page can't break because of a stray tag in a diff.
- **Everything is checked against the diff.** `check` fails unless every hunk is placed in exactly one step or skip group, every note lands on a real line, and every diagram edge points at a real node.
- **Read-only.** `collect` reads through `git` (local) or `gh api` (REST, for PRs). It never checks out, installs or runs the code. Claims that need execution go in *Not verified*.
- **Explain, don't review.** The instructions keep the agent describing what the code does and how the structure changed, not grading it.
- **Zero dependencies.** The CLI is plain Node (18+) and ships inside the skill, so the plugin works as soon as it's installed. Nothing needs publishing to npm.

## Files

```text
plugins/explain-pr/skills/explain-pr/
├── SKILL.md                    # the workflow the agent follows
├── references/
│   ├── format.md               # explain.json fields
│   ├── architecture.md         # impact, conventions, the component diagram
│   ├── flows.md                # sequence diagrams with before/after cases
│   └── story.md                # steps, notes, stopped, skip, style
├── examples/acme-orders/       # a complete worked example
├── assets/page.html            # the page template (vanilla JS, inline CSS, no network)
└── scripts/
    ├── explain-pr.mjs          # CLI: collect | init | check | build
    └── lib/
        ├── collect.mjs         # git / gh → pr.diff, meta.json, context/
        ├── diff.mjs            # unified diff parser
        ├── model.mjs           # validation + placing hunks and notes
        ├── make.mjs            # data → HTML
        ├── markdown.mjs        # data → Markdown + Mermaid
        └── init.mjs            # starter explain.json
```

## The work folder

| File | Written by | Contents |
|---|---|---|
| `pr.diff` | `collect` | The unified diff. For local changes it includes untracked files, diffed against `/dev/null` without touching the index |
| `meta.json` | `collect` | Title, author, base/head, intent (PR body or commit messages), linked issues, files, context docs, config |
| `context/` | `collect` (PRs) | Convention docs fetched at the PR's head |
| `explain.json` | the agent | The explanation |
| `<slug>.html`, `<slug>.md` | `build` | The page and the summary |

## Diagrams

- **Architecture:** layered rows (from `layers`, or computed from the edges), with nodes ordered to reduce crossings. Edges that skip a layer are routed through the gaps between boxes, so they never run behind one. The three views (Before / What changed / After) hide added or removed items in place, so positions stay put and you can compare them.
- **Sequence:** lanes laid out automatically from `participants`. NEW / GONE marking is computed by comparing the `before` and `after` message lists.
- **Markdown:** both diagrams are also written as Mermaid (`flowchart` with `classDef` colours, `sequenceDiagram`) for PR descriptions.