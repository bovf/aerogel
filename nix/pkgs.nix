# nix/pkgs.nix
#
# Instantiates nixpkgs for a given system and applies any project overlays.
# Called from flake.nix as:
#
#   pkgs = import ./nix/pkgs.nix { inherit nixpkgs system; };
#
{ nixpkgs, system }:

import nixpkgs {
  inherit system;
  # Add project-wide nixpkgs config here (e.g. allowUnfree) if needed.
  config = {};
  # Add overlays here if the project ever needs custom derivations.
  overlays = [];
}
