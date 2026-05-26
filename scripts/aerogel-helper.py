#!/usr/bin/env python3
"""
aerogel-helper -- D-Bus orchestration for aerogel KWin script lifecycle.

Single source of truth for enabling/disabling aerogel.  Three callers:
  • The pager widget (left-click → Toggle)
  • The keybind (KDE custom shortcut → Toggle)
  • The aerogel KWin script itself (init/destroy → Enable/Disable)

Exposes:
  bus name : org.aerogel.Helper
  object   : /org/aerogel/Helper
  interface: org.aerogel.Helper
  methods  :
    Enable()             -> bool   load aerogel + suppress conflicting KDE shortcuts
    Disable()            -> bool   unload aerogel + restore KDE shortcuts
    Toggle()             -> bool   query state, then Enable or Disable
    IsEnabled()          -> bool   true iff KWin reports aerogel script loaded
    SuppressShortcuts()  -> bool   snapshot + clear KDE shortcuts (no script load)
    RestoreShortcuts()   -> bool   restore KDE shortcuts (no script unload)

The two lower-level methods are for the KWin script itself.  When KWin
auto-loads aerogel on boot (kwinrc.Plugins.aerogelEnabled=true), the script's
init() calls SuppressShortcuts(); destroy() calls RestoreShortcuts().  This
avoids the circularity of init() calling Enable() (which would attempt to
re-load the already-running script).

Shortcut snapshot
-----------------
Aerogel claims a fixed set of keys (Meta+H, Meta+Left, Meta+Shift+1, ...).
On Enable() the helper does, for each key:

  1. Ask KGlobalAccel "which action currently owns this key?" via
     getGlobalShortcutsByKey(int32).  This returns a list of
     KGlobalShortcutInfo structs, each carrying the owner action's
     componentUniqueName, uniqueName, and active key list (as int codes).
     Owners are discovered regardless of which action they are -- a KDE
     default, a user-customised KDE binding, or a third-party tool.
  2. Snapshot the action's full active key list (as ints) to
     $XDG_STATE_HOME/aerogel/kde-shortcuts.ini under [component][action].
     If the action is already in the snapshot (from a previous Enable),
     keep the original entry -- the snapshot accumulates, it never
     overwrites itself.
  3. Filter our key out of the list, then call
     org.kde.KGlobalAccel.setForeignShortcut(actionId, filtered_keys).
     KGlobalAccel mutates the live daemon state AND persists to
     kglobalshortcutsrc atomically -- no manual reload needed.
     Other keys on the same action keep working (e.g. Window Maximize
     still fires on Meta+PgUp if it was also bound there).

On Disable() the helper iterates the snapshot and calls
setForeignShortcut(actionId, saved_keys) for each entry, then deletes
the snapshot file.

This handles every case symmetrically:
  • KDE default binding (Meta+Left → Window Quick Tile Left)         ✔
  • User customised the KDE action's key                             ✔
  • User bound an unrelated action to one of aerogel's keys          ✔
  • Same action owns multiple keys, only some of which are aerogel's ✔
  • Multiple actions claim the same key                              ✔

Why D-Bus and not kwriteconfig6:  KGlobalAccel does NOT watch
kglobalshortcutsrc for file changes.  Edits to the file only take effect
on daemon restart -- so a previous version of this helper that wrote
the file and called a non-existent `reloadConfig` method left both KDE
and aerogel handlers active in memory.  The setForeignShortcut D-Bus
method is what System Settings uses internally; it updates the live
daemon and the file in one call.

This service is D-Bus-activatable: the session bus starts it automatically
on the first method call -- no manual `systemctl enable` required.

On NixOS the shebang is rewritten to a Nix store path at build time
(see nix/helper.nix).  On other distros, python3, dbus-python and python3-gi
must be installed system-wide.
"""

import configparser
import os
import sys
from pathlib import Path

try:
    import dbus
    import dbus.service
    import dbus.mainloop.glib
    from gi.repository import GLib
except ImportError as e:
    sys.exit(f"aerogel-helper: missing dependency: {e}")

BUS_NAME  = "org.aerogel.Helper"
OBJ_PATH  = "/org/aerogel/Helper"
INTERFACE = "org.aerogel.Helper"

KWIN_SERVICE = "org.kde.KWin"
KWIN_SCRIPT_OBJ   = "/Scripting"
KWIN_SCRIPT_IFACE = "org.kde.kwin.Scripting"

KGLOBAL_SERVICE = "org.kde.kglobalaccel"
KGLOBAL_OBJ     = "/kglobalaccel"
KGLOBAL_IFACE   = "org.kde.KGlobalAccel"

