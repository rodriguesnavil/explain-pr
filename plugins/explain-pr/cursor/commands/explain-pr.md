# Explain PR

Explain the change named after this command by following the `explain-pr` skill end to end (collect → read → map the architecture → flows → story → `explain.json` → check → build → hand over).

What follows the command decides the scope:

- a GitHub PR URL, `owner/repo#123`, or a PR number → that pull request
- `--base <branch>` → the current branch against that branch
- `--committed` or `--uncommitted` → only those changes
- nothing → the current branch against the default branch, including uncommitted and untracked files

Explain, don't review: focus on what the change does and how it changes the architecture. Stay read-only, never run the code, and finish by giving the page's path, offering to open it, and listing anything you couldn't verify.
