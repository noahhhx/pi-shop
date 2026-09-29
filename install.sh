#!/usr/bin/env bash
# Install the pi agent setup: symlink this repo's read-only inputs (the
# global AGENTS.md, skills/, extensions/) into pi's auto-discovery locations
# under ~/.pi/agent/. Everything pi treats as mutable there (settings.json,
# auth.json, sessions) is left alone. Safe to re-run.
#
#   ./install.sh                  # from a checkout of this repo
#   ./install.sh /nix/store/...   # explicit root (used by `nix run .#install`)
#
# Third-party pi packages (package.json deps) are not linked here: on machines
# with nix they come from the flake; elsewhere let pi manage them, e.g.
#
#   pi install git:github.com/noahhhx/pi-shop   # this repo as a pi package,
#                                               # pulls them via npm

set -euo pipefail

root=""
if [ "$#" -gt 0 ]; then
  root="$1"
elif [ -f "$(dirname "$0")/AGENTS.md" ]; then
  root="$(dirname "$0")"
else
  echo "usage: $0 [path-to-this-repo]" >&2
  exit 1
fi
root="$(cd "$root" && pwd)"
agent_dir="$HOME/.pi/agent"

# link <source> <target>: (re)create a symlink; refuse to clobber anything
# that is not a symlink, so pi-managed or hand-made content is never lost.
link() {
  local src="$1" dst="$2"
  if [ -e "$dst" ] && [ ! -L "$dst" ]; then
    echo "refusing to replace non-symlink: $dst" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
}

link "$root/AGENTS.md" "$agent_dir/AGENTS.md"

if [ -d "$root/skills" ]; then
  for entry in "$root"/skills/*/; do
    [ -f "$entry/SKILL.md" ] || continue
    link "$entry" "$agent_dir/skills/$(basename "$entry")"
  done
fi

if [ -d "$root/extensions" ]; then
  for entry in "$root"/extensions/*; do
    [ -e "$entry" ] || continue
    link "$entry" "$agent_dir/extensions/$(basename "$entry")"
  done
fi

echo "pi agent setup installed into $agent_dir"
