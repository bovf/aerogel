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
# NixOS note -- aerogel-cursor needs /dev/uinput access.
# Add to your NixOS system config (or use nixosModules.default):
#
#   aerogel.enable = true;
#   aerogel.users  = [ "youruser" ];
#
# This adds the user to the "input" group and installs the udev rule.
# IMPORTANT: group membership changes require a full logout/login or
# reboot to take effect.  After the first deploy, verify with `groups`.
#
# Without it aerogel-cursor fails silently; everything else still works.
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

        Requires the user to be in the "input" group (for /dev/uinput access).
        Without that, cursor warping is silently disabled; everything else works.
      '';
    };

    forceKeybinds = lib.mkOption {
      type    = lib.types.bool;
      default = true;
      description = ''
        When true (default), aerogel wraps every shortcut override with
        lib.mkForce so its bindings take priority over any other module
        (e.g. your own programs.plasma.shortcuts).  When false, the
        shortcuts block is omitted entirely -- you manage conflicts yourself.
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

    ignoreClass = lib.mkOption {
      type        = lib.types.listOf lib.types.str;
      default     = [];
      description = "WM_CLASS values of windows to never tile (case-insensitive substring match).";
      example     = [ "plasmashell" "krunner" ];
    };

    ignoreName = lib.mkOption {
      type        = lib.types.listOf lib.types.str;
      default     = [];
      description = "Resource names of windows to never tile (case-insensitive substring match).";
    };

    ignoreCaption = lib.mkOption {
      type        = lib.types.listOf lib.types.str;
      default     = [];
      description = "Caption substrings of windows to never tile (case-insensitive).";
      example     = [ "Copied to clipboard" "Picture-in-Picture" ];
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
      "Script-aerogel".innerGap      = cfg.innerGap;
      "Script-aerogel".outerGap      = cfg.outerGap;
      "Script-aerogel".ignoreClass   = lib.concatStringsSep "," cfg.ignoreClass;
      "Script-aerogel".ignoreName    = lib.concatStringsSep "," cfg.ignoreName;
      "Script-aerogel".ignoreCaption = lib.concatStringsSep "," cfg.ignoreCaption;

      # Aerogel changes currentDesktop frequently (every focus change, cursor
      # crossing a monitor boundary, etc.).  The slide desktop-switch effect
      # interprets each change as a full desktop switch and plays a distracting
      # animation.  The script disables it at runtime, but we also disable it
      # declaratively so it doesn't flash on first boot before the script loads.
      Plugins.slideEnabled = false;
    };

    # ── Shortcut management ──────────────────────────────────────────────
    # Two concerns handled here:
    #
    # 1. CONFLICT RESOLUTION: Clear KDE default shortcuts that clash with
    #    aerogel bindings (plasmashell task manager, ksmserver lock, etc.).
    #
    # 2. DECLARATIVE BINDING: Write all aerogel shortcut key sequences to
    #    kglobalshortcutsrc.  This is critical because KGlobalAccel persists
    #    shortcut state -- if a previous aerogel install had conflicts and
    #    KGlobalAccel stored an empty binding for an aerogel action, the
    #    ShortcutHandler QML re-registration will NOT override the persisted
    #    empty binding.  Declaratively writing the bindings ensures they are
    #    always correct regardless of prior state.
    #
    # The script also detects conflicts at runtime (for KDE Store / non-Nix
    # users) and sends a notification, but that's a fallback -- for NixOS
    # users this section is the authoritative source of truth.
    #
    # When forceKeybinds is true (default), every value is wrapped with
    # lib.mkForce so aerogel takes priority over any user-defined shortcuts
    # in other modules (e.g. pl-badwater's shortcuts.nix).  When false, this
    # entire block is omitted and the user manages conflicts themselves.
    programs.plasma.shortcuts = lib.mkIf cfg.forceKeybinds (
      lib.mapAttrs (_component: lib.mapAttrs (_action: lib.mkForce)) {

        # ── 1. Clear conflicting KDE defaults ──────────────────────────────
        # Meta+L: "Lock Session" -- clear so aerogel-focus-right works.
        "ksmserver"."Lock Session" = [];

        # Meta+0: "Zoom to Actual Size" -- clear so aerogel-desktop-10 works.
        "kwin"."view_actual_size" = [];

        # Meta+Left/Right: KWin "Quick Tile" left/right -- clear for arrow focus.
        "kwin"."Window Quick Tile Left"  = [];
        "kwin"."Window Quick Tile Right" = [];

        # Meta+Up/Down: KWin maximize/minimize -- clear for arrow focus.
        "kwin"."Window Maximize" = [];
        "kwin"."Window Minimize" = [];

        # Meta+Shift+Left/Right/Up/Down: KWin quick-tile corners -- clear for arrow swap.
        "kwin"."Window Quick Tile Top"          = [];
        "kwin"."Window Quick Tile Bottom"       = [];
        "kwin"."Window Quick Tile Top Left"     = [];
        "kwin"."Window Quick Tile Top Right"    = [];
        "kwin"."Window Quick Tile Bottom Left"  = [];
        "kwin"."Window Quick Tile Bottom Right" = [];

        # Meta+Shift+Left/Right: KWin "Window to Previous/Next Screen" -- clear for swap.
        "kwin"."Window to Previous Screen" = [];
        "kwin"."Window to Next Screen"     = [];

        # Meta+Shift+Tab: "Walk Through Windows (Reverse)" -- keep only Alt+Shift+Tab.
        "kwin"."Walk Through Windows (Reverse)" = [ "Alt+Shift+Tab" ];

        # Meta+1..9: plasmashell "Activate Task Manager Entry N" -- clear all.
        "plasmashell"."activate task manager entry 1"  = [];
        "plasmashell"."activate task manager entry 2"  = [];
        "plasmashell"."activate task manager entry 3"  = [];
        "plasmashell"."activate task manager entry 4"  = [];
        "plasmashell"."activate task manager entry 5"  = [];
        "plasmashell"."activate task manager entry 6"  = [];
        "plasmashell"."activate task manager entry 7"  = [];
        "plasmashell"."activate task manager entry 8"  = [];
        "plasmashell"."activate task manager entry 9"  = [];
        "plasmashell"."activate task manager entry 10" = [];

        # Meta+Q: "manage activities" -- clear so aerogel-close-window works.
        "plasmashell"."manage activities" = [];

        # Meta+Minus/Equal: KWin "Zoom Out/In" -- clear for resize.
        "kwin"."view_zoom_out" = [];
        "kwin"."view_zoom_in"  = [];

        # ── 2. Declarative aerogel shortcut bindings ───────────────────────
        # These ensure KGlobalAccel has the correct key sequences for all
        # aerogel actions, overriding any stale persisted state.

        # Focus navigation (vim keys)
        "kwin"."aerogel-focus-left"  = "Meta+H";
        "kwin"."aerogel-focus-down"  = "Meta+J";
        "kwin"."aerogel-focus-up"    = "Meta+K";
        "kwin"."aerogel-focus-right" = "Meta+L";

        # Focus navigation (arrow keys)
        "kwin"."aerogel-focus-left-arrow"  = "Meta+Left";
        "kwin"."aerogel-focus-down-arrow"  = "Meta+Down";
        "kwin"."aerogel-focus-up-arrow"    = "Meta+Up";
        "kwin"."aerogel-focus-right-arrow" = "Meta+Right";

        # Window swap/move (vim keys)
        "kwin"."aerogel-move-left"  = "Meta+Shift+H";
        "kwin"."aerogel-move-down"  = "Meta+Shift+J";
        "kwin"."aerogel-move-up"    = "Meta+Shift+K";
        "kwin"."aerogel-move-right" = "Meta+Shift+L";

        # Window swap/move (arrow keys)
        "kwin"."aerogel-move-left-arrow"  = "Meta+Shift+Left";
        "kwin"."aerogel-move-down-arrow"  = "Meta+Shift+Down";
        "kwin"."aerogel-move-up-arrow"    = "Meta+Shift+Up";
        "kwin"."aerogel-move-right-arrow" = "Meta+Shift+Right";

        # Desktop switching (Meta+1..9,0; 0 = desktop 10)
        "kwin"."aerogel-desktop-1"  = "Meta+1";
        "kwin"."aerogel-desktop-2"  = "Meta+2";
        "kwin"."aerogel-desktop-3"  = "Meta+3";
        "kwin"."aerogel-desktop-4"  = "Meta+4";
        "kwin"."aerogel-desktop-5"  = "Meta+5";
        "kwin"."aerogel-desktop-6"  = "Meta+6";
        "kwin"."aerogel-desktop-7"  = "Meta+7";
        "kwin"."aerogel-desktop-8"  = "Meta+8";
        "kwin"."aerogel-desktop-9"  = "Meta+9";
        "kwin"."aerogel-desktop-10" = "Meta+0";

        # Move window to desktop (Meta+Shift+1..9,0)
        "kwin"."aerogel-move-to-desktop-1"  = "Meta+Shift+1";
        "kwin"."aerogel-move-to-desktop-2"  = "Meta+Shift+2";
        "kwin"."aerogel-move-to-desktop-3"  = "Meta+Shift+3";
        "kwin"."aerogel-move-to-desktop-4"  = "Meta+Shift+4";
        "kwin"."aerogel-move-to-desktop-5"  = "Meta+Shift+5";
        "kwin"."aerogel-move-to-desktop-6"  = "Meta+Shift+6";
        "kwin"."aerogel-move-to-desktop-7"  = "Meta+Shift+7";
        "kwin"."aerogel-move-to-desktop-8"  = "Meta+Shift+8";
        "kwin"."aerogel-move-to-desktop-9"  = "Meta+Shift+9";
        "kwin"."aerogel-move-to-desktop-10" = "Meta+Shift+0";

        # Shifted-symbol alternatives (US-EN SPICE fallback)
        "kwin"."aerogel-move-to-desktop-1-sym"  = "Meta+!";
        "kwin"."aerogel-move-to-desktop-2-sym"  = "Meta+@";
        "kwin"."aerogel-move-to-desktop-3-sym"  = "Meta+#";
        "kwin"."aerogel-move-to-desktop-4-sym"  = "Meta+$";
        "kwin"."aerogel-move-to-desktop-5-sym"  = "Meta+%";
        "kwin"."aerogel-move-to-desktop-6-sym"  = "Meta+^";
        "kwin"."aerogel-move-to-desktop-7-sym"  = "Meta+&";
        "kwin"."aerogel-move-to-desktop-8-sym"  = "Meta+*";
        "kwin"."aerogel-move-to-desktop-9-sym"  = "Meta+(";
        "kwin"."aerogel-move-to-desktop-10-sym" = "Meta+)";

        # Monitor / float / fullscreen / close / resize
        "kwin"."aerogel-next-monitor"      = "Meta+Backtab";
        "kwin"."aerogel-float-toggle"      = "Meta+Space";
        "kwin"."aerogel-fullscreen-toggle"  = "Meta+F";
        "kwin"."aerogel-close-window"      = "Meta+Q";
        "kwin"."aerogel-resize-shrink"     = "Meta+Minus";
        "kwin"."aerogel-resize-grow"       = "Meta+Equal";
      }
    );
  };
}
