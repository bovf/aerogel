# nix/vm/home.nix
#
# Home-Manager configuration for the "aerogel" test user inside the VM.
#
# Uses the aerogel home-manager module, which is the same module end-users
# add to their own config.  The VM is just another consumer of it.
#
{ inputs, pkgs, aerogelModule, ... }:

{
  home.username = "aerogel";
  home.homeDirectory = "/home/aerogel";
  home.stateVersion = "25.11";

  imports = [ aerogelModule ];

  # ── Aerogel ─────────────────────────────────────────────────────────────────
  # enable=true installs KWin script + widget + cursor D-Bus service and writes
  # kwinrc.  cursorWarp=true puts the cursor package on $XDG_DATA_DIRS so the
  # session bus picks up share/dbus-1/services/org.aerogel.Cursor.service and
  # auto-starts aerogel-cursor on first Warp() call -- no manual systemctl needed.
  aerogel.enable     = true;
  aerogel.cursorWarp = true;

  # ── SPICE session agent ─────────────────────────────────────────────────────
  # spice-vdagentd (system daemon) handles the virtio channel.
  # spice-vdagent (user session agent) must also run per-session so it can
  # negotiate absolute mouse mode and clipboard with the Wayland compositor.
  # Without it the pointer is grabbed (relative mode) and Shift+F12 is needed.
  systemd.user.services.spice-vdagent = {
    Unit = {
      Description = "SPICE vdagent -- absolute mouse and clipboard for SPICE sessions";
      After = [ "graphical-session.target" ];
      PartOf = [ "graphical-session.target" ];
    };
    Service = {
      ExecStart = "${pkgs.spice-vdagent}/bin/spice-vdagent -x";
      Restart = "on-failure";
    };
    Install.WantedBy = [ "graphical-session.target" ];
  };

  # ── Panel layout ────────────────────────────────────────────────────────────
  # Declaratively configure the bottom panel so the aerogel pager widget is
  # always present without manual intervention after each VM restart.
  programs.plasma.panels = [
    {
      location = "bottom";
      widgets = [
        "org.kde.plasma.kickoff"
        "org.aerogel.pager"
        "org.kde.plasma.marginsseparator"
        "org.kde.plasma.systemtray"
        "org.kde.plasma.digitalclock"
        "org.kde.plasma.showdesktop"
      ];
    }
  ];

  # ── Shortcut conflict resolution ────────────────────────────────────────────
  # Aerogel bindings and the KDE defaults they displace:
  #
  #   Meta+H/J/K/L               focus (vim)
  #   Meta+Left/Right/Up/Down    focus (arrows) -- displaces KWin quick-tile/maximize/minimize
  #   Meta+Shift+H/J/K/L         swap (vim)
  #   Meta+Shift+Left/Right/Up/Down  swap (arrows) -- displaces KWin quick-tile variants
  #   Meta+1-9,0                 desktop switch -- displaces plasmashell task manager entries
  #   Meta+Shift+1-9,0           move window to desktop
  #   Meta+Space                 float toggle
  #   Meta+Shift+Tab             move workspace to monitor
  #   Meta+F                     fullscreen toggle
  #   Meta+Q                     close window
  #   Meta+Minus / Meta+Equal    resize smart
  #
  programs.plasma.shortcuts = {
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

    # Meta+Shift+Left/Right/Up/Down: KWin quick-tile corners/edges -- clear for arrow swap.
    "kwin"."Window Quick Tile Top"          = [];
    "kwin"."Window Quick Tile Bottom"       = [];
    "kwin"."Window Quick Tile Top Left"     = [];
    "kwin"."Window Quick Tile Top Right"    = [];
    "kwin"."Window Quick Tile Bottom Left"  = [];
    "kwin"."Window Quick Tile Bottom Right" = [];

    # Meta+Shift+Tab: "Walk Through Windows (Reverse)" -- keep only Alt+Shift+Tab,
    # removing Meta+Shift+Tab from both current and default so aerogel can claim it.
    # Meta+Tab ("Walk Through Windows") is intentionally left alone.
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

    # Meta+Minus: KWin "Zoom Out" -- clear so aerogel-resize-shrink works.
    "kwin"."view_zoom_out" = [];

    # Meta+= / Meta++: KWin "Zoom In" -- clear so aerogel-resize-grow works.
    "kwin"."view_zoom_in" = [];
  };
}
