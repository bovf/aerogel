#!/usr/bin/env python3
"""
aerogel-cursor -- tiny D-Bus service for cursor warping.

Exposes:
  bus name : org.aerogel.Cursor
  object   : /org/aerogel/Cursor
  interface: org.aerogel.Cursor
  methods  :
    SetBounds(width: int32, height: int32)
        Inform the service of the total compositor bounding box (pixels).
        Must be called before the first Warp().  Called by the KWin script
        on init and on screensChanged.  Recreates the UInput device when
        dimensions change (monitor hotplug / layout change).

    Warp(x: int32, y: int32)
        Move the cursor to (x, y) in global compositor coordinates.

Called from the KWin script via callDBus whenever aerogel needs to move
focus to a different monitor.  SetBounds is called first (on every init and
screensChanged), then Warp on each focus switch.

Implementation
--------------
Uses python-evdev to create a UInput virtual input device with EV_ABS axes
(ABS_X, ABS_Y).  KWin's libinput backend maps absolute-axis events from such
a device to the full bounding rectangle of all compositor outputs.  This gives
true pixel-accurate absolute positioning with no relative-movement hacks and
no sensitivity to mouse acceleration settings.

This replaces the previous ydotool-based approach.  ydotool's
`mousemove --absolute` implemented absolute positioning as a relative-movement
hack (send REL_X=INT32_MIN to slam to origin, then REL_X=target) which was
sensitive to mouse acceleration and unreliable on multi-monitor setups.

This service is D-Bus-activatable: the session bus starts it automatically
on the first method call -- no manual `systemctl enable` required.

On NixOS the shebang is rewritten to a Nix store path at build time
(see nix/cursor.nix).  On other distros, python3, dbus-python, python3-gi,
and python3-evdev must be installed system-wide.
"""

import sys

try:
    import dbus
    import dbus.service
    import dbus.mainloop.glib
    from gi.repository import GLib
    from evdev import UInput, ecodes, AbsInfo
except ImportError as e:
    sys.exit(f"aerogel-cursor: missing dependency: {e}")

BUS_NAME  = "org.aerogel.Cursor"
OBJ_PATH  = "/org/aerogel/Cursor"
INTERFACE = "org.aerogel.Cursor"


class CursorService(dbus.service.Object):
    def __init__(self, bus: dbus.SessionBus) -> None:
        bus_name = dbus.service.BusName(BUS_NAME, bus)
        super().__init__(bus_name, OBJ_PATH)
        self._ui: UInput | None = None
        self._max_x: int = 0
        self._max_y: int = 0

    def _ensure_device(self) -> None:
        """Create the UInput device if not yet created."""
        if self._ui is not None:
            return
        if self._max_x <= 0 or self._max_y <= 0:
            return
        cap = {
            ecodes.EV_ABS: [
                (ecodes.ABS_X, AbsInfo(value=0, min=0, max=self._max_x, fuzz=0, flat=0, resolution=0)),
                (ecodes.ABS_Y, AbsInfo(value=0, min=0, max=self._max_y, fuzz=0, flat=0, resolution=0)),
            ],
            # BTN_LEFT is required; without at least one EV_KEY capability
            # some libinput versions reject the device as not a pointer.
            ecodes.EV_KEY: [ecodes.BTN_LEFT],
        }
        self._ui = UInput(cap, name="aerogel-cursor")

    @dbus.service.method(INTERFACE, in_signature="ii", out_signature="")
    def SetBounds(self, width: int, height: int) -> None:
        """Set the total compositor bounding box in pixels.

        The KWin script calls this on init and whenever screens change.
        Recreates the UInput device if the dimensions have changed.
        """
        new_max_x = int(width) - 1
        new_max_y = int(height) - 1
        if new_max_x == self._max_x and new_max_y == self._max_y:
            return
        # Close old device -- dimensions changed (e.g. monitor hotplug).
        if self._ui is not None:
            try:
                self._ui.close()
            except Exception:
                pass
            self._ui = None
        self._max_x = new_max_x
        self._max_y = new_max_y
        self._ensure_device()

    @dbus.service.method(INTERFACE, in_signature="ii", out_signature="")
    def Warp(self, x: int, y: int) -> None:
        """Warp the cursor to (x, y) in global compositor coordinates."""
        self._ensure_device()
        if self._ui is None:
            # SetBounds has not been called yet -- silently skip.
            return
        self._ui.write(ecodes.EV_ABS, ecodes.ABS_X, int(x))
        self._ui.write(ecodes.EV_ABS, ecodes.ABS_Y, int(y))
        self._ui.syn()


def main() -> None:
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    CursorService(bus)
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
