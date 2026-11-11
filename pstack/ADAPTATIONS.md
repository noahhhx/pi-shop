# pstack adaptation layer (the sync contract)

This tree is cursor/plugins' `pstack/`, ported to pi. `UPSTREAM.json` is the
sync point (repo, path, pinned commit, exclusions); this file is the port
rules the sync skill re-applies on every upstream sync. Diff vendored vs
upstream, classify each delta, then apply the rules below.

**Seed provenance.** The initial tree (2026-10-06) was seeded from
[`@casualjim/pi-pstack` 0.1.12](https://www.npmjs.com/package/@casualjim/pi-pstack)
(the [pi-mimir](https://github.com/casualjim/pi-mimir) port, MIT, credited in
`LICENSE`), which was published 2026-10-05 18:31 UTC against upstream at
~#508/#509, then reconciled to the pi-herdr-agents 3.x API and stripped of
omp branches. Upstream commit `#511` ("drop Sol, default to Opus xhigh and
Grok") postdates the seed; its model-default lines are already absorbed by
the config-driven model rule below, so a sync diff on those lines is expected
adaptation, not drift. After the initial sync, cursor/plugins is the only
sync source. Consider watching pi-mimir for port ideas, never sync from it.

## Scope

Keep only `skills/*` and `agents/*` (plus this repo's adapted
`extensions/pstack/`). Exclude `make-bot-ui`, `setup-pstack`, `poteto-help`
(Cursor-only), `ketchup-video` (its whole output is an mp4 embedded inline
in the chat reply; pi's terminal reply cannot play or embed video, and
`ketchup` already covers the catch-up), and everything outside `skills/` +
`agents/`:
`.cursor-plugin`, `automations`, `docs`, `assets`, `README.md`, `LICENSE`
(this tree carries its own). The exclusion list lives in `UPSTREAM.json`.

## Inherited, not diverged

Upstream already sets `disable-model-invocation: true` on every skill and
pstack is mode-driven (poteto-mode routes to sibling skills by name; the user
invokes `/skill:<name>`). Keep it; do not "fix" it away.

## Frontmatter

- Drop Cursor-only keys: `mode`, `icon`, `color`, `reminder`.
- `name` is kebab-case and matches the skill's directory name.
- Agent files keep pi-herdr-agents' strict frontmatter: unquoted inline
  `tools: read, grep, find, ls, bash`, `spawning:`/`auto-exit:` as bare
  `true`/`false`, `system-prompt: append`. No YAML lists, no quotes.

## Model routing — config-driven, model-agnostic

Upstream hardcodes model IDs inline plus a `~/.cursor/rules/pstack-models.mdc`
role-line config. The port routes every model choice through pi-herdr-agents:

- `model: task:<category>` on the `subagent` call, with herdr's fixed
  categories: coding, review, recon, qa, architecture, docs.
- Or an exact authenticated model ID for a named seat (a model race arm).
- Omitting `model` inherits the parent model. No hardcoded model slug may
  exist for the port to work.
- Families referenced anywhere are broad: `claude-*`, `gpt-*`, `grok-*`.
- Configure pools through `subagents_write_task_models`; pin an agent via
  `models.agents` in `~/.pi/agent/herdr-agents/config.json`.
- Unresolvable slug recovery stays: pick another authenticated model, closest
  family first, never block the workflow on the slug.

Upstream's bespoke per-workflow pools (why-investigators, swarm-workers,
interrogate reviewers, arena-runners, how-explainer, …) map to the fixed
categories: implementation workers → `task:coding`, reviewers/judges/
synthesizers → `task:review`, scouts/investigators/explorers → `task:recon`,
verification lanes → `task:qa`, planning and diagnosis →
`task:architecture`, prose output → `task:docs`. The same goes for every
"`<role>` line in `pstack-models.mdc` (default `<slug>`)" sentence and each
playbook's "your configured `<playbook>` model": they become the matching
category.

Upstream's "pick each subagent's reasoning level and fast or standard
speed" becomes "pick each subagent's `thinking` level" (the `subagent`
tool's `thinking` parameter, `off` through `max`). Pi has no fast-speed
model variant, so the speed half and the "use fast mode only when urgent"
rules drop. A cross-family judge (arena Phase C) keeps its rule: when
`task:review` resolves to the parent's family, pass an exact ID from
another family, or skip the judge and say so.

## Subagent call shape (pi-herdr-agents 3.x)

The only `subagent` parameters are `name, task, agent, systemPrompt, model,
thinking, skills, tools, cwd, worktree, fork, persistent, interactive`.
Upstream's Cursor `Task` tool and pi-herdr-agents 2.x idioms are both
forbidden:

- No `role:` argument, no `tasks:` array for parallel spawns, no `chain`
  sequential mode, no 8-tasks/4-children limits, no `environment:`
  (cloud/local), no `run_in_background`, no `readonly:` flag.
- Parallel fan-out is N plain `subagent` calls in one message.
- Read-only posture is prose ("do not grant write/edit tools"), because the
  tool has no readonly flag.
- Workers run locally with isolated context: briefs inline or point at repo
  paths; never assume cloud execution, cloud base branches, or a sandbox.
- A worker starting from a non-default branch gets it named in its brief or a
  `worktree` based off that branch.

## Transcripts

Upstream globs `~/.cursor/projects/<slug>/agent-transcripts/*.jsonl`. The port
uses `$PI_SESSION_FILE` for the active transcript and the `recall` tool for
earlier same-project sessions. Never glob Pi's global session directory (it
crosses project boundaries). Also applied in `scripts/worktree-audit.sh`.

## Path and command mechanics

- `/cmd` → `/skill:cmd`.
- `.cursor/skills/` → `.pi/skills/`; `~/.cursor/skills/` →
  `~/.pi/agent/skills/`.
- Upstream dogfoods pstack inside cursor/plugins, so it names skills by repo
  path (`pstack/skills/<name>/…`, often as `git show origin/main:pstack/…`
  "read from trunk"). Here pstack is never in the repo an agent works in:
  inside a skill's own prose use a skill-relative path (`scripts/…`,
  `playbooks/…`); in text written out to other repos (plan templates) use
  the installed path `~/.pi/agent/skills/<name>/…` and drop "from trunk".
  `git show origin/main:` stays only for the project's own files (a control
  skill path), which also keeps `check-plan.mjs`'s marker satisfied.
