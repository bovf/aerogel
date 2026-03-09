/**
 * KWin 6 / Qt type declarations for the KWin scripting engine.
 * These types describe the global objects and interfaces available
 * inside a KWin JavaScript/TypeScript script at runtime.
 */

// ---------------------------------------------------------------------------
// Qt primitives
// ---------------------------------------------------------------------------

/** Point (QPoint). */
interface QPoint {
    readonly x: number;
    readonly y: number;
}

/** Immutable rectangle (QRectF / QmlRect). */
interface QRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** Mutable rectangle returned by/assigned to frameGeometry. */
interface QMutableRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Size (QSizeF). */
interface QSize {
    readonly width: number;
    readonly height: number;
}

/** Generic Qt signal. */
interface QSignal<T extends unknown[] = []> {
    connect(handler: (...args: T) => void): void;
    disconnect(handler: (...args: T) => void): void;
}

/** Base QML object (QtObject / Item). */
interface QmlObject {
    destroy(): void;
}

// ---------------------------------------------------------------------------
// Qt namespace (global) -- only available when a QML host is present.
// In plain-script mode (no QML host) Qt is undefined; use plain JS objects
// for QRect values instead (KWin's C++ binding accepts {x,y,width,height}).
// ---------------------------------------------------------------------------

declare namespace Qt {
    /** Create a QML object dynamically. Only callable with a QML host. */
    function createQmlObject(qml: string, parent: QmlObject, url?: string): QmlObject;
}

// ---------------------------------------------------------------------------
// KWin 6 types
// ---------------------------------------------------------------------------

/** A KDE virtual desktop. */
interface KWinVirtualDesktop {
    /** UUID string -- stable across renames. */
    readonly id: string;
    /** Human-readable name, e.g. "Desktop 1". */
    readonly name: string;
    /** 1-based position index in the desktop list. */
    readonly x11DesktopNumber: number;
}

/** A physical display / monitor. */
interface KWinOutput {
    readonly name: string;
    readonly geometry: QRect;
    readonly serialNumber: string;
    readonly manufacturer: string;
    readonly model: string;
}

/** A KWin-managed window (KWin::Window). */
interface KWinWindow {
    // ---- identity --------------------------------------------------------
    readonly internalId: string;          // QUuid → toString()
    readonly resourceClass: string;       // WM_CLASS
    readonly resourceName: string;
    readonly caption: string;
    readonly pid: number;

    // ---- type flags (read-only) -----------------------------------------
    readonly normalWindow: boolean;       // regular application window
    readonly dock: boolean;               // panel / taskbar
    readonly desktopWindow: boolean;      // desktop background
    readonly dialog: boolean;             // dialog window
    readonly specialWindow: boolean;      // override-redirect / special
    readonly popupWindow: boolean;
    readonly transient: boolean;          // is a transient of another window
    readonly transientFor: KWinWindow | null;
    readonly managed: boolean;            // managed by KWin (not override-redirect)

    // ---- state flags (read-write) ----------------------------------------
    minimized: boolean;
    fullScreen: boolean;
    keepAbove: boolean;
    keepBelow: boolean;
    skipSwitcher: boolean;
    opacity: number;                      // 0..1

    // ---- capabilities ---------------------------------------------------
    readonly moveable: boolean;
    readonly resizeable: boolean;
    readonly fullScreenable: boolean;
    readonly maximizable: boolean;

    // ---- interactive state (read-only) -----------------------------------
    readonly move: boolean;               // currently being moved by user
    readonly resize: boolean;             // currently being resized by user

    // ---- geometry -------------------------------------------------------
    frameGeometry: QRect;                 // read-write: set to move/resize
    readonly clientGeometry: QRect;       // client area (excl. frame decoration)
    readonly minSize: QSize;

    /**
     * Set the maximize mode. Must be called with (false, false) to
     * un-maximize before frameGeometry can be set on Wayland.
     * @param vertically  Maximize vertically.
     * @param horizontally Maximize horizontally.
     */
    setMaximize(vertically: boolean, horizontally: boolean): void;

    /**
     * Close the window (sends WM_DELETE_WINDOW on X11; xdg_toplevel close on Wayland).
     * Equivalent to clicking the window's close button.
     * The window may prompt the user to save unsaved work before closing.
     */
    closeWindow(): void;

    // ---- desktop / screen placement -------------------------------------
    desktops: KWinVirtualDesktop[];       // empty = on all desktops
    activities: string[];                 // empty = on all activities
    readonly output: KWinOutput;          // current screen

    // ---- KWin built-in tiling (set null to bypass) ----------------------
    tile: unknown | null;

    // ---- per-window signals ---------------------------------------------
    readonly frameGeometryChanged: QSignal<[oldGeometry: QRect]>;
    readonly desktopsChanged: QSignal<[]>;
    readonly activitiesChanged: QSignal<[]>;
    readonly minimizedChanged: QSignal<[]>;
    readonly fullScreenChanged: QSignal<[]>;
    readonly captionChanged: QSignal<[]>;
    readonly tileChanged: QSignal<[]>;
    readonly interactiveMoveResizeStarted: QSignal<[]>;
    readonly interactiveMoveResizeFinished: QSignal<[]>;
    readonly outputChanged: QSignal<[]>;
}

