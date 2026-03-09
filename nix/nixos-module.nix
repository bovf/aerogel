# nix/nixos-module.nix
#
# NixOS system-level module for Aerogel.
#
# Handles the one thing home-manager cannot: system-level udev rules and
# group membership required for ydotoold to open /dev/uinput.
#
# On Arch/CachyOS the ydotool package already ships
# /usr/lib/udev/rules.d/80-uinput.rules -- no extra steps needed there.
# On NixOS the nixpkgs ydotool does not include that rule, so this module
# provides it.
#
# Usage -- NixOS system config (configuration.nix or equivalent):
#
#   imports = [ inputs.aerogel.nixosModules.default ];
#
#   aerogel.enable = true;          # udev rule + input group for <username>
#   aerogel.users  = [ "alice" ];   # users that should be in the input group
#
# Pair with the home-manager module in each user's home.nix:
#
#   imports = [ inputs.aerogel.homeManagerModules.default ];
#   aerogel.enable     = true;
#   aerogel.cursorWarp = true;
#
{ config, lib, ... }:

let
  cfg = config.aerogel;
in
{
  options.aerogel = {
    enable = lib.mkEnableOption "Aerogel system-level support (udev rule for cursor warping)";

    users = lib.mkOption {
      type        = lib.types.listOf lib.types.str;
      default     = [];
      description = ''
        Usernames to add to the "input" group so ydotoold can open
        /dev/uinput for cursor warping.  Equivalent to adding "input" to
        users.users.<name>.extraGroups for each listed user.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # Give the "input" group rw access to /dev/uinput.
    # Required on NixOS because nixpkgs' ydotool does not ship a udev rule
    # for this (unlike the Arch package which includes 80-uinput.rules).
    services.udev.extraRules = ''
      KERNEL=="uinput", GROUP="input", MODE="0660"
    '';

    # Add each listed user to the input group.
    users.users = lib.mkMerge (map (u: {
      ${u}.extraGroups = [ "input" ];
    }) cfg.users);
  };
}
