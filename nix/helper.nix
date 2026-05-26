# nix/helper.nix
#
# Packages aerogel-helper: the D-Bus orchestration service used by the pager
# widget, the toggle keybind, and the KWin script's init/destroy paths.
#
# What gets installed
# ───────────────────
#   $out/bin/aerogel-helper
#       Python script.  Shebang rewritten to a Nix store python at build time
#       -- no PATH lookups at runtime.  Invoked as a service (no args) by the
#       D-Bus session bus, or as a one-shot CLI:
#           aerogel-helper enable | disable | toggle | status
#
#   $out/share/dbus-1/services/org.aerogel.Helper.service
#       D-Bus session-bus activation file.  First method call auto-starts
#       the service.  No manual `systemctl enable` required.
#
#   $out/share/systemd/user/aerogel-helper.service
#       Optional systemd user unit for users who prefer explicit service
#       management over D-Bus activation.
#
# Runtime deps
# ────────────
#   None besides Python + dbus-python + pygobject3.  All KGlobalAccel
#   interaction goes through D-Bus directly (no kreadconfig6/kwriteconfig6
#   shell-outs, no qdbus6) because KGlobalAccel does not watch
#   kglobalshortcutsrc for file changes -- the live daemon state is the
#   only source of truth, and the only way to mutate it is the same
#   setForeignShortcut D-Bus method that System Settings uses.
#
{ pkgs }:

let
  python = pkgs.python3.withPackages (ps: [
    ps.dbus-python
    ps.pygobject3
  ]);
in

pkgs.stdenvNoCC.mkDerivation {
  pname   = "aerogel-helper";
  version = "0.1.0";

  src = ../scripts/aerogel-helper.py;

  dontUnpack = true;
  dontBuild  = true;

  installPhase = ''
    runHook preInstall

    # ── Executable ─────────────────────────────────────────────────────────
    install -Dm755 $src $out/bin/aerogel-helper

    # Rewrite shebang to the bundled python (with dbus-python + pygobject3).
    substituteInPlace $out/bin/aerogel-helper \
      --replace-fail "#!/usr/bin/env python3" "#!${python}/bin/python3"

    # ── D-Bus session service activation file ──────────────────────────────
    install -Dm644 /dev/stdin \
      $out/share/dbus-1/services/org.aerogel.Helper.service << 'EOF'
    [D-BUS Service]
    Name=org.aerogel.Helper
    Exec=${placeholder "out"}/bin/aerogel-helper
    EOF

    # ── systemd user unit (optional) ───────────────────────────────────────
    install -Dm644 /dev/stdin \
      $out/share/systemd/user/aerogel-helper.service << 'EOF'
    [Unit]
    Description=aerogel-helper -- D-Bus orchestration for Aerogel KWin script
    After=graphical-session.target
    PartOf=graphical-session.target

    [Service]
    Type=dbus
    BusName=org.aerogel.Helper
    ExecStart=${placeholder "out"}/bin/aerogel-helper
    Restart=on-failure

    [Install]
    WantedBy=graphical-session.target
    EOF

    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "Aerogel D-Bus orchestration service (toggle, KDE-shortcut snapshot/restore)";
    license     = licenses.gpl3Plus;
    platforms   = platforms.linux;
    mainProgram = "aerogel-helper";
  };
}