/**
 * Options for workspace.clientArea().
 * Values match KWin's clientAreaOption enum (kwin/effect/globals.h).
 *
 * IMPORTANT: WorkArea (5) and FullArea (6) return the *combined* rect of
 * ALL screens, not a single screen's rect.  Use MaximizeArea (2) to get
 * the usable area of a specific screen (excludes panels/docks, per-screen).
 * Use ScreenArea (7) for the raw per-screen rect including struts.
 */
declare const enum ClientAreaOption {
    PlacementArea    = 0,  // per-screen placement area (excludes panels)
    MovementArea     = 1,  // per-screen movement/snap area
    MaximizeArea     = 2,  // per-screen usable area (excludes panels) ← use this for tiling
    MaximizeFullArea = 3,  // per-screen full area (ignores panels)
    FullScreenArea   = 4,  // per-screen fullscreen area
    WorkArea         = 5,  // ALL screens combined work area -- not per-screen!
    FullArea         = 6,  // ALL screens combined full area -- not per-screen!
    ScreenArea       = 7,  // per-screen raw area (ignores struts/panels)
}

/** The global workspace object (KWin::WorkspaceWrapper). */
interface KWinWorkspace {
    // ---- windows --------------------------------------------------------
    /** Returns all managed windows. Use this instead of a `windows` property. */
    windowList(): KWinWindow[];
    activeWindow: KWinWindow | null;

    // ---- desktops -------------------------------------------------------
    currentDesktop: KWinVirtualDesktop;
    readonly desktops: KWinVirtualDesktop[];

    // ---- activities -----------------------------------------------------
    readonly currentActivity: string;
    readonly activities: string[];

    // ---- screens --------------------------------------------------------
    readonly activeScreen: KWinOutput;
    /** Screens in focus-priority order (index 0 = primary). */
    readonly screenOrder: KWinOutput[];
    /** Current cursor position in global compositor coordinates (read-only). */
    readonly cursorPos: QPoint;

    // ---- methods --------------------------------------------------------
    /** Get the usable area for a screen on a desktop (excludes panels/docks). */
    clientArea(option: ClientAreaOption, output: KWinOutput, desktop: KWinVirtualDesktop): QRect;
    /** Move a window to a different screen. */
    sendClientToScreen(window: KWinWindow, output: KWinOutput): void;
    /**
     * Create a new virtual desktop at `position` (0-based index) with `name`.
     * If `name` is empty KWin assigns a default name. Max 25 desktops.
     */
    createDesktop(position: number, name: string): void;
    /** Remove a virtual desktop. Windows on it are moved to the adjacent desktop. */
    removeDesktop(desktop: KWinVirtualDesktop): void;

    // ---- workspace signals ----------------------------------------------
    readonly windowAdded: QSignal<[window: KWinWindow]>;
    readonly windowRemoved: QSignal<[window: KWinWindow]>;
    readonly windowActivated: QSignal<[window: KWinWindow | null]>;
    readonly currentDesktopChanged: QSignal<[]>;
    readonly desktopsChanged: QSignal<[]>;
    readonly screensChanged: QSignal<[]>;
    readonly screenOrderChanged: QSignal<[]>;
    readonly currentActivityChanged: QSignal<[]>;
    readonly activitiesChanged: QSignal<[]>;
    /** Fired whenever the cursor position changes. */
    readonly cursorPosChanged: QSignal<[]>;
}

/** KWin shortcut handler (QML ShortcutHandler type). */
interface KWinShortcutHandler extends QmlObject {
    readonly activated: QSignal<[]>;
}

// ---------------------------------------------------------------------------
// KWin scripting globals
// ---------------------------------------------------------------------------

/** Global workspace object. */
declare const workspace: KWinWorkspace;

/**
 * Read a value from the script's KConfig.
 * @param key   The config key (must match main.xml entry).
 * @param def   Default value if the key is not set.
 */
declare function readConfig(key: string, def: unknown): unknown;

/**
 * Register a global keyboard shortcut.
 * NOTE: In KWin 6, prefer Qt.createQmlObject + ShortcutHandler instead,
 * since registerShortcut may not persist across sessions in some setups.
 */
declare function registerShortcut(
    title: string,
    text: string,
    keySequence: string,
    callback: () => void,
): void;

/**
 * Make an asynchronous D-Bus call from within a KWin script.
 *
 * Maps to KWin::Script::callDBus() in the C++ scripting runtime.
 * Up to 9 positional arguments can be passed; the last one may be a
 * callback function that receives the reply arguments.
 *
 * @param service    D-Bus service name, e.g. "org.kde.kglobalaccel"
 * @param path       Object path, e.g. "/kglobalaccel"
 * @param interface_ Interface name, e.g. "org.kde.KGlobalAccel"
 * @param method     Method name, e.g. "shortcut"
 * @param args       Up to 9 positional arguments; the last may be a callback.
 *
 * @example
 * // Query the current binding for a foreign shortcut:
 * callDBus(
 *   "org.kde.kglobalaccel", "/kglobalaccel",
 *   "org.kde.KGlobalAccel", "shortcut",
 *   ["plasmashell", "activate task manager entry 1", "", ""],
 *   (keys: number[]) => { ... }
 * );
 */
declare function callDBus(
    service: string,
    path: string,
    interface_: string,
    method: string,
    ...args: unknown[]
): void;

/**
 * The QML base Item -- parent for dynamically created QML objects.
 * Available inside KWin scripts that use a QML UI host.
 */
declare const qmlBase: QmlObject;

/** Global console for debug logging. */
declare const console: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};
