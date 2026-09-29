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
- `package.json` / `package-lock.json` — third-party pi packages (npm
  dependencies, currently
  [pi-fff](https://github.com/dmtrKovalenko/fff/tree/main/packages/pi-fff));
  see [Third-party pi packages](#third-party-pi-packages)
- `packages/` — their nix build
- `modules/` — the flake ([dendritic
  pattern](https://github.com/vic/dendritic), like my NixOS config)

pi owns everything mutable under `~/.pi/agent/` (`settings.json`,
`auth.json`, sessions); every install method below only manages the
read-only inputs above, via pi's auto-discovery locations.

## Install

### NixOS / nix + home-manager (declarative)

```nix
imports = [ inputs.pi-shop.homeManagerModules.default ];

programs.pi-shop = {
  enable = true;
  extraGlobalInstructions = builtins.readFile ./machine.md;
};
```

Builds the third-party pi packages from `package-lock.json` and symlinks
everything into `~/.pi/agent/` without touching `settings.json`.

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
```

Each edits only `package.json` and `package-lock.json` (the `pi` manifest
and `bundleDependencies` are derived from what the package declares) —
review, build, commit. There are no nix hashes to update: nix fetches from
the lockfile's integrity hashes, and home-manager links each manifest
entry into `~/.pi/agent/`. Without nix, `node scripts/pkg.mjs add ...`
does the same.

## Verify changes

```console
$ git add -A               # nix only sees git-tracked files
$ nix fmt -- --ci          # canonical style (nixfmt)
$ nix flake check          # includes building the third-party pi packages
```
