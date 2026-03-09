/// <reference path="../extern/kwin.d.ts" />
/// <reference path="../manager/WorkspaceManager.ts" />
/// <reference path="../tree/Node.ts" />

/**
 * Shortcuts.ts -- Registers all keyboard shortcuts for aerogel.
 *
 * In KWin 6, the correct way to register shortcuts inside a script that uses
 * a QML UI host is via Qt.createQmlObject() with a ShortcutHandler. This
 * approach persists the shortcut in KDE's global shortcut registry and allows
 * the user to rebind it in System Settings → Shortcuts.
 *
 * Fallback: if qmlBase is not available (script loaded without a QML host),
 * we call registerShortcut() which is also supported but doesn't integrate
 * with the KDE shortcut system as well.
 *
 * Shortcut map
 * ────────────
 * Super+H          Focus left
 * Super+J          Focus down
 * Super+K          Focus up
 * Super+L          Focus right
 *
 * Super+Shift+H    Swap/move window left
 * Super+Shift+J    Swap/move window down
 * Super+Shift+K    Swap/move window up
 * Super+Shift+L    Swap/move window right
 *
 * Super+1..9,0     Switch to virtual desktop N (0 = desktop 10; created on demand)
 * Super+Shift+1..9,0 Move active window to virtual desktop N
 *
 * Super+Tab        Move workspace to next monitor
 * Super+Space      Toggle float for active window
 *
 * Keyboard layout note (Meta+Shift+digit)
 * ────────────────────────────────────────
 * On US-EN keyboards, pressing Shift+digit sends the shifted keysym
 * (e.g. Shift+1 → '!', Shift+2 → '@', etc.) rather than Shift+Key_1.
 * When input is delivered via SPICE, Plasma may receive Meta+! instead of
 * Meta+Shift+1. To work around this, each move-to-desktop action is also
 * registered as a separate shortcut with the shifted symbol as the key
 * sequence (e.g. "aerogel-move-to-desktop-1-sym" bound to "Meta+!").
 *
 * Only US-EN keyboard layout is officially supported for Meta+Shift+digit.
 */

namespace Shortcuts {
    /** A registered ShortcutHandler QML object. Kept alive to prevent GC. */
    interface Handler {
        handler: KWinShortcutHandler;
    }

    /** All live handler objects (retained to prevent garbage collection). */
    const handlers: Handler[] = [];

    /** Count of successfully registered shortcuts (QML or fallback). */
    let registeredCount = 0;

    // -----------------------------------------------------------------------
    // US-EN Shift+digit → symbol map
    // -----------------------------------------------------------------------

