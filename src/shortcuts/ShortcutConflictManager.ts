/// <reference path="../extern/kwin.d.ts" />

/**
 * ShortcutConflictManager.ts -- Clean up aerogel KGlobalAccel registrations.
 *
 * Responsibility
 * ──────────────
 * When aerogel is disabled or uninstalled, its shortcut registrations persist
 * in ~/.config/kglobalshortcutsrc as orphaned entries under the [kwin]
 * section. This manager removes them via the KGlobalAccel D-Bus API so the
 * user's shortcut database stays clean.
 *
 * Conflict clearing and backup/restore
 * ─────────────────────────────────────
 * Aerogel conflicts with several KDE default shortcuts (Meta+1..9, Meta+0,
 * Meta+L, Meta+Tab). Clearing those conflicts and restoring them on disable
 * is handled by the shell scripts `nix run .#aerogel-enable` and
 * `nix run .#aerogel-disable`, which use `kwriteconfig6` to read and write
 * ~/.config/kglobalshortcutsrc directly. That approach is more reliable than
 * using D-Bus from within the script because KWin's callDBus() marshals
 * JavaScript arrays as D-Bus type `av` (variant array), whereas the
 * KGlobalAccel API requires `as` (string array) for action IDs.
 *
 * What this module does
 * ─────────────────────
 * On destroy(): for each aerogel-registered shortcut action, call
 *   org.kde.kglobalaccel /kglobalaccel org.kde.KGlobalAccel.unregister(s, s)
 * This method takes two plain strings (component, actionName) so it works
 * correctly with callDBus() without the `av`/`as` marshaling problem.
 */

namespace ShortcutConflictManager {

    const KGACCEL_SERVICE = "org.kde.kglobalaccel";
    const KGACCEL_PATH    = "/kglobalaccel";
    const KGACCEL_IFACE   = "org.kde.KGlobalAccel";

    /**
     * All aerogel shortcut action names registered via registerShortcut().
     * On destroy() each is unregistered from KGlobalAccel so kglobalshortcutsrc
     * is cleaned up and the keys are freed for the user's original bindings
     * (which were restored by `aerogel-disable` before the script was stopped).
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
