# The "pi-shop" aspect: pi's global read-only inputs — the portable
# AGENTS.md base, skills, and extensions — symlinked into pi's
# auto-discovery locations under ~/.pi/agent/. Everything pi treats as
# mutable there (settings.json, auth.json, sessions) is left alone.
{ config, lib, ... }:
{
  flake.modules.homeManager.pi-shop =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.programs.pi-shop;

      # Third-party pi packages (root package.json dependencies): each
      # node_modules/ entry of the root "pi" manifest, linked into the
      # matching ~/.pi/agent/<type>/ directory.
      piPackages = pkgs.callPackage ../packages/pi-packages.nix { };
      packagedResources = lib.concatMapAttrs (
        type:
        lib.mapAttrs' (
          name: entry: lib.nameValuePair ".pi/agent/${type}/${name}" { source = "${piPackages}/${entry}"; }
        )
      ) piPackages.links;

      # First-party extensions: drop .ts files (or package dirs) under
      # ../extensions to have them auto-loaded globally.
      firstPartyExtensions = lib.optionalAttrs (builtins.pathExists ../extensions) (
        lib.mapAttrs'
          (name: _: lib.nameValuePair ".pi/agent/extensions/${name}" { source = ../extensions + "/${name}"; })
          (
            lib.filterAttrs (name: type: type != "unknown" && !lib.hasPrefix "." name) (
              builtins.readDir ../extensions
            )
          )
      );

      # Portable skills: each directory under ../skills becomes a global
      # skill (pi discovers <dir>/SKILL.md recursively).
      portableSkills = lib.optionalAttrs (builtins.pathExists ../skills) (
        lib.mapAttrs'
          (name: _: lib.nameValuePair ".pi/agent/skills/${name}" { source = ../skills + "/${name}"; })
          (
            lib.filterAttrs (name: type: type == "directory" && !lib.hasPrefix "." name) (
              builtins.readDir ../skills
            )
          )
      );

      # The portable base from this repo, with the consumer's optional
      # machine-specific additions appended.
      agentsMd =
        if cfg.extraGlobalInstructions == "" then
          ../AGENTS.md
        else
          pkgs.writeText "AGENTS.md" ''
            ${builtins.readFile ../AGENTS.md}

            ${cfg.extraGlobalInstructions}
          '';
    in
    {
      options.programs.pi-shop = {
        enable = lib.mkEnableOption "pi agent setup: global AGENTS.md, skills, and extensions";

        extraGlobalInstructions = lib.mkOption {
          type = lib.types.lines;
          default = "";
          description = ''
            Machine-specific global agent instructions, appended to the
            portable base in this repo's AGENTS.md.
          '';
        };
      };

      config = lib.mkIf cfg.enable {
        home.file = {
          ".pi/agent/AGENTS.md".source = agentsMd;
        }
        // packagedResources
        // firstPartyExtensions
        // portableSkills;
      };
    };

  # Expose the aspect as a standard flake output: external consumers use
  # `imports = [ inputs.pi-shop.homeManagerModules.default ]`. The
  # flake.modules.homeManager namespace stays repo-internal.
  flake.homeManagerModules.default = config.flake.modules.homeManager.pi-shop;
}