# Qt key code constants -- mirror src/shortcuts/ShortcutConflictManager.ts.
# KGlobalAccel's getGlobalShortcutsByKey takes a single int32 (modifiers OR'd
# with the Qt::Key code), so we precompute the int for each aerogel key.
_META    = 0x10000000
_CTRL    = 0x04000000
_SHIFT   = 0x02000000
_K_0     = 0x30
_K_1     = 0x31
_K_A     = 0x41
_K_F     = 0x46
_K_H     = 0x48
_K_J     = 0x4a
_K_K     = 0x4b
_K_L     = 0x4c
_K_Q     = 0x51
_K_SPACE = 0x20
_K_MINUS = 0x2d
_K_EQUAL = 0x3d
_K_LEFT    = 0x01000012
_K_UP      = 0x01000013
_K_RIGHT   = 0x01000014
_K_DOWN    = 0x01000015
_K_TAB     = 0x01000001
_K_BACKTAB = 0x01000002

# Default global toggle shortcut.  Registered by the helper at service
# startup with KGlobalAccel; user can rebind via System Settings ->
# Shortcuts -> Aerogel Helper.
HELPER_COMPONENT = "aerogel-helper"
TOGGLE_ACTION    = "toggle"
TOGGLE_KEY_INT   = _META | _CTRL | _K_A   # Meta+Ctrl+A

# D-Bus object paths cannot contain '-'.  KGlobalAccel sanitises our
# componentUniqueName by replacing '-' with '_' when forming its
# /component/<name> object.  We need the sanitised form to subscribe to
# the press signal.
HELPER_COMPONENT_PATH = "/component/" + HELPER_COMPONENT.replace("-", "_")

# Aerogel's own actions and the keys they should claim.  Used at Suppress
# time to force-write the active key list for each aerogel action via
# setForeignShortcut.  Without this, KGlobalAccel's autoload semantics
# treat any previously-persisted empty active value as "user deliberately
# cleared this" and refuse to apply the default keys when the script's
# ShortcutHandler registers -- which is why a System Settings reset (or
# any prior run leaving blank actives) leaves aerogel's contested keys
# (Meta+Left etc.) doing nothing.
AEROGEL_ACTIONS: list[tuple[str, str, int]] = [
    # Focus: vim keys
    ("kwin", "aerogel-focus-left",  _META | _K_H),
    ("kwin", "aerogel-focus-down",  _META | _K_J),
    ("kwin", "aerogel-focus-up",    _META | _K_K),
    ("kwin", "aerogel-focus-right", _META | _K_L),
    # Focus: arrows
    ("kwin", "aerogel-focus-left-arrow",  _META | _K_LEFT),
    ("kwin", "aerogel-focus-down-arrow",  _META | _K_DOWN),
    ("kwin", "aerogel-focus-up-arrow",    _META | _K_UP),
    ("kwin", "aerogel-focus-right-arrow", _META | _K_RIGHT),
    # Swap: vim keys
    ("kwin", "aerogel-move-left",   _META | _SHIFT | _K_H),
    ("kwin", "aerogel-move-down",   _META | _SHIFT | _K_J),
    ("kwin", "aerogel-move-up",     _META | _SHIFT | _K_K),
    ("kwin", "aerogel-move-right",  _META | _SHIFT | _K_L),
    # Swap: arrows
    ("kwin", "aerogel-move-left-arrow",   _META | _SHIFT | _K_LEFT),
    ("kwin", "aerogel-move-down-arrow",   _META | _SHIFT | _K_DOWN),
    ("kwin", "aerogel-move-up-arrow",     _META | _SHIFT | _K_UP),
    ("kwin", "aerogel-move-right-arrow",  _META | _SHIFT | _K_RIGHT),
    # Desktop switch
    ("kwin", "aerogel-desktop-1",   _META | _K_1),
    ("kwin", "aerogel-desktop-2",   _META | (_K_1 + 1)),
    ("kwin", "aerogel-desktop-3",   _META | (_K_1 + 2)),
    ("kwin", "aerogel-desktop-4",   _META | (_K_1 + 3)),
    ("kwin", "aerogel-desktop-5",   _META | (_K_1 + 4)),
    ("kwin", "aerogel-desktop-6",   _META | (_K_1 + 5)),
    ("kwin", "aerogel-desktop-7",   _META | (_K_1 + 6)),
    ("kwin", "aerogel-desktop-8",   _META | (_K_1 + 7)),
    ("kwin", "aerogel-desktop-9",   _META | (_K_1 + 8)),
    ("kwin", "aerogel-desktop-10",  _META | _K_0),
    # Move to desktop
    ("kwin", "aerogel-move-to-desktop-1",   _META | _SHIFT | _K_1),
    ("kwin", "aerogel-move-to-desktop-2",   _META | _SHIFT | (_K_1 + 1)),
    ("kwin", "aerogel-move-to-desktop-3",   _META | _SHIFT | (_K_1 + 2)),
    ("kwin", "aerogel-move-to-desktop-4",   _META | _SHIFT | (_K_1 + 3)),
    ("kwin", "aerogel-move-to-desktop-5",   _META | _SHIFT | (_K_1 + 4)),
    ("kwin", "aerogel-move-to-desktop-6",   _META | _SHIFT | (_K_1 + 5)),
    ("kwin", "aerogel-move-to-desktop-7",   _META | _SHIFT | (_K_1 + 6)),
    ("kwin", "aerogel-move-to-desktop-8",   _META | _SHIFT | (_K_1 + 7)),
    ("kwin", "aerogel-move-to-desktop-9",   _META | _SHIFT | (_K_1 + 8)),
    ("kwin", "aerogel-move-to-desktop-10",  _META | _SHIFT | _K_0),
    # Misc
    ("kwin", "aerogel-next-monitor",       _META | _K_BACKTAB),
    ("kwin", "aerogel-float-toggle",       _META | _K_SPACE),
    ("kwin", "aerogel-fullscreen-toggle",  _META | _K_F),
    ("kwin", "aerogel-close-window",       _META | _K_Q),
    ("kwin", "aerogel-resize-shrink",      _META | _K_MINUS),
    ("kwin", "aerogel-resize-grow",        _META | _K_EQUAL),
]

