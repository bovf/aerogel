# nix/hm-module.nix
#
# Home-Manager module for Aerogel.
#
# The mechanism is the same on every distro: the cursor package ships a D-Bus
# service activation file in share/dbus-1/services/.  When that package is on
# $XDG_DATA_DIRS the session bus auto-starts aerogel-cursor on the first
# Warp() call -- no manual systemctl required, on NixOS or anywhere else.
#
# This module is the NixOS/home-manager wrapper that puts the packages on
# $XDG_DATA_DIRS declaratively.  Non-NixOS users install the packages via
# their distro's package manager and get the same behaviour automatically.
#
# Usage:
#
#   imports = [ inputs.aerogel.homeManagerModules.default ];
#
#   aerogel.enable     = true;
#   aerogel.cursorWarp = true;   # default: true
#
# NixOS note -- ydotoold needs /dev/uinput access.
# Add to your NixOS system config (home-manager cannot set system groups):
#
#   users.users.<youruser>.extraGroups = [ "input" ];
#
# Without it ydotoold fails silently; everything else still works.
#
{ config, lib, pkgs, ... }:

let
  cfg = config.aerogel;

  kwinScriptPkg = import ./package.nix { inherit pkgs; };
  widgetPkg     = import ./widget.nix  { inherit pkgs; };
  cursorPkg     = import ./cursor.nix  { inherit pkgs; };
  iconsPkg      = import ./icons.nix   { inherit pkgs; };
in
{
  options.aerogel = {
    enable = lib.mkEnableOption "Aerogel BSP tiling KWin script and pager widget";

    cursorWarp = lib.mkOption {
      type    = lib.types.bool;
      default = true;
      description = ''
        Install the aerogel-cursor D-Bus service for automatic cursor warping
        when switching focus between monitors on a multi-monitor setup.

        The package ships share/dbus-1/services/org.aerogel.Cursor.service.
        The session bus finds it via $XDG_DATA_DIRS and starts aerogel-cursor
        automatically on the first call -- no manual setup required.

        Requires ydotool on the system and the user in the "input" group.
        Without those, cursor warping is silently disabled; everything else works.
      '';
    };

    innerGap = lib.mkOption {
      type    = lib.types.int;
      default = 8;
      description = "Pixels between adjacent tiled windows.";
    };

    outerGap = lib.mkOption {
      type    = lib.types.int;
      default = 8;
      description = "Pixels between tiled windows and screen edges.";
    };
  };

  config = lib.mkIf cfg.enable {
    # Put packages on $XDG_DATA_DIRS.  That's all that's needed:
    #   - KWin finds the script via share/kwin/scripts/
    #   - Plasma finds the widget via share/plasma/plasmoids/
    #   - Qt finds the icon via share/icons/hicolor/
    #   - D-Bus finds the cursor service via share/dbus-1/services/
    home.packages =
      [ kwinScriptPkg widgetPkg iconsPkg ]
      ++ lib.optional cfg.cursorWarp cursorPkg;

    # plasma-manager requires programs.plasma.enable = true to run its
    # activation scripts that write kwinrc and other Plasma config files.
    programs.plasma.enable = true;

    programs.plasma.configFile.kwinrc = {
      Plugins.aerogelEnabled    = true;
      "Script-aerogel".innerGap = cfg.innerGap;
      "Script-aerogel".outerGap = cfg.outerGap;
    };
  };
}
