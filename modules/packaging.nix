# Standalone entry points: the content tree in the store (so install.sh can
# run from a flake instead of a git checkout), the third-party pi packages as
# a nix package for building/testing, and the commands that manage them.
{ lib, ... }:
{
  perSystem =
    { pkgs, config, ... }:
    let
      # Everything install.sh symlinks, copied to the store.
      content = pkgs.runCommand "pi-shop-content" { } ''
        mkdir $out
        cp ${../AGENTS.md} $out/AGENTS.md
        ${lib.optionalString (builtins.pathExists ../skills) "cp -r ${../skills} $out/skills"}
        ${lib.optionalString (builtins.pathExists ../extensions) "cp -r ${../extensions} $out/extensions"}
      '';

      # Apps take a plain outPath string (not the package value) so
      # flake-parts does not lib.getExe-coerce it into a bin/ layout.
      app = name: script: {
        type = "app";
        program = "${pkgs.writeShellScript "pi-shop-${name}" script}";
      };
    in
    {
      packages = {
        # The third-party pi packages; they reach ~/.pi/agent via
        # home-manager (modules/pi-shop.nix), this is for building/testing.
        pi-packages = pkgs.callPackage ../packages/pi-packages.nix { };

        pi-shop-content = content;
      };

      # `nix flake check` builds the packages, catching broken bumps.
      checks = { inherit (config.packages) pi-packages; };

      apps = {
        # Symlink the content into ~/.pi/agent without home-manager.
        install = app "install" ''
          exec bash ${../install.sh} ${content}
        '';
      }
      # `nix run .#add -- <npm-spec>`, `nix run .#update`, `nix run .#remove
      # -- <name>`: edit package.json/package-lock.json in the checkout.
      // lib.genAttrs [ "add" "update" "remove" ] (
        command:
        app command ''
          PATH=${lib.makeBinPath [ pkgs.nodejs ]}:$PATH
          exec node ${../scripts/pkg.mjs} ${command} "$@"
        ''
      );
    };
}
