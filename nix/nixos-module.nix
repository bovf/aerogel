# nix/nixos-module.nix
#
# NixOS system-level module for Aerogel.
#
# Handles the one thing home-manager cannot: system-level udev rules and
# group membership required for aerogel-cursor to open /dev/uinput.
#
# aerogel-cursor uses python-evdev to create a UInput virtual input device
# for pixel-accurate absolute cursor positioning on Wayland.  It needs rw
# access to /dev/uinput, which requires the user to be in the "input" group
# and a udev rule granting that group write access.
#
# On Arch/CachyOS most input-related packages already ship the udev rule;
# check with: ls /usr/lib/udev/rules.d/ | grep uinput
# On NixOS no such rule is shipped by default, so this module provides it.
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
        Usernames to add to the "input" group so aerogel-cursor can open
        /dev/uinput for cursor warping.  Equivalent to adding "input" to
        users.users.<name>.extraGroups for each listed user.

        NOTE: group membership changes require a full logout and login
        (or a reboot) to take effect.  After the first deploy, run
        `groups` to verify "input" appears in the output.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    # Give the "input" group rw access to /dev/uinput.
    # Required on NixOS because no package ships a udev rule for this by
    # default (unlike some Arch packages which include 80-uinput.rules).
    services.udev.extraRules = ''
      KERNEL=="uinput", GROUP="input", MODE="0660"
    '';

    # Add each listed user to the input group.
    users.users = lib.mkMerge (map (u: {
      ${u}.extraGroups = [ "input" ];
    }) cfg.users);
  };
}
