# nix/cursor.nix
#
# Packages aerogel-cursor: the D-Bus cursor-warp helper used by the KWin
# script to move the pointer across monitors on Wayland.
#
# What gets installed
# ───────────────────
#   $out/bin/aerogel-cursor
#       Python script.  Shebang and ydotool/ydotoold paths are all rewritten
#       to Nix store paths at build time -- no PATH lookups at runtime.
#
#   $out/share/dbus-1/services/org.aerogel.Cursor.service
#       D-Bus service activation file.  The session bus starts aerogel-cursor
#       automatically on the first Warp() call -- no manual systemctl needed.
#       Works on any distro that respects $XDG_DATA_DIRS for D-Bus services
#       (all major desktop distros do).
#
#   $out/share/systemd/user/aerogel-cursor.service
#       Optional systemd user unit for users who prefer explicit service
#       management over D-Bus activation.
#
# NixOS / home-manager
# ────────────────────
#   Add this package (or packages.default) to home.packages, or use the
#   aerogel home-manager module with aerogel.cursorWarp = true (default).
#   home-manager puts the package on $XDG_DATA_DIRS -- the D-Bus daemon finds
#   the activation file automatically.  No manual setup required.
#
#   The user must be in the "input" group so ydotoold can open /dev/uinput:
#     users.users.<name>.extraGroups = [ "input" ];   # in NixOS system config
#
# Non-Nix distros
# ───────────────
#   Install ydotool from your distro's package manager, then install this
#   package.  The D-Bus activation file does the rest automatically.
#   Python dependencies (dbus-python, python3-gi) must also be installed.
#
{ pkgs }:

let
  python = pkgs.python3.withPackages (ps: [ ps.dbus-python ps.pygobject3 ]);
in

pkgs.stdenvNoCC.mkDerivation {
  pname   = "aerogel-cursor";
  version = "0.1.0";

  src = ../scripts/aerogel-cursor.py;

  dontUnpack = true;
  dontBuild  = true;

  installPhase = ''
    runHook preInstall

    # ── Wrapped executable ─────────────────────────────────────────────────
    install -Dm755 $src $out/bin/aerogel-cursor

    # Rewrite shebang and ydotool/ydotoold paths to Nix store paths.
    # No PATH lookups at runtime -- the script is fully self-contained.
    substituteInPlace $out/bin/aerogel-cursor \
      --replace-fail "#!/usr/bin/env python3"   "#!${python}/bin/python3" \
      --replace-fail '"ydotoold"'               '"${pkgs.ydotool}/bin/ydotoold"' \
      --replace-fail '"ydotool"'                '"${pkgs.ydotool}/bin/ydotool"'

    # ── D-Bus session service activation file ──────────────────────────────
    # The session D-Bus daemon scans $XDG_DATA_DIRS/dbus-1/services/ and
    # auto-starts the listed executable on the first method call.
    install -Dm644 /dev/stdin \
      $out/share/dbus-1/services/org.aerogel.Cursor.service << 'EOF'
    [D-BUS Service]
    Name=org.aerogel.Cursor
    Exec=${placeholder "out"}/bin/aerogel-cursor
    EOF

    # ── systemd user unit (optional / for explicit service management) ─────
    install -Dm644 /dev/stdin \
      $out/share/systemd/user/aerogel-cursor.service << 'EOF'
    [Unit]
    Description=aerogel-cursor -- D-Bus cursor warp service for Aerogel KWin script
    Documentation=https://github.com/youruser/aerogel
    After=graphical-session.target
    PartOf=graphical-session.target

    [Service]
    Type=dbus
    BusName=org.aerogel.Cursor
    ExecStart=${placeholder "out"}/bin/aerogel-cursor
    Restart=on-failure

    [Install]
    WantedBy=graphical-session.target
    EOF

    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "Aerogel cursor-warp D-Bus service (requires ydotool at runtime)";
    license     = licenses.gpl3Plus;
    platforms   = platforms.linux;
    mainProgram = "aerogel-cursor";
  };
}