- `AskQuestion` → plain "ask the user" prose.
- Cursor cloud agents (autopilot owners, shipping verifiers, orchestrate
  workers on "a new cloud VM") → Pi subagents running locally. The Cursor
  Project tracker and store, and "the root agent's store (path in the system
  prompt)", → an uncommitted `notes.md` / `decisions.tsv` trail at a path the
  root's brief names, with spawned children recorded in a `children.tsv`
  beside it. "Fork a worker for its built state" → `subagent_resume` for an
  exited ordinary child, `subagent_send` for a persistent specialist.
- Inline media in the reply (ketchup's embedded screenshots and videos) →
  give each file by path or link; `/visualize` charts → "a chart from
  available tooling".
- `reflect`'s "never edit a skill under `plugins/cache/`" → never edit a
  skill in place inside a staged package tree (the pstack tree that
  `~/.pi/agent/skills/` links into); copy it to the project's `.pi/skills/`.
- Disclaimers that only disambiguate a Cursor built-in ("not Cursor's
  built-in babysit skill") are dropped.
- `statechart` keeps upstream's mise bootstrap and documents the script's
  own `TLA2TOOLS` / `JAVA` escape for hosts where mise's Java cannot run
  (NixOS).
- Cursor built-ins become detect-installed-or-drop: `create-skill` → "the Pi
  Agent Skills standard", `deslop` → "a manual diff cleanup pass",
  `control-cli`/`control-ui` → "available project UI or CLI verification
  tooling", Cursor's bugbot → generic triage against
  `references/bugbot-triage.md`.

## Scripts

- `CURSOR_AUTOMATION_ID` → `PSTACK_AUTOMATION_ID`.
- Automation-comment author match `author === "cursor"` →
  `author.includes("automation")`.
- Package scope `@cursor-skill/*` → `@pi-pstack/*` (`poteto-mode-tools`,
  `statechart`), including the lockfile's workspace name.
- Upstream's `/loop` cadence markers become explicit pi watchers (a blocking
  `sleep 3600` whose completion wakes the tick).
- `poteto-mode/scripts/bootstrap.ts`: when the scripts directory is not
  writable (home-manager stages this tree in the nix store), it copies the
  directory to `${XDG_CACHE_HOME:-~/.cache}/pstack/poteto-mode-tools/<key>`,
  installs deps there, and re-executes the script from the copy. A sync that
  takes upstream's bootstrap re-applies this.
- Every file with a shebang keeps its executable bit (npm-pack seeding
  dropped it; playbooks run `scripts/watch-pr/watch-pr` directly).

## omp branches — stripped (this port is pi-only)

pi-mimir is pi+omp compatible; this tree is not. Drop every "`/loop` in omp,
or an explicit watcher command in pi" clause (keep the pi branch), omp's
`github` tool, omp host detection, and any "cloud vs local roots" prose. The
audit-tick cadence arms an explicit hourly watcher in pi.

## pi-mimir additions this tree keeps

- Sticky Poteto Mode: session custom entry `pstack-mode` + `before_agent_start`
  injection (replaces Cursor custom modes) — in `extensions/pstack/`.
- The extension resolves its package root through `realpathSync` on
  `import.meta.url`: unlike pi-mimir's npm layout (real node_modules path),
  this tree's extension is loaded through a symlink, and a literal
  `import.meta.url` would resolve relative to the link, not the vendored
  tree.
- The external-actions confirm guard (`tool_call` on `bash`, push/pr-mutate/
  deploy/`rm -r` patterns), config at
  `$PI_CODING_AGENT_DIR/pstack/config.json` (`confirmExternalActions: false`
  to disable) — kept as pstack's own safety posture.
- Small authorial edits (a Review checklist section in `technical-writing`,
  rigor-bias lines in `figure-it-out`) — treat them as ours; a sync that
  would delete them re-applies them after merging upstream's change.

## Ownership note

This repo deliberately does **not** carry `skills/unslop`, `skills/bro`, or
`skills/technical-writing` at the top level: pstack owns them here. Toggling
pstack off removes them too; that is the point of the master switch.

## Contract

`node scripts/pstack-check.mjs` (from the pi-shop root) enforces all of the
above mechanically. Run it as part of every sync.
