# The third-party pi packages: the root package.json's dependencies, built
# straight from package-lock.json. importNpmLock fetches every tarball by the
# integrity hash the lockfile records, so there is no nix hash to maintain —
# add/update packages with `nix run .#add` / `nix run .#update` and commit.
#
# pi loads them through the node_modules/ entries of the root "pi" manifest;
# `links` maps those to the names they get under ~/.pi/agent/<type>/ (the
# path, flattened, so scoped packages can't collide).
{
  lib,
  importNpmLock,
  nodejs,
  autoPatchelfHook,
  libgcc,
  jq,
}:
let
  package = lib.importJSON ../package.json;

  linkName =
    entry: lib.replaceStrings [ "@" "/" ] [ "" "-" ] (lib.removePrefix "node_modules/" entry);

  links = lib.genAttrs [ "extensions" "skills" ] (
    type:
    lib.listToAttrs (
      map (entry: lib.nameValuePair (linkName entry) entry) (
        lib.filter (lib.hasPrefix "node_modules/") (package.pi.${type} or [ ])
      )
    )
  );
in
importNpmLock.buildNodeModules {
  inherit package nodejs;
  packageLock = lib.importJSON ../package-lock.json;

  derivationArgs = {
    # pi provides its core modules to extensions at runtime (see .npmrc).
    npmFlags = [ "--legacy-peer-deps" ];

    # Local carries of upstream fixes, applied to the npm package contents in
    # $out. Version-pinned by filename: bumping a patched package must either
    # refresh or drop its patch, or the build fails here — never silently
    # revert to the broken release.
    #
    # pi-herdr-agents: keeps subagent launches from being lost to
    # shell-startup wrappers (devenv's zsh auto-enter hook) — stable-foreground
    # window before keystroke injection + launch verification, so a lost
    # launch fails loudly instead of a phantom "started".
    # Upstream issue: docs/pi-herdr-agents-issue-devenv-shell-launch-race.md.
    postInstall = ''
      patch -p1 -d "$out/node_modules/pi-herdr-agents" \
        < ${./patches/pi-herdr-agents-3.0.1-devenv-shell-launch-race.patch}

      # Fail here rather than at pi startup if a manifest entry is missing or
      # isn't loadable from ~/.pi/agent/extensions, which (unlike a pi package
      # root) only looks for a package.json "pi" manifest or an index.ts/js.
      ${lib.concatMapStrings (entry: ''
        [ -e "$out/${entry}" ] || { echo "missing: ${entry}" >&2; exit 1; }
      '') (lib.attrValues links.skills)}
      ${lib.concatMapStrings (entry: ''
        t="$out/${entry}"
        [ -f "$t/index.ts" ] || [ -f "$t/index.js" ] \
          || jq -e '.pi.extensions | length > 0' "$t/package.json" >/dev/null 2>&1 \
          || { echo "${entry}: not loadable from ~/.pi/agent/extensions" >&2; exit 1; }
      '') (lib.attrValues links.extensions)}
    '';

    # Prebuilt native libraries (e.g. fff's) need their ELF deps patched.
    nativeBuildInputs = [
      autoPatchelfHook
      jq
    ];
    buildInputs = [ libgcc.lib ];

    passthru = { inherit links; };
  };
}
