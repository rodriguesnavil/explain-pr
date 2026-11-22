# Install in Cursor

## Requirements

- Cursor 2.5 or later (plugins and skills)
- Node.js 18 or later
- For pull requests: GitHub CLI, signed in (`gh auth login`)

## Option A: local plugin

The plugin bundles the skill, a `/explain-pr` command, and a rule that tells the agent when to use the skill.

```sh
git clone https://github.com/rodriguesnavil/explain-pr.git
mkdir -p ~/.cursor/plugins/local
cp -R explain-pr/plugins/explain-pr ~/.cursor/plugins/local/explain-pr
```

Then restart Cursor or run **Developer: Reload Window**. Open **Settings → Customize** and check that `explain-pr` appears under Plugins, with its skill, command and rule.

> Copy, don't symlink: Cursor only loads a symlinked plugin if it resolves to a folder inside `~/.cursor/plugins/local`. On Enterprise plans, **Allow Local Plugin Imports** must be on.

To update: `git pull` in the clone and copy the folder again.

## Option B: team marketplace (Teams / Enterprise)

1. In the Cursor dashboard, go to **Plugins & MCPs → Add Marketplace → Import from Repo**.
2. Paste `https://github.com/rodriguesnavil/explain-pr`. The repo has a `.cursor-plugin/marketplace.json`.
3. Add the `explain-pr` plugin and choose who gets it and whether it's installed by default.

## Option C: skill only

Cursor loads skills from `~/.cursor/skills`, `~/.claude/skills`, and the project-level `.cursor/skills` and `.claude/skills`.

```sh
./explain-pr/install.sh            # skill → ~/.claude/skills, command → ~/.cursor/commands
./explain-pr/install.sh --project /path/to/repo   # also adds the rule to that repo's .cursor/rules
```

## Use it

In Agent chat:

```text
/explain-pr
/explain-pr https://github.com/org/repo/pull/42
/explain-pr --base develop
```

You can also type `/` and pick the `explain-pr` skill, or just ask "what did this branch change?". When the agent finishes, it gives you the page's path. Ask it to open the page, or open the file in your browser.

## How the plugin is laid out

```text
plugins/explain-pr/
├── .cursor-plugin/plugin.json     # Cursor manifest: skills, rules, commands paths
├── .claude-plugin/plugin.json     # Claude Code manifest (ignored by Cursor)
├── skills/explain-pr/             # the shared skill: SKILL.md, scripts/, assets/, references/
└── cursor/
    ├── rules/explain-pr.mdc       # when to use the skill
    └── commands/explain-pr.md     # the /explain-pr command
```

The Cursor-only rule and command live under `cursor/`, so Claude Code doesn't load them twice.
