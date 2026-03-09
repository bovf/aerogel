/// <reference path="../extern/kwin.d.ts" />

/**
 * ShortcutConflictManager.ts -- Detect conflicts and clean up KGlobalAccel.
 *
 * Two responsibilities:
 *
 * 1. On init: detect which aerogel key bindings conflict with existing KDE
 *    shortcuts (plasmashell task-manager entries, ksmserver lock, etc.).
 *    Log detailed warnings to the journal and send a single aggregated
 *    desktop notification if any conflicts are found.
 *
 *    Detection uses `getGlobalShortcutsByKey(int32)` which takes a single
 *    int -- compatible with callDBus() (no `as` marshaling needed).
 *
 * 2. On destroy: remove all aerogel shortcut registrations from KGlobalAccel
 *    so kglobalshortcutsrc stays clean when the script is disabled.
 *
 *    Uses `unregister(s, s)` which takes two plain strings -- compatible
 *    with callDBus().
 *
 * The `as` (string array) marshaling limitation of callDBus means we cannot
 * programmatically CLEAR conflicting shortcuts from the script.  NixOS users
 * get automatic clearing via the home-manager module.  Other users must
 * resolve conflicts manually in System Settings → Shortcuts.
 */

namespace ShortcutConflictManager {

    const KGACCEL_SERVICE = "org.kde.kglobalaccel";
    const KGACCEL_PATH    = "/kglobalaccel";
    const KGACCEL_IFACE   = "org.kde.KGlobalAccel";

    // -----------------------------------------------------------------------
    // Qt key codes for aerogel bindings
    // -----------------------------------------------------------------------

    // Qt modifier: Meta = 0x10000000, Shift = 0x02000000
    const META  = 0x10000000;
    const SHIFT = 0x02000000;

    // Qt key codes for alphanumerics / special keys used by aerogel.
    const Key_0     = 0x30;
    const Key_1     = 0x31;
    const Key_H     = 0x48;
    const Key_J     = 0x4a;
    const Key_K     = 0x4b;
    const Key_L     = 0x4c;
    const Key_F     = 0x46;
    const Key_Q     = 0x51;
    const Key_Space = 0x20;
    const Key_Left  = 0x01000012;
    const Key_Up    = 0x01000013;
    const Key_Right = 0x01000014;
    const Key_Down  = 0x01000015;
    const Key_Minus = 0x2d;
    const Key_Equal = 0x3d;
    const Key_Backtab = 0x01000002;

    /**
     * All key codes aerogel registers, mapped to human-readable names for
     * log messages.  Only keys likely to conflict with KDE defaults are
     * included -- obscure shifted-symbol fallback keys are omitted.
     */
    const AEROGEL_KEYS: Array<{ code: number; label: string }> = [
        // Desktop switching: Meta+1..9,0
        { code: META | Key_1,     label: "Meta+1" },
        { code: META | (Key_1+1), label: "Meta+2" },
        { code: META | (Key_1+2), label: "Meta+3" },
        { code: META | (Key_1+3), label: "Meta+4" },
        { code: META | (Key_1+4), label: "Meta+5" },
        { code: META | (Key_1+5), label: "Meta+6" },
        { code: META | (Key_1+6), label: "Meta+7" },
        { code: META | (Key_1+7), label: "Meta+8" },
        { code: META | (Key_1+8), label: "Meta+9" },
        { code: META | Key_0,     label: "Meta+0" },
        // Focus: Meta+H/J/K/L
        { code: META | Key_H,     label: "Meta+H" },
        { code: META | Key_J,     label: "Meta+J" },
        { code: META | Key_K,     label: "Meta+K" },
        { code: META | Key_L,     label: "Meta+L" },
        // Focus: Meta+Arrows
        { code: META | Key_Left,  label: "Meta+Left" },
        { code: META | Key_Down,  label: "Meta+Down" },
        { code: META | Key_Up,    label: "Meta+Up" },
        { code: META | Key_Right, label: "Meta+Right" },
        // Swap: Meta+Shift+H/J/K/L
        { code: META | SHIFT | Key_H, label: "Meta+Shift+H" },
        { code: META | SHIFT | Key_J, label: "Meta+Shift+J" },
        { code: META | SHIFT | Key_K, label: "Meta+Shift+K" },
        { code: META | SHIFT | Key_L, label: "Meta+Shift+L" },
        // Swap: Meta+Shift+Arrows
        { code: META | SHIFT | Key_Left,  label: "Meta+Shift+Left" },
        { code: META | SHIFT | Key_Down,  label: "Meta+Shift+Down" },
        { code: META | SHIFT | Key_Up,    label: "Meta+Shift+Up" },
        { code: META | SHIFT | Key_Right, label: "Meta+Shift+Right" },
        // Move to desktop: Meta+Shift+1..9,0
        { code: META | SHIFT | Key_1,     label: "Meta+Shift+1" },
        { code: META | SHIFT | (Key_1+1), label: "Meta+Shift+2" },
        { code: META | SHIFT | (Key_1+2), label: "Meta+Shift+3" },
        { code: META | SHIFT | (Key_1+3), label: "Meta+Shift+4" },
        { code: META | SHIFT | (Key_1+4), label: "Meta+Shift+5" },
        { code: META | SHIFT | (Key_1+5), label: "Meta+Shift+6" },
        { code: META | SHIFT | (Key_1+6), label: "Meta+Shift+7" },
        { code: META | SHIFT | (Key_1+7), label: "Meta+Shift+8" },
        { code: META | SHIFT | (Key_1+8), label: "Meta+Shift+9" },
        { code: META | SHIFT | Key_0,     label: "Meta+Shift+0" },
        // Other
        { code: META | Key_Backtab,  label: "Meta+Shift+Tab" },
        { code: META | Key_Space,    label: "Meta+Space" },
        { code: META | Key_F,        label: "Meta+F" },
        { code: META | Key_Q,        label: "Meta+Q" },
        { code: META | Key_Minus,    label: "Meta+Minus" },
        { code: META | Key_Equal,    label: "Meta+Equal" },
    ];

