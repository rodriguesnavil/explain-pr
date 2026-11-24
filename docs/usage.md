# Using explain-pr

## Pick what to explain

| Ask | Scope |
|---|---|
| `/explain-pr <PR URL>` or `owner/repo#123` | A GitHub pull request, read through the API. Nothing is checked out. |
| `/explain-pr 123` inside a clone | That PR in the clone's `origin` repo |
| `/explain-pr` | Current branch vs. the default branch (`origin/HEAD`, else `main`/`master`), **including uncommitted changes and untracked files**. This is what an agent leaves behind before it commits. |
| `/explain-pr --base develop` | Current branch vs. `develop` |
| `/explain-pr --committed` | Only commits since the merge base |
| `/explain-pr --uncommitted` | Only changes since `HEAD` (working tree + untracked) |

Plain language works too: "explain this PR", "what did the agent just change?", "walk me through this branch's architecture changes".

## What you get

- **`<slug>.html`**: the page. It's self-contained (no network, ~80 KB) and opens in any browser. It follows your system's light or dark mode.
  - **In Claude**, the agent gives you the path. Ask it to open the page, or it runs `build --open`. The page is only published as an artifact if you ask.
  - **In Cursor**, the agent gives you the path; ask it to open the page, or it runs `build --open`.
- **`<slug>.md`**: the same content as Markdown with Mermaid diagrams. Paste it into the PR description; GitHub and GitLab draw the diagrams.

Both live in a work folder outside your repo (`$TMPDIR/explain-pr/<slug>/`, or `$EXPLAIN_PR_HOME/<slug>/` if you set that variable). Nothing is written to your repository.

## Reading the page

1. **Summary and intent.** Does the code do what the description says? Rows marked ✕ (mismatch) and – (unstated) are where a change surprises people.
2. **Architecture impact.** Switch the diagram between *Before*, *What changed* and *After*. Removed connections show as red dashed lines. Hover a box to see its role and files; click it to jump to its code.
3. **Behaviour flows.** Pick a case, then flip between *Before this change* and *With this change*.
4. **Decisions and Worth a closer look.** The choices the change made, and what not to miss.
5. **Walkthrough.** The diff in reading order. Long unchanged stretches are folded; click to expand.

## Use it in an agent pipeline

If you work like this: **agent writes → reviewer agent approves → you commit**, add explain-pr as the last step before the commit. Add this to your `AGENTS.md` or `CLAUDE.md`, or to a Cursor rule:

```markdown
## Before committing agent work

After the review agent approves a change, run the explain-pr skill on the current branch
(`/explain-pr`, which includes uncommitted files) and give me the page before committing.
Do not commit until I've confirmed the explanation matches what I asked for.
```

The page's **Intent vs code** section compares the change against the commit messages, or against the task description if you paste it in. Ask: "explain this branch; the intent was: <your original task>". The agent will check each part of your task against what was built.

## Updating after new commits

Pages are snapshots. Ask the agent to "update the explain-pr page". It re-collects into the same work folder, adjusts `explain.json` and rebuilds; in Claude it rebuilds the local file and, if you asked for an artifact earlier, republishes to the same one.

## Running the CLI yourself

The agent drives the CLI, but you can run it too:

```sh
S=~/.claude/skills/explain-pr/scripts/explain-pr.mjs   # or the plugin's skill folder
node $S collect --base main            # → prints the work folder
node $S init <workdir>                 # starter explain.json
node $S check <workdir>                # validate against the diff
node $S build <workdir> --open         # page + markdown
node $S --help
```
