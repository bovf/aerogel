#!/usr/bin/env python3
"""
aerogel-cursor -- tiny D-Bus service for cursor warping.

Exposes:
  bus name : org.aerogel.Cursor
  object   : /org/aerogel/Cursor
  interface: org.aerogel.Cursor
  method   : Warp(x: int32, y: int32)

Called from the KWin script via callDBus whenever aerogel needs to move
focus to a different monitor but the target workspace is empty (no window
to activate, so workspace.activeScreen would not update automatically).

This service is D-Bus-activatable: the session bus starts it automatically
on the first Warp() call -- no manual `systemctl enable` required.

On NixOS the shebang and the YDOTOOLD / YDOTOOL constants below are
rewritten to Nix store paths at build time (see nix/cursor.nix).
On other distros, ydotool and python3-dbus / python3-gi must be installed
system-wide; the constants fall back to plain binary names resolved via PATH.
"""

import os
import subprocess
import sys
import time

try:
    import dbus
    import dbus.service
    import dbus.mainloop.glib
    from gi.repository import GLib
except ImportError:
    sys.exit("aerogel-cursor: missing dbus-python or pygobject")

BUS_NAME       = "org.aerogel.Cursor"
OBJ_PATH       = "/org/aerogel/Cursor"
INTERFACE      = "org.aerogel.Cursor"
YDOTOOL_SOCKET = os.environ.get("YDOTOOL_SOCKET", "/tmp/.ydotool_socket")

# These two constants are substituted with absolute Nix store paths at build
# time on NixOS.  On other distros they stay as bare names and are resolved
# via PATH by the shell / subprocess.
YDOTOOLD = "ydotoold"
YDOTOOL  = "ydotool"


def _ensure_ydotoold() -> None:
    """Start ydotoold if its socket does not exist yet."""
    if os.path.exists(YDOTOOL_SOCKET):
        return
    subprocess.Popen(
        [YDOTOOLD],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    # Give ydotoold a moment to create the socket.
    for _ in range(20):
        if os.path.exists(YDOTOOL_SOCKET):
            break
        time.sleep(0.05)


class CursorService(dbus.service.Object):
    def __init__(self, bus: dbus.SessionBus) -> None:
        bus_name = dbus.service.BusName(BUS_NAME, bus)
        super().__init__(bus_name, OBJ_PATH)

    @dbus.service.method(INTERFACE, in_signature="ii", out_signature="")
    def Warp(self, x: int, y: int) -> None:
        _ensure_ydotoold()
        subprocess.Popen(
            [YDOTOOL, "mousemove", "--absolute", "-x", str(int(x)), "-y", str(int(y))],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def main() -> None:
    _ensure_ydotoold()
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    CursorService(bus)
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
