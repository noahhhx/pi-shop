# pi-shop

My [pi](https://pi.dev/) coding-agent setup: the global `AGENTS.md`, portable
skills, and the extensions I use — installable via nix/home-manager, as a pi
package, or as a plain git repo.

## Layout

- `AGENTS.md` — portable global agent instructions (consumers append
  machine-specific parts via `extraGlobalInstructions`)
- `skills/` — portable skills (a directory with a `SKILL.md` each;
  machine-specific skills stay in the consuming repo)
- `extensions/` — first-party extensions (`.ts` files or package dirs)
- `pstack/` — the vendored [pstack](https://github.com/cursor/plugins/tree/main/pstack)
  stack (poteto-mode + 53 skills + 2 agent roles), inert until toggled on;
  see [pstack](#pstack)
- `package.json` / `package-lock.json` — third-party pi packages (npm
  dependencies, currently
  [pi-fff](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff),
  [pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents),
  [pi-claude-cli](https://github.com/dmmulroy/pi-claude-cli), and
  [pi-web-access](https://github.com/nicobailon/pi-web-access));
  see [Third-party pi packages](#third-party-pi-packages)
- `packages/` — their nix build, and pi itself (`pi.nix`)
- `modules/` — the flake ([dendritic
  pattern](https://github.com/vic/dendritic), like my NixOS config)

pi owns everything mutable under `~/.pi/agent/` (`settings.json`,
`auth.json`, sessions); every install method below only manages the
read-only inputs above, via pi's auto-discovery locations — except the
pstack links, which only the `/toggle-pstack` switch writes (see
[pstack](#pstack)).

## pstack

`pstack/` vendors [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack)
(152-line poteto-mode SKILL.md, 23 playbooks, 53 portable skills, 2
subagent roles), ported to pi. Seeded from the
[pi-mimir](https://github.com/casualjim/pi-mimir) port (MIT, credited in
`pstack/LICENSE`), then reconciled to the pi-herdr-agents 3.9 API
and stripped of omp branches. Delegation goes through
[pi-herdr-agents](https://github.com/giuseppecrj/pi-herdr-agents)
(`subagent` tool; the `poteto-agent` and `comment-sicko` roles are
registered via its role-pack discovery event, so they only exist when
pstack is on and pi-herdr-agents is installed). Subagents need a Herdr
backend. In the Herdr desktop app (a Herdr Core client), pi-herdr-agents
selects Core from the terminal's `HC_TERMINAL_ID`, with no extra setup;
under the legacy `herdr` TUI it needs `HERDR_ENV=1`. Core has no managed
worktrees, so on Core pstack's parallel writers work in a checkout the
parent creates and passes as `cwd` (see `pstack/ADAPTATIONS.md`).
Everything else works without Herdr.

The tree is deliberately inert: it is in no pi discovery surface and in no
`pi` manifest, and no install method links it into `~/.pi/agent/skills/` or
`extensions/`. Every method only stages it at `~/.pi/agent/pstack-available`
(a non-discovery location). The first-party `extensions/pstack-toggle`
extension is the **sole** writer of the real links:

- `/toggle-pstack` opens an overlay with a master on/off switch and an
  inventory (skills linked, roles, extension, source). `/toggle-pstack on`
  and `/toggle-pstack off` work non-interactively.
- On: one symlink per skill under `~/.pi/agent/skills/` plus the pstack
  extension under `~/.pi/agent/extensions/`, then reload. The extension
  brings sticky Poteto Mode (session entry + `before_agent_start`
  injection), the role pack, and the external-actions confirm guard
  (disable via `$PI_CODING_AGENT_DIR/pstack/config.json`).
- Off (the default): exactly those links are removed, then reload. With
  them gone, nothing from pstack reaches an agent — no skill descriptions,
  no mode injection (even for sessions that have the persisted entry), no
  roles, no commands.
- State: `$PI_CODING_AGENT_DIR/pstack/toggle.json`. Links point at the
  staging location when it exists, so rebuilds swap the staging symlink and
  the toggle's links keep resolving; a rebuild can never re-enable pstack.

The vendor owns `unslop`, `bro`, `technical-writing`, and comment review
(pstack's `comment-sicko` agent + `no-comments` skill): with pstack off
there is no such behavior at all — that is the point of a single master
switch. Only `show-me` remains an independent always-on skill here.

Sync the vendor with upstream on demand ("sync pstack with upstream") via
the `pstack-sync` skill: it diffs against the pinned commit in
`pstack/UPSTREAM.json`, re-applies the port rules in `pstack/ADAPTATIONS.md`,
and runs the contract test `node scripts/pstack-check.mjs` (also part of
`nix flake check`).

## Install

### NixOS / nix + home-manager (declarative)

```nix
imports = [ inputs.pi-shop.homeManagerModules.default ];

programs.pi-shop = {
  enable = true;
  extraGlobalInstructions = builtins.readFile ./machine.md;
};
```

Installs pi (built from `packages/pi.nix`, ahead of nixpkgs) and Claude Code
(from [nix-claude-code](https://github.com/ryoppippi/nix-claude-code), which
pi-claude-cli drives), builds the third-party pi packages from
`package-lock.json`, and symlinks everything into `~/.pi/agent/` without
touching `settings.json`.

### Any nix, no home-manager

```console
$ nix run github:noahhhx/pi-shop#install
```

Runs `install.sh` against a store copy of the content tree.

### pi package (no nix)

```console
$ pi install git:github.com/noahhhx/pi-shop
```

pi manages skills and extensions (incl. the third-party ones, from the
lockfile). Global `AGENTS.md` is not part of pi packages — symlink it from a checkout (next option).

### Plain git

```console
$ git clone https://github.com/noahhhx/pi-shop
$ cd pi-shop && ./install.sh
```

Symlinks `AGENTS.md`, `skills/*`, and `extensions/*` into `~/.pi/agent/`;
for npm-distributed extensions run the `pi install` commands above.

## Third-party pi packages

They are npm dependencies of the root `package.json`, pinned in
`package-lock.json`, and loaded through `node_modules/` entries in its `pi`
manifest (pi's way to bundle other pi packages). Manage them with:

```console
$ nix run .#add -- pi-web-access   # add (any npm spec, e.g. name@1.2.3)
$ nix run .#update                 # bump everything to latest
$ nix run .#update -- pi-web-access  # bump one
$ nix run .#remove -- pi-web-access
$ nix run .#add -- 'git+https://github.com/owner/repo.git#<commit>'  # git pin
```

Each edits only `package.json` and `package-lock.json` (the `pi` manifest
and `bundleDependencies` are derived from what the package declares) —
review, build, commit. There are no nix hashes to update: nix fetches from
the lockfile's integrity hashes, and home-manager links each manifest
entry into `~/.pi/agent/`. Without nix, `node scripts/pkg.mjs add ...`
does the same.

A package that is not on the npm registry is pinned to a GitHub commit.
`update` leaves git pins alone (their npm name can belong to an unrelated
registry package); bump one by re-running `add` with the new commit.
pi-claude-cli is one: its `@saccolabs/pi-claude-cli` name is the older
upstream on npm.

pi-claude-cli runs pi's model calls through the `claude` CLI on your Claude
Pro/Max subscription. Log in once with `claude auth login`, then pick a
`pi-claude-cli` model with `/model`.

pi-web-access gives the agent web tools (`web_search`, `fetch_content`,
`source_check`); pi-claude-cli turns off Claude Code's own WebSearch and
WebFetch. With no keys configured, search goes to Exa's public MCP endpoint.
To add providers, put keys in `~/.pi/agent/web-search.json` as `"$ENV_VAR"`
or `"!command"` references, never as plaintext.

pi-herdr-agents runs subagents in legacy Herdr (`HERDR_ENV=1`) or, since
3.9.0, as child terminals of a Herdr Core terminal (picked from
`HC_TERMINAL_ID`, as in the Herdr desktop app). Its Core backend
launches children with a hard-coded `/bin/bash`, which NixOS lacks, so
`packages/pi-packages.nix` substitutes bash's store path at build time.
The substitution fails the build once upstream changes those lines.
The first-party `extensions/herdr-status` reports pi's own state to Herdr
Core (OSC 7501). Children load it from `~/.pi/agent/extensions/` like the
parent, so they report their status too.

The first-party `extensions/claude-usage` shows your Claude plan limits,
the same numbers as Claude Code's `/usage`. The footer reads
`claude 5h 66% · wk 9%` and refreshes at session start and after each
run, at most once a minute. `/usage` fetches fresh numbers and prints
the session and weekly bars with their reset times. It reads Claude
Code's OAuth token from `~/.claude/.credentials.json` (or
`$CLAUDE_CONFIG_DIR`) and never writes it. Claude Code owns token
refresh, so if the token has expired, run `claude` once.

## Verify changes

```console
$ git add -A               # nix only sees git-tracked files
$ nix fmt -- --ci          # canonical style (nixfmt)
$ nix flake check          # third-party pi packages + the pstack contract test
```
