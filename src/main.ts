/// <reference path="extern/kwin.d.ts" />
/// <reference path="config/Config.ts" />
/// <reference path="layout/GapConfig.ts" />
/// <reference path="layout/BSPLayout.ts" />
/// <reference path="tree/Node.ts" />
/// <reference path="tree/Container.ts" />
/// <reference path="tree/WindowNode.ts" />
/// <reference path="tree/Tree.ts" />
/// <reference path="manager/WindowFilter.ts" />
/// <reference path="manager/WorkspaceManager.ts" />
/// <reference path="shortcuts/ShortcutConflictManager.ts" />
/// <reference path="shortcuts/Shortcuts.ts" />

/**
 * main.ts -- Aerogel KWin script entry point.
 *
 * This file is compiled (together with all files in src/) into a single
 * package/contents/code/main.js by tsc with `outFile` + `module: none`.
 *
 * Execution model
 * ───────────────
 * When the script is loaded by a QML host (package/contents/ui/main.qml):
 *   - The QML Component.onCompleted handler calls `init()`.
 *   - The QML Component.onDestruction handler calls `destroy()`.
 *
 * When loaded as a plain JS KWin script (without a QML host), `init()` is
 * called immediately at the module scope below.
 *
 * The exported `init` / `destroy` functions are the only entry points.
 */

/**
 * The active WorkspaceManager instance. Kept in module scope so the QML
 * host can call destroy() on it later.
 */
let _manager: WorkspaceManager | null = null;

/**
 * Initialise aerogel: load config, create the WorkspaceManager, connect
 * signals, and tile any existing windows.
 *
 * Called either by the QML host's Component.onCompleted, or directly when
 * the script is run without a QML host.
 */
function init(): WorkspaceManager {
    try {
        if (_manager !== null) {
            console.warn("[aerogel] init() called while already initialised -- destroying old instance.");
            _manager.destroy();
            Shortcuts.unregister();
        }

        const config = loadConfig();
        _manager = new WorkspaceManager(config);

        // Register keyboard shortcuts (needs _manager to be set first).
        Shortcuts.register(_manager);

        // Detect shortcut conflicts asynchronously.  Logs detailed warnings
        // per conflict and sends a single aggregated desktop notification if
        // any are found.  NixOS users have conflicts cleared declaratively
        // by the home-manager module; other users are directed to
        // System Settings → Shortcuts.
        ShortcutConflictManager.detectConflicts();

        // Connect workspace signals and tile existing windows.
        _manager.init();

        console.log("[aerogel] started successfully.");
        return _manager;
    } catch (e) {
        console.error("[aerogel] init() failed:", e);
        throw e;
    }
}

/**
 * Tear down aerogel: disconnect all signals and unregister shortcuts.
 * Called by the QML host's Component.onDestruction.
 */
function destroy(): void {
    try {
        Shortcuts.unregister();
        if (_manager !== null) {
            _manager.destroy();
            _manager = null;
        }
        // Remove aerogel shortcut registrations from KGlobalAccel.
        // Original KDE bindings are restored by the `aerogel-disable` shell script.
        ShortcutConflictManager.cleanup();
        console.log("[aerogel] stopped.");
    } catch (e) {
        console.error("[aerogel] destroy() failed:", e);
    }
}

// ---------------------------------------------------------------------------
// Auto-start when loaded without a QML host (plain JS KWin script mode).
//
// In plain-script mode, KWin executes the compiled JS directly with no QML
// wrapper. In that case qmlBase is undefined and there's no Component
// lifecycle -- we just run init() immediately.
//
// When loaded via main.qml, the `init` and `destroy` symbols are exported to
// the QML side via the `as Aerogel` import alias and called by Component.
// ---------------------------------------------------------------------------
(function autoStart() {
    // If qmlBase is defined we're inside a QML host -- don't auto-start here.
    try {
        // qmlBase will throw a ReferenceError if not defined.
        if (typeof qmlBase !== "undefined") return;
    } catch (_) {
        // ReferenceError means qmlBase doesn't exist → plain-script mode.
    }
    init();
})();
