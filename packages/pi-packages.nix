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
  bash,
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

    # Prebuilt native libraries (e.g. fff's) need their ELF deps patched.
    nativeBuildInputs = [
      autoPatchelfHook
      jq
    ];
    buildInputs = [ libgcc.lib ];

    # Fail here rather than at pi startup if a manifest entry is missing or
    # isn't loadable from ~/.pi/agent/extensions, which (unlike a pi package
    # root) only looks for a package.json "pi" manifest or an index.ts/js.
    postInstall = ''
      # pi-herdr-agents' Herdr Core backend launches children as
      # ["/bin/bash", script], which NixOS lacks: every Core subagent launch
      # dies with "cannot start /bin/bash". --replace-fail breaks the build
      # once an upstream release changes those lines, so a bump revisits it.
      substituteInPlace "$out/node_modules/pi-herdr-agents/maestro/surfaces/herdr/herdr-core-surface-provider.ts" \
        --replace-fail '["/bin/bash", ' '["${lib.getExe bash}", '

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

    passthru = { inherit links; };
  };
}