    /**
     * All aerogel shortcut action names registered via registerShortcut().
     * Used on destroy() to unregister from KGlobalAccel.
     */
    const AEROGEL_ACTIONS: string[] = [
        // Focus (vim keys)
        "aerogel-focus-left", "aerogel-focus-down",
        "aerogel-focus-up",   "aerogel-focus-right",
        // Focus (arrow keys)
        "aerogel-focus-left-arrow", "aerogel-focus-down-arrow",
        "aerogel-focus-up-arrow",   "aerogel-focus-right-arrow",
        // Swap (vim keys)
        "aerogel-move-left",  "aerogel-move-down",
        "aerogel-move-up",    "aerogel-move-right",
        // Swap (arrow keys)
        "aerogel-move-left-arrow",  "aerogel-move-down-arrow",
        "aerogel-move-up-arrow",    "aerogel-move-right-arrow",
        // Desktop switching
        "aerogel-desktop-1",  "aerogel-desktop-2",  "aerogel-desktop-3",
        "aerogel-desktop-4",  "aerogel-desktop-5",  "aerogel-desktop-6",
        "aerogel-desktop-7",  "aerogel-desktop-8",  "aerogel-desktop-9",
        "aerogel-desktop-10",
        // Move window to desktop
        "aerogel-move-to-desktop-1",  "aerogel-move-to-desktop-2",
        "aerogel-move-to-desktop-3",  "aerogel-move-to-desktop-4",
        "aerogel-move-to-desktop-5",  "aerogel-move-to-desktop-6",
        "aerogel-move-to-desktop-7",  "aerogel-move-to-desktop-8",
        "aerogel-move-to-desktop-9",  "aerogel-move-to-desktop-10",
        // Shifted-symbol alternatives (US-EN layout fallback)
        "aerogel-move-to-desktop-1-sym",  "aerogel-move-to-desktop-2-sym",
        "aerogel-move-to-desktop-3-sym",  "aerogel-move-to-desktop-4-sym",
        "aerogel-move-to-desktop-5-sym",  "aerogel-move-to-desktop-6-sym",
        "aerogel-move-to-desktop-7-sym",  "aerogel-move-to-desktop-8-sym",
        "aerogel-move-to-desktop-9-sym",  "aerogel-move-to-desktop-10-sym",
        // Monitor / float / fullscreen / close / resize
        "aerogel-next-monitor",
        "aerogel-float-toggle",
        "aerogel-fullscreen-toggle",
        "aerogel-close-window",
        "aerogel-resize-shrink",
        "aerogel-resize-grow",
    ];

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Detect shortcut conflicts and notify the user.
     *
     * For each aerogel key binding, queries KGlobalAccel to check if another
     * action already claims that key.  Logs each conflict to the journal and
     * sends a single desktop notification summarising the count.
     *
     * Uses `getGlobalShortcutsByKey(int32)` which takes a single int32 --
     * compatible with callDBus() (no `as` marshaling needed).
     *
     * Called from main.ts init() after shortcuts are registered.
     */
    export function detectConflicts(): void {
        let conflictCount = 0;
        let pending = AEROGEL_KEYS.length;

        for (let i = 0; i < AEROGEL_KEYS.length; i++) {
            const key = AEROGEL_KEYS[i];
            callDBus(
                KGACCEL_SERVICE, KGACCEL_PATH, KGACCEL_IFACE,
                "getGlobalShortcutsByKey", key.code,
                (infos: unknown) => {
                    try {
                        // The reply is an array of KGlobalShortcutInfo structs.
                        // Each struct is marshaled as (ssssssaiai) -- we receive
                        // it as an array/object.  We just need to check if any
                        // non-aerogel action claims this key.
                        const arr = infos as Array<{
                            0: string; // actionUnique
                            2: string; // componentUnique
                        }> | undefined;

                        if (arr && arr.length > 0) {
                            for (let j = 0; j < arr.length; j++) {
                                const entry = arr[j];
                                // D-Bus struct fields arrive as indexed properties
                                const component = entry[2] || String(entry);
                                const action    = entry[0] || "";
                                if (component === "kwin" && action.indexOf("aerogel") === 0) {
                                    continue; // our own registration -- not a conflict
                                }
                                conflictCount++;
                                console.warn(
                                    "[aerogel] shortcut conflict: " + key.label +
                                    " is claimed by " + component +
                                    " \"" + action + "\"" +
                                    " - clear it in System Settings → Shortcuts",
                                );
                            }
                        }
                    } catch (e) {
                        // Silently ignore parse errors -- conflict detection is
                        // best-effort.
                    }

                    pending--;
                    if (pending === 0 && conflictCount > 0) {
                        sendConflictNotification(conflictCount);
                    }
                },
            );
        }
    }