# Canonical KDE owners of each aerogel key.  Used as a fallback when
# getGlobalShortcutsByKey returns no current owner -- a key may be
# unclaimed because its active field was previously zeroed by external
# means (System Settings reset, an older buggy version of this helper,
# manual kwriteconfig6).  We then look up the canonical action's stored
# DEFAULT keys; if they include our key we treat that action as the
# implicit owner and snapshot the default key list so Disable can
# restore it.
CANONICAL_OWNERS: dict[int, list[tuple[str, str]]] = {
    _META | _K_LEFT:           [("kwin", "Window Quick Tile Left")],
    _META | _K_RIGHT:          [("kwin", "Window Quick Tile Right")],
    _META | _K_UP:             [("kwin", "Window Maximize")],
    _META | _K_DOWN:           [("kwin", "Window Minimize")],
    _META | _K_0:              [("kwin", "view_actual_size")],
    _META | _K_L:              [("ksmserver", "Lock Session")],
    _META | _K_Q:              [("plasmashell", "manage activities")],
    _META | _SHIFT | _K_LEFT:  [("kwin", "Window to Previous Screen")],
    _META | _SHIFT | _K_RIGHT: [("kwin", "Window to Next Screen")],
    _META | _SHIFT | _K_UP:    [("kwin", "Window Quick Tile Top")],
    _META | _SHIFT | _K_DOWN:  [("kwin", "Window Quick Tile Bottom")],
    _META | _K_BACKTAB:        [("kwin", "Walk Through Windows (Reverse)")],
    _META | _SHIFT | _K_TAB:   [("kwin", "Walk Through Windows (Reverse)")],
    _META | _K_MINUS:          [("kwin", "view_zoom_out")],
    _META | _K_EQUAL:          [("kwin", "view_zoom_in")],
    _META | _K_1:              [("plasmashell", "activate task manager entry 1")],
    _META | (_K_1 + 1):        [("plasmashell", "activate task manager entry 2")],
    _META | (_K_1 + 2):        [("plasmashell", "activate task manager entry 3")],
    _META | (_K_1 + 3):        [("plasmashell", "activate task manager entry 4")],
    _META | (_K_1 + 4):        [("plasmashell", "activate task manager entry 5")],
    _META | (_K_1 + 5):        [("plasmashell", "activate task manager entry 6")],
    _META | (_K_1 + 6):        [("plasmashell", "activate task manager entry 7")],
    _META | (_K_1 + 7):        [("plasmashell", "activate task manager entry 8")],
    _META | (_K_1 + 8):        [("plasmashell", "activate task manager entry 9")],
}

