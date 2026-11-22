# Install in Claude Code

## Requirements

- Claude Code
- Node.js 18 or later (`node --version`)
- For pull requests: GitHub CLI, signed in (`gh auth login`). Local branches only need `git`.
- Optional: Chrome or Chromium, so the agent can take a screenshot and check the page before handing it over.

## Option A: plugin (recommended)

Inside Claude Code:

```text
/plugin marketplace add rodriguesnavil/explain-pr
/plugin install explain-pr@explain-pr
```

Or from a shell:

```sh
claude plugin marketplace add rodriguesnavil/explain-pr
claude plugin install explain-pr@explain-pr
```

Restart Claude Code. The skill is now available as `/explain-pr:explain-pr`, and Claude also picks it up from plain requests like "explain this PR" or "what did this branch change architecturally?".

Update later with:

```text
/plugin marketplace update explain-pr
```

## Option B: skill only

```sh
git clone https://github.com/rodriguesnavil/explain-pr.git
./explain-pr/install.sh --claude
```

This copies `plugins/explain-pr/skills/explain-pr` to `~/.claude/skills/explain-pr`. The command is `/explain-pr`.

For one project only, copy the folder into the repo instead:

```sh
mkdir -p .claude/skills && cp -R /path/to/explain-pr/plugins/explain-pr/skills/explain-pr .claude/skills/
```

## Check it works

In any git repository with a branch that differs from `main`:

```text
/explain-pr:explain-pr
```

Claude collects the change, writes `explain.json`, builds the page and publishes it as an artifact, or gives you the file path if it can't publish.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `the GitHub CLI (gh) is needed for PRs` | Install `gh` and run `gh auth login`. |
| `could not find a base branch` | Pass `--base main` (or your default branch), or set `base:` in `.explain-pr.yaml`. |
| `no common ancestor between …` | The base branch isn't fetched locally: `git fetch origin main`. |
| Skill not offered | `/plugin list` to confirm it's installed, then restart Claude Code. |
