/// <reference path="../extern/kwin.d.ts" />

/**
 * WindowFilter.ts -- Determines whether a KWin window should be tiled.
 *
 * A window is eligible for tiling if ALL of the following are true:
 *
 *   1. window.managed === true          -- KWin manages this window
 *   2. window.normalWindow === true     -- regular app window (not panel/dock/etc.)
 *   3. window.dock === false            -- not a panel / taskbar
 *   4. window.desktopWindow === false   -- not the desktop background
 *   5. window.dialog === false          -- not a dialog
 *   6. window.specialWindow === false   -- not override-redirect / special
 *   7. window.popupWindow === false     -- not a popup / tooltip / menu
 *   8. window.transient === false       -- not a transient (child dialog)
 *   9. window.minimized === false       -- not currently minimized
 *  10. window.fullScreen === false      -- not currently fullscreen
 *  11. Not in the floatingWindows set   -- not user-floated via Super+Space
 *  12. window.moveable === true         -- can be moved (implies tiling is applicable)
 *  13. window.resizeable === true       -- can be resized
 *
 * Notes:
 * - `normalWindow` is the most inclusive "this is a real app window" check in
 *   KWin 6.  It is false for docks, desktop widgets, splash screens, etc.
 * - Transient windows (dialogs spawned by another window) are excluded; they
 *   float above their parent naturally without tiling.
 * - Minimized / fullscreen windows are excluded from the active tile tree but
 *   re-inserted when they return to normal state.
 */

namespace WindowFilter {
    /**
     * Returns true if the window should ever be considered for tiling
     * (based on its intrinsic, relatively-stable properties).
     * Does NOT check transient state (minimized / fullscreen).
     */
    export function isTileable(window: KWinWindow): boolean {
        return window.managed
            && window.normalWindow
            && !window.dock
            && !window.desktopWindow
            && !window.dialog
            && !window.specialWindow
            && !window.popupWindow
            && !window.transient
            && window.moveable
            && window.resizeable;
    }

    /**
     * Returns true if the window should be tiled RIGHT NOW.
     * Combines static tileability with current runtime state and the
     * user-controlled floating set.
     *
     * @param window          The window to test.
     * @param floatingWindows Set of window internalIds that the user has
     *                        toggled to float via Super+Space.
     */
    export function shouldTileNow(
        window: KWinWindow,
        floatingWindows: Set<string>,
    ): boolean {
        return isTileable(window)
            && !window.minimized
            && !window.fullScreen
            && !floatingWindows.has(window.internalId);
    }
}