    /**
     * Shifted digit symbols on a US-EN keyboard, indexed by digit (0-9).
     * Used to register alternative "Meta+<symbol>" shortcuts so that
     * Meta+Shift+N still fires even when the compositor delivers the shifted
     * keysym (e.g. via SPICE display).
     *
     *   Digit 0 → ')'   Digit 1 → '!'   Digit 2 → '@'
     *   Digit 3 → '#'   Digit 4 → '$'   Digit 5 → '%'
     *   Digit 6 → '^'   Digit 7 → '&'   Digit 8 → '*'
     *   Digit 9 → '('
     */
    const SHIFTED_SYMS: string[] = [")", "!", "@", "#", "$", "%", "^", "&", "*", "("];

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Register all aerogel shortcuts.
     * @param manager  The WorkspaceManager instance to dispatch actions to.
     */
    export function register(manager: WorkspaceManager): void {
        // ---- Focus navigation (vim keys + arrow keys) ----
        bind("aerogel-focus-left",       "Aerogel: Focus Left",  "Meta+H",    () => manager.focusDirection(Direction.Left));
        bind("aerogel-focus-down",       "Aerogel: Focus Down",  "Meta+J",    () => manager.focusDirection(Direction.Down));
        bind("aerogel-focus-up",         "Aerogel: Focus Up",    "Meta+K",    () => manager.focusDirection(Direction.Up));
        bind("aerogel-focus-right",      "Aerogel: Focus Right", "Meta+L",    () => manager.focusDirection(Direction.Right));
        bind("aerogel-focus-left-arrow", "Aerogel: Focus Left (Arrow)",  "Meta+Left",  () => manager.focusDirection(Direction.Left));
        bind("aerogel-focus-down-arrow", "Aerogel: Focus Down (Arrow)",  "Meta+Down",  () => manager.focusDirection(Direction.Down));
        bind("aerogel-focus-up-arrow",   "Aerogel: Focus Up (Arrow)",    "Meta+Up",    () => manager.focusDirection(Direction.Up));
        bind("aerogel-focus-right-arrow","Aerogel: Focus Right (Arrow)", "Meta+Right", () => manager.focusDirection(Direction.Right));

        // ---- Window swap/move (vim keys + arrow keys) ----
        bind("aerogel-move-left",        "Aerogel: Move Window Left",  "Meta+Shift+H",     () => manager.swapDirection(Direction.Left));
        bind("aerogel-move-down",        "Aerogel: Move Window Down",  "Meta+Shift+J",     () => manager.swapDirection(Direction.Down));
        bind("aerogel-move-up",          "Aerogel: Move Window Up",    "Meta+Shift+K",     () => manager.swapDirection(Direction.Up));
        bind("aerogel-move-right",       "Aerogel: Move Window Right", "Meta+Shift+L",     () => manager.swapDirection(Direction.Right));
        bind("aerogel-move-left-arrow",  "Aerogel: Move Window Left (Arrow)",  "Meta+Shift+Left",  () => manager.swapDirection(Direction.Left));
        bind("aerogel-move-down-arrow",  "Aerogel: Move Window Down (Arrow)",  "Meta+Shift+Down",  () => manager.swapDirection(Direction.Down));
        bind("aerogel-move-up-arrow",    "Aerogel: Move Window Up (Arrow)",    "Meta+Shift+Up",    () => manager.swapDirection(Direction.Up));
        bind("aerogel-move-right-arrow", "Aerogel: Move Window Right (Arrow)", "Meta+Shift+Right", () => manager.swapDirection(Direction.Right));

        // ---- Desktop switching (Meta+1..9,0; 0 = desktop 10) ----
        for (let n = 1; n <= 10; n++) {
            const num = n;
            const key = num === 10 ? "0" : String(num);
            bind(
                `aerogel-desktop-${num}`,
                `Aerogel: Switch to Desktop ${num}`,
                `Meta+${key}`,
                () => manager.switchToDesktop(num),
            );
        }

        // ---- Move window to desktop (Meta+Shift+1..9,0) ----
        for (let n = 1; n <= 10; n++) {
            const num = n;
            const key = num === 10 ? "0" : String(num);
            bind(
                `aerogel-move-to-desktop-${num}`,
                `Aerogel: Move Window to Desktop ${num}`,
                `Meta+Shift+${key}`,
                () => manager.moveWindowToDesktop(num),
            );
        }

        // Shifted-symbol alternatives for move-to-desktop (US-EN SPICE fallback).
        for (let n = 1; n <= 10; n++) {
            const num = n;
            const digitIndex = num === 10 ? 0 : num;
            const sym = SHIFTED_SYMS[digitIndex];
            bind(
                `aerogel-move-to-desktop-${num}-sym`,
                `Aerogel: Move Window to Desktop ${num} (symbol key)`,
                `Meta+${sym}`,
                () => manager.moveWindowToDesktop(num),
            );
        }

        // ---- Move workspace to next monitor (Meta+Shift+Tab) ----
        // Qt canonicalises Shift+Tab as "Backtab" (Key_Backtab = 0x01000002).
        // Only one registration needed -- KWin matches Meta+Shift+Tab to this.
        // Registering both "Meta+Backtab" and "Meta+Shift+Tab" causes double
        // firing on a single keypress (both names resolve to the same key event).
        bind("aerogel-next-monitor", "Aerogel: Move Workspace to Next Monitor", "Meta+Backtab", () => manager.moveWorkspaceToNextMonitor());

        // ---- Float toggle ----
        bind("aerogel-float-toggle", "Aerogel: Toggle Float", "Meta+Space", () => {
            manager.toggleFloat();
        });

        // ---- Fullscreen toggle (Meta+F) ----
        bind("aerogel-fullscreen-toggle", "Aerogel: Toggle Fullscreen", "Meta+F", () => {
            manager.toggleFullscreen();
        });

        // ---- Close window (Meta+Q) ----
        bind("aerogel-close-window", "Aerogel: Close Window", "Meta+Q", () => {
            manager.closeWindow();
        });

        // ---- Resize smart (Meta+Minus / Meta+Equal) ----
        // Qt key strings use the key name, not the character symbol.
        bind("aerogel-resize-shrink", "Aerogel: Resize Shrink", "Meta+Minus", () => {
            manager.resizeSmart(-50);
        });
        bind("aerogel-resize-grow",   "Aerogel: Resize Grow",   "Meta+Equal", () => {
            manager.resizeSmart(50);
        });

        console.log("[aerogel] registered", registeredCount, "shortcuts.");
    }

    /**
     * Destroy all registered shortcut handlers (called from manager.destroy()).
     */
    export function unregister(): void {
        for (const h of handlers) {
            try { h.handler.destroy(); } catch (_) { /* already gone */ }
        }
        handlers.length = 0;
    }

    // -----------------------------------------------------------------------
    // Internal: shortcut binding helper
    // -----------------------------------------------------------------------

    /**
     * Create a ShortcutHandler QML object and wire it to `callback`.
     *
     * Prefers Qt.createQmlObject() + ShortcutHandler (KWin 6 best practice).
     * Falls back to registerShortcut() if QML object creation fails.
     */
    function bind(
        name: string,
        text: string,
        sequence: string,
        callback: () => void,
    ): void {
        try {
            // Attempt QML-based shortcut registration (KWin 6).
            // qmlBase is the Item{} defined in the QML host.
            const qml = `
import QtQuick 6.0
import org.kde.kwin 3.0
ShortcutHandler {
    name: "${name}";
    text: "${text}";
    sequence: "${sequence}";
}`;
            const handlerObj = Qt.createQmlObject(qml, qmlBase) as KWinShortcutHandler;
            handlerObj.activated.connect(() => {
                try {
                    callback();
                } catch (e) {
                    console.error(`[aerogel] shortcut ${name} error:`, e);
                }
            });
            handlers.push({ handler: handlerObj });
            registeredCount++;
        } catch (_) {
            // QML creation failed (expected in plain-script mode -- no qmlBase/Qt).
            // Fall back to registerShortcut().
            try {
                registerShortcut(name, text, sequence, () => {
                    try {
                        callback();
                    } catch (err) {
                        console.error(`[aerogel] shortcut ${name} error:`, err);
                    }
                });
                registeredCount++;
            } catch (fallbackErr) {
                console.error(`[aerogel] registerShortcut also failed for ${name}:`, fallbackErr);
            }
        }
    }
}
