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
  # All shortcut conflicts are now cleared by the aerogel home-manager module
  # (nix/hm-module.nix).  No manual clearing needed here.
}