# Every key aerogel claims, in canonical "Meta+..." string form plus the Qt
# int code used by KGlobalAccel.getGlobalShortcutsByKey.  The list is the
# input to dynamic owner discovery -- no hardcoded list of conflicting
# action names is needed; we ask KGlobalAccel who owns each key.
AEROGEL_KEYS: list[tuple[str, int]] = [
    # Focus: Meta+HJKL
    ("Meta+H", _META | _K_H),
    ("Meta+J", _META | _K_J),
    ("Meta+K", _META | _K_K),
    ("Meta+L", _META | _K_L),
    # Focus: Meta+Arrows
    ("Meta+Left",  _META | _K_LEFT),
    ("Meta+Down",  _META | _K_DOWN),
    ("Meta+Up",    _META | _K_UP),
    ("Meta+Right", _META | _K_RIGHT),
    # Swap: Meta+Shift+HJKL
    ("Meta+Shift+H", _META | _SHIFT | _K_H),
    ("Meta+Shift+J", _META | _SHIFT | _K_J),
    ("Meta+Shift+K", _META | _SHIFT | _K_K),
    ("Meta+Shift+L", _META | _SHIFT | _K_L),
    # Swap: Meta+Shift+Arrows
    ("Meta+Shift+Left",  _META | _SHIFT | _K_LEFT),
    ("Meta+Shift+Down",  _META | _SHIFT | _K_DOWN),
    ("Meta+Shift+Up",    _META | _SHIFT | _K_UP),
    ("Meta+Shift+Right", _META | _SHIFT | _K_RIGHT),
    # Desktop switch: Meta+1..9,0
    ("Meta+1", _META | _K_1),
    ("Meta+2", _META | (_K_1 + 1)),
    ("Meta+3", _META | (_K_1 + 2)),
    ("Meta+4", _META | (_K_1 + 3)),
    ("Meta+5", _META | (_K_1 + 4)),
    ("Meta+6", _META | (_K_1 + 5)),
    ("Meta+7", _META | (_K_1 + 6)),
    ("Meta+8", _META | (_K_1 + 7)),
    ("Meta+9", _META | (_K_1 + 8)),
    ("Meta+0", _META | _K_0),
    # Move to desktop: Meta+Shift+1..9,0
    ("Meta+Shift+1", _META | _SHIFT | _K_1),
    ("Meta+Shift+2", _META | _SHIFT | (_K_1 + 1)),
    ("Meta+Shift+3", _META | _SHIFT | (_K_1 + 2)),
    ("Meta+Shift+4", _META | _SHIFT | (_K_1 + 3)),
    ("Meta+Shift+5", _META | _SHIFT | (_K_1 + 4)),
    ("Meta+Shift+6", _META | _SHIFT | (_K_1 + 5)),
    ("Meta+Shift+7", _META | _SHIFT | (_K_1 + 6)),
    ("Meta+Shift+8", _META | _SHIFT | (_K_1 + 7)),
    ("Meta+Shift+9", _META | _SHIFT | (_K_1 + 8)),
    ("Meta+Shift+0", _META | _SHIFT | _K_0),
    # Other.  Backtab and Shift+Tab are different int codes -- include both
    # so we catch any action that bound either form.
    ("Meta+Backtab",   _META | _K_BACKTAB),
    ("Meta+Shift+Tab", _META | _SHIFT | _K_TAB),
    ("Meta+Space",     _META | _K_SPACE),
    ("Meta+F",         _META | _K_F),
    ("Meta+Q",         _META | _K_Q),
    ("Meta+Minus",     _META | _K_MINUS),
    ("Meta+Equal",     _META | _K_EQUAL),
]

_STATE_HOME = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state"))
SNAPSHOT_FILE = _STATE_HOME / "aerogel" / "kde-shortcuts.ini"

# Plaintext "true" / "false" written on every state flip.  The widget polls
# this via cat (Plasma5Support.DataSource executable engine) instead of
# asyncCall to KWin's isScriptLoaded, which has been observed to never
# deliver its reply to plasmashell's QML DBus binding in Plasma 6.
ENABLED_FILE = _STATE_HOME / "aerogel" / "enabled"


def _write_enabled_state(enabled: bool) -> None:
    try:
        ENABLED_FILE.parent.mkdir(parents=True, exist_ok=True)
        ENABLED_FILE.write_text("true" if enabled else "false")
    except Exception as e:
        print(f"aerogel-helper: failed to write enabled state: {e}", file=sys.stderr)


# ────────────────────────────────────────────────────────────────────────────
# KGlobalAccel D-Bus calls
# ────────────────────────────────────────────────────────────────────────────

def _query_owners_full(bus: dbus.SessionBus, key_int: int) -> list[tuple[str, str, list[int]]]:
    """For actions claiming key_int, return (componentUnique, actionUnique, activeKeysInt).

    Calls org.kde.kglobalaccel.getGlobalShortcutsByKey(int32).  The reply is
    a list of KGlobalShortcutInfo structs (ssssssaiai).  The marshalling
    order, verified empirically via `busctl call`, is:
        0: uniqueName  (= action unique name -- e.g. "Window Quick Tile Left")
        1: friendlyName  (= action display name)
        2: componentUniqueName  (= e.g. "kwin", "plasmashell")
        3: componentFriendlyName  (= e.g. "KWin")
        4: contextUniqueName  (= "default" almost always)
        5: contextFriendlyName
        6: keys         (current active keys, list of int)
        7: defaultKeys  (default keys, list of int)

    Earlier versions of this file had 0 and 2 swapped -- which made every
    setForeignShortcut call write gibberish (action="kwin", component="...")
    and silently fail to clear the real conflict.
    """
    try:
        proxy = bus.get_object(KGLOBAL_SERVICE, KGLOBAL_OBJ)
        iface = dbus.Interface(proxy, KGLOBAL_IFACE)
        infos = iface.getGlobalShortcutsByKey(dbus.Int32(key_int))
    except dbus.DBusException as e:
        print(f"aerogel-helper: getGlobalShortcutsByKey({key_int:#x}) failed: {e}",
              file=sys.stderr)
        return []
    out: list[tuple[str, str, list[int]]] = []
    for info in infos:
        try:
            action_name = str(info[0])
            component   = str(info[2])
            keys        = [int(k) for k in info[6]]
            out.append((component, action_name, keys))
        except (IndexError, TypeError, ValueError):
            continue
    return out


