{
  description = "pi agent setup: global instructions, skills, and extensions — via nix, home-manager, pi packages, or plain git";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };

    import-tree.url = "github:denful/import-tree";

    # Claude Code, which the pi-claude-cli provider drives; nixpkgs lags the
    # release it needs.
    nix-claude-code = {
      url = "github:ryoppippi/nix-claude-code";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [
        (inputs.import-tree ./modules)

        inputs.flake-parts.flakeModules.modules
      ];
    };
}
