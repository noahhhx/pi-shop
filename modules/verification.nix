# Repo verification beyond building packages: the pstack contract test
# (scripts/pstack-check.mjs) enforces the port rules in pstack/ADAPTATIONS.md
# on every flake check, so a sync that misses a rule fails before commit.
{ lib, ... }:
{
  perSystem =
    { pkgs, ... }:
    {
      formatter = pkgs.nixfmt-tree;

      checks = lib.optionalAttrs (builtins.pathExists ../pstack) {
        pstack-check =
          pkgs.runCommand "pi-shop-pstack-check"
            {
              nativeBuildInputs = [ pkgs.nodejs ];
            }
            ''
              node ${../scripts/pstack-check.mjs} ${../pstack}
              touch $out
            '';
      };
    };
}