def _get_default_keys(
    bus: dbus.SessionBus,
    component: str,
    action_name: str,
) -> list[int]:
    """Query KGlobalAccel for an action's default keys.

    Returns the empty list if the action doesn't exist or the call fails.
    Used as a fallback in _suppress_shortcuts when getGlobalShortcutsByKey
    finds no current owner -- the canonical owner may still have its
    default keys recorded even when its active keys were cleared.
    """
    try:
        proxy = bus.get_object(KGLOBAL_SERVICE, KGLOBAL_OBJ)
        iface = dbus.Interface(proxy, KGLOBAL_IFACE)
        action_id = dbus.Array([component, action_name, "", ""], signature="s")
        result = iface.defaultShortcut(action_id)
        return [int(k) for k in result]
    except dbus.DBusException:
        return []


def _set_foreign_shortcut(
    bus: dbus.SessionBus,
    component: str,
    action_name: str,
    keys: list[int],
) -> bool:
    """Atomically set <action_name>'s active keys via KGlobalAccel.

    Uses org.kde.kglobalaccel.setForeignShortcut(as actionId, ai keys),
    which updates the live daemon AND persists to kglobalshortcutsrc.
    """
    try:
        proxy = bus.get_object(KGLOBAL_SERVICE, KGLOBAL_OBJ)
        iface = dbus.Interface(proxy, KGLOBAL_IFACE)
        action_id = dbus.Array(
            [component, action_name, "", ""],
            signature="s",
        )
        keys_arr = dbus.Array(
            [dbus.Int32(k) for k in keys],
            signature="i",
        )
        iface.setForeignShortcut(action_id, keys_arr)
        return True
    except dbus.DBusException as e:
        print(f"aerogel-helper: setForeignShortcut({component}/{action_name}) failed: {e}",
              file=sys.stderr)
        return False


# ────────────────────────────────────────────────────────────────────────────
# Snapshot file I/O
# ────────────────────────────────────────────────────────────────────────────
#
# Snapshot stores ORIGINAL active key lists per (component, action) as
# comma-separated decimal integers (Qt key codes).  Example:
#
#   [kwin]
#   Window Quick Tile Left = 268435474
#   Window Maximize        = 268435475,16777238
#

def _snapshot_load() -> configparser.ConfigParser:
    cp = configparser.ConfigParser()
    cp.optionxform = str  # preserve case in keys
    if SNAPSHOT_FILE.exists():
        try:
            cp.read(SNAPSHOT_FILE, encoding="utf-8")
        except configparser.Error:
            cp = configparser.ConfigParser()
            cp.optionxform = str
    return cp


def _snapshot_save(cp: configparser.ConfigParser) -> None:
    SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SNAPSHOT_FILE.open("w", encoding="utf-8") as f:
        cp.write(f)


def _snapshot_delete() -> None:
    try:
        SNAPSHOT_FILE.unlink()
    except FileNotFoundError:
        pass


def _keys_to_str(keys: list[int]) -> str:
    return ",".join(str(k) for k in keys)


def _str_to_keys(s: str) -> list[int]:
    out: list[int] = []
    for part in s.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            # Old (pre-D-Bus-rewrite) snapshot format stored strings like
            # "Meta+Left" -- can't translate without a full Qt key parser,
            # so skip.  User loses restoration of that one action.
            continue
    return out


# ────────────────────────────────────────────────────────────────────────────
# KWin script load/unload
# ────────────────────────────────────────────────────────────────────────────

def _kwin_is_script_loaded(bus: dbus.SessionBus) -> bool:
    try:
        proxy = bus.get_object(KWIN_SERVICE, KWIN_SCRIPT_OBJ)
        iface = dbus.Interface(proxy, KWIN_SCRIPT_IFACE)
        return bool(iface.isScriptLoaded("aerogel"))
    except dbus.DBusException:
        return False


def _kwin_load_script(bus: dbus.SessionBus) -> None:
    # Reconfigure picks up kwinrc.Plugins.aerogelEnabled=true and re-starts
    # the script through KWin's plugin system -- this re-runs init() cleanly.
    try:
        proxy = bus.get_object(KWIN_SERVICE, "/KWin")
        iface = dbus.Interface(proxy, "org.kde.KWin")
        iface.reconfigure()
    except dbus.DBusException:
        pass


def _kwin_unload_script(bus: dbus.SessionBus) -> None:
    try:
        proxy = bus.get_object(KWIN_SERVICE, KWIN_SCRIPT_OBJ)
        iface = dbus.Interface(proxy, KWIN_SCRIPT_IFACE)
        iface.unloadScript("aerogel")
    except dbus.DBusException:
        pass


# ────────────────────────────────────────────────────────────────────────────
# Helper service
# ────────────────────────────────────────────────────────────────────────────

