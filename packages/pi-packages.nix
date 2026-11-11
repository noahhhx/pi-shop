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
  runCommand,
}:
let
  package = lib.importJSON ../package.json;
  lock = lib.importJSON ../package-lock.json;

  isGitPin = module: lib.hasPrefix "git+" (module.resolved or "");

  # importNpmLock hands a git dependency (pinned by commit; see scripts/pkg.mjs)
  # to npm as a store directory, which npm links instead of installing, so the
  # dependency's own dependencies never reach node_modules. A tarball of the
  # same commit installs like a registry package. Its bytes differ from the
  # `npm pack` output the lockfile's integrity describes, so that is dropped;
  # the commit already pins the content.
  packageLock = lock // {
    packages = lib.mapAttrs (
      _: module: if isGitPin module then removeAttrs module [ "integrity" ] else module
    ) lock.packages;
  };
  gitTarballs = lib.mapAttrs (
    path: module:
    let
      pin = builtins.match "git\\+(https://[^#]+)#([0-9a-f]{40})" module.resolved;
      src = builtins.fetchGit {
        url = lib.elemAt pin 0;
        rev = lib.elemAt pin 1;
      };
    in
    runCommand "${baseNameOf path}.tgz" { } ''
      tar --create --gzip --file=$out --directory=${src} --transform='s,^\.,package,' .
    ''
  ) (lib.filterAttrs (_: isGitPin) lock.packages);

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
  inherit package packageLock nodejs;

  derivationArgs = {
    npmDeps = importNpmLock {
      inherit package packageLock;
      packageSourceOverrides = gitTarballs;
    };

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

      # Opening a running subagent in a Herdr app pane turns on core keep, and
      # getOwned reads keep as "ownership changed": every later inspection is
      # "unavailable", so a finished child's result is never delivered and the
      # parent waits forever. Keep is a user-toggled flag, not identity, which
      # created_ms, cwd, argv and parent already pin. Only getOwned's check is
      # dropped; the launch-time one stays.
      substituteInPlace "$out/node_modules/pi-herdr-agents/maestro/surfaces/herdr/herdr-core-surface-provider.ts" \
        --replace-fail ${lib.escapeShellArg "terminal.keep ||\n\t\t\tterminal.rm ||\n\t\t\t(expected &&"} \
          ${lib.escapeShellArg "terminal.rm ||\n\t\t\t(expected &&"}

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