    /**
     * Remove all aerogel shortcut registrations from KGlobalAccel.
     *
     * Called from main.ts destroy() so that kglobalshortcutsrc is cleaned up
     * when the script is disabled or uninstalled.
     *
     * Uses org.kde.KGlobalAccel.unregister(componentUnique: s, shortcutUnique: s)
     * which takes two plain strings -- compatible with callDBus() marshaling.
     */
    export function cleanup(): void {
        console.log("[aerogel] ShortcutConflictManager: unregistering", AEROGEL_ACTIONS.length, "shortcuts from KGlobalAccel");
        for (let i = 0; i < AEROGEL_ACTIONS.length; i++) {
            unregisterAction(AEROGEL_ACTIONS[i]);
        }
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function sendConflictNotification(count: number): void {
        console.warn(
            "[aerogel] " + count + " shortcut conflict(s) detected. " +
            "Some shortcuts may not work. See KWin logs for details.",
        );
        callDBus(
            "org.freedesktop.Notifications",
            "/org/freedesktop/Notifications",
            "org.freedesktop.Notifications",
            "Notify",
            "Aerogel",         // app_name
            0,                 // replaces_id (0 = new notification)
            "aerogel",         // app_icon (from hicolor icon theme)
            "Shortcut conflicts detected",  // summary
            count + " shortcut(s) conflict with existing KDE bindings. " +
            "Some aerogel shortcuts may not work.\n" +
            "Open System Settings → Shortcuts to resolve.",  // body
            // The remaining args (actions, hints, timeout) require array types
            // which callDBus can't marshal correctly, but the Notify method
            // is lenient -- missing trailing args get defaults.
        );
    }

    function unregisterAction(actionName: string): void {
        callDBus(
            KGACCEL_SERVICE, KGACCEL_PATH, KGACCEL_IFACE,
            "unregister",
            "aerogel",
            actionName,
            (ok: boolean) => {
                if (!ok) {
                    // Silently ignore: action may not exist if script never
                    // fully loaded, or was already cleaned up.
                }
            },
        );
    }
}
