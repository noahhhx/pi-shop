---
name: pstack-sync
description: Sync the vendored pstack tree (pstack/) with upstream cursor/plugins. Use when asked to "sync pstack", "update pstack", or "pull upstream pstack changes".
---

# pstack sync

Sync `pstack/` with upstream. Judgment beats patch files for a prose port: read the
deltas, classify them, re-apply the adaptation layer, never blind-copy.

1. Read `pstack/UPSTREAM.json` (pinned commit, syncedAt, exclusions) and
   `pstack/ADAPTATIONS.md` (the port rules — the sync contract this run must
   preserve). Both live in the pi-shop checkout root.
2. Fetch upstream: `git clone --depth 1 --filter=blob:none --sparse
   https://github.com/cursor/plugins <tmp>` then `git sparse-checkout set pstack`
   inside it. Note the new HEAD commit.
3. Diff vendored vs upstream (`diff -r pstack/skills <tmp>/pstack/skills` and
   `diff -r pstack/agents <tmp>/pstack/agents`), classify each file: new /
   changed / removed / newly-Cursor-only.
4. Apply the exclusions from `UPSTREAM.json` (`make-bot-ui`, `setup-pstack`,
   `poteto-help`, everything outside `skills/` + `agents/`). Deleted upstream
   skills are deleted here too.
5. Re-apply the adaptation layer per `ADAPTATIONS.md` to every changed or new
   file: kebab-case `name` matching dirname; `/skill:<name>` command syntax;
   drop Cursor-only frontmatter (`mode`, `icon`, `color`, `reminder`);
   Cursor idioms → pi idioms (control skills → detect-installed-or-drop,
   `AskQuestion` → classify-then-ask, subagent spawning → the pi-herdr-agents
   `subagent` tool with N plain calls for parallel fan-out, task tracking stays
   `set_tasks`, which the pstack extension provides (keep upstream's prose), cadence → explicit pi watchers); model routing stays
   config-driven (`model: task:<category>`, exact IDs, or inherit-parent; no
   hardcoded slugs); strip every omp branch (this port is pi-only). When a
   call is genuinely hard (poteto-mode SKILL.md, playbooks), consult the
   `@casualjim/pi-pstack` port (`npm pack @casualjim/pi-pstack` in a temp dir)
   as a reference for the shape — but never sync from it.
6. If you invented a new adaptation this run (a rule that was not in
   `ADAPTATIONS.md`), add it there. The file is the contract; future syncs
   re-apply it.
7. Run the contract test: `nix shell nixpkgs#nodejs --command node
   scripts/pstack-check.mjs` from the repo root. Fix everything it reports.
8. Update `UPSTREAM.json` (`commit`, `syncedAt`). Stage everything, then run
   `nix fmt -- --ci && nix flake check`. Commit with a summary of the upstream
   commit range applied (`git log <old>..<new> --oneline -- pstack/` from the
   sparse clone gives it).

Never edit `~/.pi/agent/` during a sync; the vendored tree is staged by
`install.sh` / home-manager, and the `pstack-toggle` extension decides what
is linked. If the sync changes skill names (new or removed skills), the user
must re-run `/toggle-pstack` (toggle off then on) to re-point the links.