class HelperService(dbus.service.Object):
    def __init__(self, bus: dbus.SessionBus) -> None:
        # Claim the bus name with replace_existing so we always end up the
        # sole owner.  Without this, a previously-running helper (e.g. left
        # behind by `systemctl --user restart`) stays alive and keeps its
        # KGlobalAccel signal subscription active -- every keypress would
        # then fire Toggle() in BOTH processes, racing on the snapshot file
        # and producing the "disable doesn't disable" symptom.
        bus_name = dbus.service.BusName(
            BUS_NAME, bus,
            do_not_queue=True,
            replace_existing=True,
            allow_replacement=True,
        )
        super().__init__(bus_name, OBJ_PATH)
        self._bus = bus
        # Re-entrancy guard: the KWin script itself calls Enable()/Disable()
        # from its init()/destroy(), and the widget can call Toggle() while
        # that is in flight.  Without this, Toggle() could load a script
        # whose init() then re-calls Enable(), which then tries to re-load
        # the script.  D-Bus serialises method dispatch on a single object,
        # but the kwin reconfigure call is fire-and-forget so we still guard.
        self._busy = False

        # Exit cleanly when another instance replaces us on the bus name.
        # Pairs with allow_replacement above: future `aerogel-helper` starts
        # take over, we get NameLost, we shut down -- no phantom subscribers.
        self._bus.add_signal_receiver(
            self._on_name_lost,
            signal_name="NameLost",
            dbus_interface=dbus.BUS_DAEMON_IFACE,
            bus_name=dbus.BUS_DAEMON_NAME,
            path=dbus.BUS_DAEMON_PATH,
        )

        # Register the global toggle shortcut with KGlobalAccel and listen
        # for its press signal.  See _register_toggle_action for rationale.
        self._register_toggle_action()

        # Seed the enabled state file from KWin's current truth so the
        # widget has something to read before the first Enable/Disable.
        _write_enabled_state(_kwin_is_script_loaded(self._bus))

    def _on_name_lost(self, name: str) -> None:
        if str(name) == BUS_NAME:
            print("aerogel-helper: bus name taken by another instance, exiting",
                  file=sys.stderr)
            sys.exit(0)

    # ── EnabledChanged signal ───────────────────────────────────────────────
    # Emitted whenever Enable()/Disable()/Toggle() actually flips state.
    # Widgets / external listeners can subscribe instead of polling.

    @dbus.service.signal(INTERFACE, signature="b")
    def EnabledChanged(self, enabled: bool) -> None:
        pass

    # ── Global toggle keybind registration ──────────────────────────────────

    def _register_toggle_action(self) -> None:
        """Register Meta+Ctrl+A with KGlobalAccel and subscribe to its press.

        Plasma 6 dropped khotkeys, so plasma-manager's hotkeys.commands
        writes to a file (khotkeysrc) that nothing reads anymore.  Instead
        the helper registers itself as a KGlobalAccel component with a
        single "toggle" action and binds Meta+Ctrl+A to it directly.

        When the key is pressed, KGlobalAccel emits
            org.kde.kglobalaccel.Component.globalShortcutPressed(
                component, action, timestamp,
            )
        on /component/aerogel-helper.  We subscribe here and call Toggle().

        On first registration we also strip Meta+Ctrl+A from any other
        action that currently claims it (KDE's default
        "Activate Window Demanding Attention" does, for instance) -- the
        toggle key must work regardless of aerogel's enabled state, so it
        is NOT part of the snapshot/restore cycle.
        """
        action_id = dbus.Array(
            [HELPER_COMPONENT, TOGGLE_ACTION, "Aerogel Helper", "Toggle aerogel tiling"],
            signature="s",
        )
        keys = dbus.Array([dbus.Int32(TOGGLE_KEY_INT)], signature="i")

        try:
            proxy = self._bus.get_object(KGLOBAL_SERVICE, KGLOBAL_OBJ)
            iface = dbus.Interface(proxy, KGLOBAL_IFACE)

            # Register the action so System Settings -> Shortcuts shows it.
            iface.doRegister(action_id)

            # Set the default keys (flag 0x2 = IsDefault).  This is what
            # appears in the "Default" column in System Settings.
            iface.setShortcut(action_id, keys, dbus.UInt32(0x2))

            # Set the active keys.  setShortcut(action, keys, 0) sets active,
            # but if KGlobalAccel has previously autoloaded an empty active
            # from kglobalshortcutsrc it may skip overriding.  setForeignShortcut
            # is the unconditional-set variant -- no flags, no autoloading
            # check, always writes the supplied keys to the action's active
            # list.  This is what actually makes Meta+Ctrl+A dispatch.
            iface.setForeignShortcut(action_id, keys)
        except dbus.DBusException as e:
            print(f"aerogel-helper: failed to register toggle action: {e}",
                  file=sys.stderr)
            return

        # Steal the toggle key from any conflicting action.  Permanent --
        # not part of the AEROGEL_KEYS snapshot cycle, because the toggle
        # must work even when aerogel is disabled.
        for component, action_name, current_keys in _query_owners_full(self._bus, TOGGLE_KEY_INT):
            if component == HELPER_COMPONENT and action_name == TOGGLE_ACTION:
                continue
            new_keys = [k for k in current_keys if k != TOGGLE_KEY_INT]
            if new_keys != current_keys:
                print(f"aerogel-helper: claiming toggle key from {component}/{action_name}",
                      file=sys.stderr)
                _set_foreign_shortcut(self._bus, component, action_name, new_keys)

        # Subscribe to the per-component press signal.  Object path uses
        # underscore form because D-Bus forbids '-' in paths.
        try:
            self._bus.add_signal_receiver(
                self._on_global_shortcut_pressed,
                signal_name="globalShortcutPressed",
                dbus_interface="org.kde.kglobalaccel.Component",
                bus_name=KGLOBAL_SERVICE,
                path=HELPER_COMPONENT_PATH,
            )
            print(f"aerogel-helper: toggle keybind registered "
                  f"(Meta+Ctrl+A; rebind via System Settings)",
                  file=sys.stderr)
        except (dbus.DBusException, ValueError) as e:
            print(f"aerogel-helper: failed to subscribe to press signal: {e}",
                  file=sys.stderr)

    def _on_global_shortcut_pressed(self, component, action_name, timestamp) -> None:
        """KGlobalAccel-dispatched callback: our toggle key was pressed."""
        if str(action_name) == TOGGLE_ACTION:
            print("aerogel-helper: toggle shortcut fired", file=sys.stderr)
            self.Toggle()

    # ── KDE-shortcut snapshot/clear/restore ─────────────────────────────────

    def _suppress_shortcuts(self) -> None:
        """For each aerogel key, find its current owner and strip our key from it.

        Discovery is dynamic via KGlobalAccel.getGlobalShortcutsByKey, which
        returns owner actions and their current active key lists (as ints).
        We snapshot the original key list per (component, action) then call
        setForeignShortcut to remove just our key.

        The snapshot accumulates across multiple Enable calls: once an
        action is in the snapshot, subsequent Enables won't overwrite its
        entry, so the original pre-aerogel state is always what gets
        restored on Disable.
        """
        snapshot = _snapshot_load()
        cleared  = 0

        for _key_str, key_int in AEROGEL_KEYS:
            owners = _query_owners_full(self._bus, key_int)

            # Filter out aerogel's own actions from the owner list.  The
            # canonical fallback below must fire when the ONLY current owner
            # is aerogel itself -- otherwise the KDE action that should claim
            # this key (with active=empty) is never snapshotted and Disable
            # cannot restore it.
            non_aerogel_owners = [
                (c, a, k) for (c, a, k) in owners
                if not (c == "kwin" and a.startswith("aerogel-"))
                and not (c == HELPER_COMPONENT and a == TOGGLE_ACTION)
            ]

            # Fallback: if no NON-aerogel action currently claims this key,
            # look up its canonical KDE owner and treat that action as the
            # implicit owner.  Recovers from polluted kglobalshortcutsrc
            # (active fields zeroed by an earlier broken helper run or by
            # System Settings -> reset).
            #
            # We hardcode the key rather than querying defaultShortcut --
            # the latter has been observed to return empty even for
            # well-known KDE actions.
            if not non_aerogel_owners:
                for component, action_name in CANONICAL_OWNERS.get(key_int, []):
                    owners.append((component, action_name, [key_int]))

            for component, action_name, current_keys in owners:
                try:
                    # Skip aerogel's own ShortcutHandler registrations.
                    if component == "kwin" and action_name.startswith("aerogel-"):
                        continue
                    # Skip our own toggle action.
                    if component == HELPER_COMPONENT and action_name == TOGGLE_ACTION:
                        continue
                    # Snapshot the original key list -- but only on first
                    # encounter, so re-enabling doesn't capture a state that
                    # already has aerogel-stripped values.
                    if not snapshot.has_section(component):
                        snapshot.add_section(component)
                    if action_name not in snapshot[component]:
                        snapshot[component][action_name] = _keys_to_str(current_keys)
                    # Filter our key out of the list.
                    new_keys = [k for k in current_keys if k != key_int]
                    if new_keys == current_keys:
                        continue
                    if _set_foreign_shortcut(self._bus, component, action_name, new_keys):
                        cleared += 1
                except Exception as e:
                    print(f"aerogel-helper: suppress error {component}/{action_name}: {e}",
                          file=sys.stderr)

        _snapshot_save(snapshot)
        print(f"aerogel-helper: suppressed {cleared} conflicting binding(s)",
              file=sys.stderr)

        # Force-write each aerogel action's active keys.  Without this,
        # KGlobalAccel autoloads a previously-empty active for an aerogel
        # action (e.g. left behind by System Settings -> reset) and refuses
        # to apply the default at ShortcutHandler registration time.
        # setForeignShortcut is unconditional -- always writes the supplied
        # keys, so on every Enable we guarantee aerogel keys actually claim.
        claimed = 0
        for component, action_name, key_int in AEROGEL_ACTIONS:
            try:
                if _set_foreign_shortcut(self._bus, component, action_name, [key_int]):
                    claimed += 1
            except Exception as e:
                print(f"aerogel-helper: claim error {component}/{action_name}: {e}",
                      file=sys.stderr)
        print(f"aerogel-helper: claimed {claimed} aerogel binding(s)",
              file=sys.stderr)

    def _restore_shortcuts(self) -> None:
        """Clear aerogel actives, then restore KDE bindings from snapshot.

        Order matters: aerogel-focus-left-arrow holds Meta+Left while
        aerogel is enabled.  If we tried to restore Window Quick Tile Left
        to Meta+Left while aerogel-focus-left-arrow still claims it,
        KGlobalAccel rejects the conflicting assignment silently and the
        KDE binding never comes back.  By clearing aerogel's actives FIRST
        we release the keys so the KDE owner can reclaim them.

        After restoration the snapshot file is deleted so the next Enable
        starts fresh and captures whatever the user has rebound while
        aerogel was off.
        """
        # Step 1: release the keys aerogel currently claims.
        cleared = 0
        for component, action_name, _key_int in AEROGEL_ACTIONS:
            try:
                if _set_foreign_shortcut(self._bus, component, action_name, []):
                    cleared += 1
            except Exception as e:
                print(f"aerogel-helper: clear error {component}/{action_name}: {e}",
                      file=sys.stderr)
        print(f"aerogel-helper: cleared {cleared} aerogel binding(s)",
              file=sys.stderr)

        # Step 2: hand the keys back to their original KDE owners.
        snapshot = _snapshot_load()
        restored = 0
        for component in snapshot.sections():
            for action_name in snapshot[component]:
                raw  = snapshot[component][action_name]
                keys = _str_to_keys(raw)
                # Safety: if the snapshot value was non-empty but parsed to
                # empty (e.g. an old string-format entry from the pre-D-Bus
                # version of this helper), skip rather than clearing the
                # action's bindings entirely.
                if raw.strip() and not keys:
                    print(f"aerogel-helper: skipping unparseable snapshot entry "
                          f"[{component}] {action_name}={raw!r}", file=sys.stderr)
                    continue
                if _set_foreign_shortcut(self._bus, component, action_name, keys):
                    restored += 1
        _snapshot_delete()
        print(f"aerogel-helper: restored {restored} binding(s)",
              file=sys.stderr)

    # ── D-Bus interface ─────────────────────────────────────────────────────

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def Enable(self) -> bool:
        if self._busy:
            return False
        self._busy = True
        try:
            was_loaded = _kwin_is_script_loaded(self._bus)
            self._suppress_shortcuts()
            if not was_loaded:
                _kwin_load_script(self._bus)
                self.EnabledChanged(True)
            _write_enabled_state(True)
            return True
        finally:
            self._busy = False

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def Disable(self) -> bool:
        if self._busy:
            return False
        self._busy = True
        try:
            was_loaded = _kwin_is_script_loaded(self._bus)
            _kwin_unload_script(self._bus)
            self._restore_shortcuts()
            if was_loaded:
                self.EnabledChanged(False)
            _write_enabled_state(False)
            return True
        finally:
            self._busy = False

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def Toggle(self) -> bool:
        loaded = _kwin_is_script_loaded(self._bus)
        print(f"aerogel-helper: Toggle called (currently loaded: {loaded})",
              file=sys.stderr)
        if loaded:
            return self.Disable()
        return self.Enable()

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def IsEnabled(self) -> bool:
        return _kwin_is_script_loaded(self._bus)

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def SuppressShortcuts(self) -> bool:
        """Snapshot + clear KDE shortcuts without touching the KWin script.

        Called by the aerogel script's init() so that KDE bindings are
        suppressed even when the script is auto-loaded on boot (which
        bypasses Enable()).
        """
        self._suppress_shortcuts()
        return True

    @dbus.service.method(INTERFACE, in_signature="", out_signature="b")
    def RestoreShortcuts(self) -> bool:
        """Restore KDE shortcuts without touching the KWin script.

        Called by the aerogel script's destroy() so that KDE bindings are
        restored even when the script is unloaded outside the helper (e.g.
        through System Settings -> KWin Scripts).
        """
        self._restore_shortcuts()
        return True


