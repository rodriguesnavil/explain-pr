#!/usr/bin/env bash
# Install the explain-pr skill without the plugin system.
#
#   ./install.sh                 skill → ~/.claude/skills (read by Claude Code and Cursor),
#                                /explain-pr command → ~/.cursor/commands (if Cursor is installed)
#   ./install.sh --claude        only the skill
#   ./install.sh --cursor        skill → ~/.cursor/skills, command → ~/.cursor/commands
#   ./install.sh --project DIR   also add the Cursor rule to DIR/.cursor/rules
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
plugin="$here/plugins/explain-pr"
target="claude"
project=""

while [ $# -gt 0 ]; do
  case "$1" in
    --claude) target="claude" ;;
    --cursor) target="cursor" ;;
    --project) project="${2:?--project needs a folder}"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

command -v node >/dev/null || { echo "explain-pr needs Node.js 18+ (node not found)" >&2; exit 1; }

if [ "$target" = "cursor" ]; then skills="$HOME/.cursor/skills"; else skills="$HOME/.claude/skills"; fi
mkdir -p "$skills"
rm -rf "$skills/explain-pr.tmp"
cp -R "$plugin/skills/explain-pr" "$skills/explain-pr.tmp"
rm -rf "$skills/explain-pr"
mv "$skills/explain-pr.tmp" "$skills/explain-pr"
echo "skill    → $skills/explain-pr"

if [ "$target" = "cursor" ] || [ -d "$HOME/.cursor" ]; then
  mkdir -p "$HOME/.cursor/commands"
  cp "$plugin/cursor/commands/explain-pr.md" "$HOME/.cursor/commands/explain-pr.md"
  echo "command  → $HOME/.cursor/commands/explain-pr.md"
fi

if [ -n "$project" ]; then
  mkdir -p "$project/.cursor/rules"
  cp "$plugin/cursor/rules/explain-pr.mdc" "$project/.cursor/rules/explain-pr.mdc"
  echo "rule     → $project/.cursor/rules/explain-pr.mdc"
fi

node "$skills/explain-pr/scripts/explain-pr.mjs" --version >/dev/null && echo "ok: run /explain-pr in Claude Code or Cursor"
command -v gh >/dev/null || echo "note: install the GitHub CLI (gh) and run 'gh auth login' to explain pull requests"