def main() -> None:
    # CLI fall-through: the helper can also be invoked one-shot from the
    # shell as `aerogel-helper toggle` / `enable` / `disable` / `status`.
    # This is what the KDE custom shortcut calls.
    if len(sys.argv) > 1:
        action = sys.argv[1]
        bus = dbus.SessionBus()
        try:
            proxy = bus.get_object(BUS_NAME, OBJ_PATH)
            iface = dbus.Interface(proxy, INTERFACE)
        except dbus.DBusException as e:
            sys.exit(f"aerogel-helper: cannot reach service: {e}")
        try:
            if action == "enable":
                ok = bool(iface.Enable())
            elif action == "disable":
                ok = bool(iface.Disable())
            elif action == "toggle":
                ok = bool(iface.Toggle())
            elif action == "status":
                state = "enabled" if bool(iface.IsEnabled()) else "disabled"
                print(state)
                ok = True
            else:
                sys.exit(f"aerogel-helper: unknown action '{action}'")
        except dbus.DBusException as e:
            sys.exit(f"aerogel-helper: D-Bus call failed: {e}")
        sys.exit(0 if ok else 1)

    # Service mode: register on the bus and run the GLib main loop.
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    HelperService(bus)
    GLib.MainLoop().run()


if __name__ == "__main__":
    main()
