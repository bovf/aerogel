/// <reference path="../extern/kwin.d.ts" />
/// <reference path="../config/Config.ts" />
/// <reference path="../layout/GapConfig.ts" />
/// <reference path="../layout/BSPLayout.ts" />
/// <reference path="../tree/Node.ts" />
/// <reference path="../tree/Container.ts" />
/// <reference path="../tree/WindowNode.ts" />
/// <reference path="../tree/Tree.ts" />
/// <reference path="WindowFilter.ts" />

/**
 * WorkspaceManager -- AeroSpace-style workspace-per-monitor for KDE/KWin.
 *
 * ── Workspace model ──────────────────────────────────────────────────────────
 *
 * Workspaces are numbered 1…N.  Each workspace has an *assigned monitor*
 * (its home screen).  Each monitor shows exactly one workspace at a time.
 *
 *   workspaceMonitor : Map<wsNum, screenName>   -- workspace's home monitor
 *   monitorWorkspace : Map<screenName, wsNum>   -- monitor's active workspace
 *   trees            : Map<wsNum, Tree>          -- BSP tree per workspace
 *
 * ── KWin desktop integration ─────────────────────────────────────────────────
 *
 * Each aerogel workspace maps 1-to-1 to a KWin virtual desktop
 * (workspace 1 → desktop index 0, workspace 2 → desktop index 1, …).
 *
 * workspace.currentDesktop is ALWAYS set to the focused monitor's active
 * workspace desktop.  The widget reads VirtualDesktopInfo.currentDesktop to
 * know which workspace the user is focused on.
 *
 * Visibility across multiple monitors:
 *   • Focused monitor's windows    → window.desktops = [their real desktop]
 *                                    currentDesktop = that desktop → KWin shows them
 *   • Unfocused monitors' visible  → window.desktops = []  ("all desktops")
 *     windows                        KWin shows them regardless of currentDesktop
 *   • Dormant workspace windows    → window.desktops = [their real desktop]
 *                                    that desktop ≠ currentDesktop → KWin hides them
 *
 * This is the "pinning" trick: unfocused-but-visible windows get desktops=[]
 * so KWin always renders them.  When focus moves to a different monitor, we
 * un-pin the old monitor's windows and pin the new unfocused monitor's windows.
 *
 * currentDesktop is set lazily (NOT during init) so plasmashell is fully up
 * before we touch it.
 *
 * ── Shortcut semantics ───────────────────────────────────────────────────────
 *
 *   Meta+N           Focus workspace N:
 *                      • visible on another monitor → focus that monitor
 *                      • dormant                   → activate on assigned monitor
 *                      • never seen                → assign to focused monitor
 *   Meta+Shift+N     Move focused window to workspace N
  *   Meta+Shift+Tab   Move the focused workspace (with windows) to the next
 *                    monitor.  The focused monitor falls back to its last
 *                    previously active workspace, or a new empty one.
 *                    Focus follows the workspace to the next monitor.
 */

interface WindowConnection {
    signal: QSignal<[]>;
    handler: () => void;
}

class WorkspaceManager {
    private readonly gaps: GapConfig;

    // ── Per-workspace state ───────────────────────────────────────────────────

    /** Assigned monitor for every known workspace (active + dormant). */
    private readonly workspaceMonitor: Map<number, string> = new Map();
    /** Active workspace for each monitor. */
    private readonly monitorWorkspace: Map<string, number> = new Map();
    /** BSP tree per workspace. */
    private readonly trees: Map<number, Tree> = new Map();

    // ── Focus tracking ────────────────────────────────────────────────────────

    /** Last focused window per workspace (for focus restore). */
    private readonly lastFocused: Map<number, string> = new Map();
    /** Most recently focused screen name. */
    private lastFocusedScreen: string = "";
    /**
     * Per-monitor stack of previously active workspace numbers, most recent
     * last.  Used by moveWorkspaceToNextMonitor() to restore the last-used
     * workspace on a monitor after its active workspace moves away.
     */
    private readonly monitorWsHistory: Map<string, number[]> = new Map();

    // ── Visibility tracking ───────────────────────────────────────────────────

    /** internalIds of windows currently pinned (desktops=[]). */
    private readonly pinnedWindows: Set<string> = new Set();

    // ── Misc ─────────────────────────────────────────────────────────────────

    private readonly floatingWindows: Set<string> = new Set();

    /**
     * Guard flag.  When true, onWindowOutputChanged / onWindowDesktopsChanged
     * skip processing to prevent re-entry during bulk operations.
     */
    private movingWindows: boolean = false;

    private readonly workspaceConnections: {
        signal: QSignal<unknown[]>;
        handler: (...args: unknown[]) => void;
    }[] = [];

    private readonly windowConnections: Map<string, WindowConnection[]> = new Map();

    constructor(config: AerogelConfig) {
        this.gaps = GapConfig.fromConfig(config);
    }

    // =========================================================================
    // Init / destroy
    // =========================================================================

    init(): void {
        const screens = workspace.screenOrder;
        // Assign workspace N to screen N (1-based).  Do NOT create KWin desktops
        // or touch currentDesktop here -- plasmashell may still be starting and
        // createDesktop() causes a lastScreen()=-1 crash.
        for (let i = 0; i < screens.length; i++) {
            const ws = i + 1;
            this.workspaceMonitor.set(ws, screens[i].name);
            this.monitorWorkspace.set(screens[i].name, ws);
        }

        this.connectWorkspace(workspace.windowAdded as QSignal<unknown[]>,
            (w) => this.onWindowAdded(w as KWinWindow));
        this.connectWorkspace(workspace.windowRemoved as QSignal<unknown[]>,
            (w) => this.onWindowRemoved(w as KWinWindow));
        this.connectWorkspace(workspace.windowActivated as QSignal<unknown[]>,
            (w) => this.onWindowActivated(w as KWinWindow | null));
        this.connectWorkspace(workspace.screensChanged as QSignal<unknown[]>,
            () => this.onScreensChanged());
        this.connectWorkspace(workspace.screenOrderChanged as QSignal<unknown[]>,
            () => this.retileAll());
        this.connectWorkspace(workspace.currentDesktopChanged as QSignal<unknown[]>,
            () => this.onCurrentDesktopChanged());
        this.connectWorkspace(workspace.cursorPosChanged as QSignal<unknown[]>,
            () => this.onCursorScreenChanged());

        // Tile existing windows.
        const existing = workspace.windowList();
        for (let i = 0; i < existing.length; i++) {
            if (WindowFilter.shouldTileNow(existing[i], this.floatingWindows)) {
                this.tileWindow(existing[i]);
            }
        }

        this.retileAll();

        const focused = workspace.activeWindow;
        if (focused) this.lastFocusedScreen = focused.output.name;

        // syncDesktop NOW (plasmashell is up -- we're just restarting aerogel,
        // or the first window appeared after startup finished).
        this.syncDesktopAndVisibility();

        console.log("[aerogel] initialised. tiled", this.totalWindowCount(),
                    "windows across", screens.length, "screens.");
    }

    destroy(): void {
        for (const c of this.workspaceConnections) c.signal.disconnect(c.handler);
        this.workspaceConnections.length = 0;
        for (const [, conns] of this.windowConnections) {
            for (const c of conns) {
                try { c.signal.disconnect(c.handler); } catch (_) { /**/ }
            }
        }
        this.windowConnections.clear();
        this.trees.clear();
        console.log("[aerogel] destroyed.");
    }

    // =========================================================================
    // Workspace-level signal handlers
    // =========================================================================

    private onWindowAdded(window: KWinWindow): void {
        try {
            if (!WindowFilter.shouldTileNow(window, this.floatingWindows)) {
                if (window.dock) this.retileAll();
                return;
            }
            this.tileWindow(window);
            this.retileWindowTree(window);
            this.syncDesktopAndVisibility();
        } catch (e) { console.error("[aerogel] onWindowAdded:", e); }
    }

    private onWindowRemoved(window: KWinWindow): void {
        try {
            this.untileWindow(window);
            this.syncDesktopAndVisibility();
        } catch (e) { console.error("[aerogel] onWindowRemoved:", e); }
    }

    private onWindowActivated(window: KWinWindow | null): void {
        try {
            if (!window) return;

            const ws = this.windowWorkspace(window);
            if (ws !== null) {
                this.lastFocused.set(ws, window.internalId);
                const tree = this.trees.get(ws);
                if (tree) tree.setFocused(window);
            }

            const screen = window.output.name;
            if (screen !== this.lastFocusedScreen) {
                this.lastFocusedScreen = screen;
                // Focus moved to a different monitor -- update currentDesktop
                // so the widget shows the right workspace.
                this.syncDesktopAndVisibility();
            }
        } catch (e) { console.error("[aerogel] onWindowActivated:", e); }
    }

    // =========================================================================
    // Per-window signal handlers
    // =========================================================================

    private onWindowMinimizedChanged(window: KWinWindow): void {
        try {
            if (window.minimized) {
                this.untileWindow(window);
            } else if (WindowFilter.shouldTileNow(window, this.floatingWindows)) {
                this.tileWindow(window);
                this.retileWindowTree(window);
                this.syncDesktopAndVisibility();
            }
        } catch (e) { console.error("[aerogel] onWindowMinimizedChanged:", e); }
    }

    private onWindowFullScreenChanged(window: KWinWindow): void {
        try {
            if (window.fullScreen) {
                this.untileWindow(window);
            } else if (WindowFilter.shouldTileNow(window, this.floatingWindows)) {
                this.tileWindow(window);
                this.retileWindowTree(window);
                this.syncDesktopAndVisibility();
            }
        } catch (e) { console.error("[aerogel] onWindowFullScreenChanged:", e); }
    }

    private onInteractiveMoveResizeFinished(window: KWinWindow): void {
        try {
            const ws = this.windowWorkspace(window);
            if (ws === null) return;
            const tree = this.trees.get(ws);
            if (!tree || tree.findLeaf(window) === null) return;
            const sr = this.screenRectForWorkspace(ws);
            if (sr) tree.adjustRatioAfterResize(window, sr);
            this.retileWorkspace(ws);
        } catch (e) { console.error("[aerogel] onInteractiveMoveResizeFinished:", e); }
    }

    private onWindowOutputChanged(window: KWinWindow): void {
        if (this.movingWindows) return;
        try {
            const newScreen = window.output.name;
            const newWs = this.monitorWorkspace.get(newScreen);
            if (newWs === undefined) return;
            this.untileWindowNoRetile(window);
            this.insertIntoWorkspace(window, newWs);
            this.retileAll();
            this.syncDesktopAndVisibility();
        } catch (e) { console.error("[aerogel] onWindowOutputChanged:", e); }
    }

    private onWindowDesktopsChanged(window: KWinWindow): void {
        if (this.movingWindows) return;
        // External desktop change -- re-apply our model.
        try { this.syncDesktopAndVisibility(); }
        catch (e) { console.error("[aerogel] onWindowDesktopsChanged:", e); }
    }

    private onFrameGeometryChanged(window: KWinWindow): void {
        try {
            if (window.fullScreen || window.minimized) return;
            const ws = this.windowWorkspace(window);
            if (ws === null) return;
            const tree = this.trees.get(ws);
            if (!tree) return;
            const leaf = tree.findLeaf(window);
            if (!leaf || leaf.settingGeometry) return;
            if (window.move || window.resize) return;
            const target = leaf.lastRect;
            if (!target) return;
            const sr = this.screenRectForWorkspace(ws);
            if (!sr) return;
            const a = window.frameGeometry;
            if (Math.round(a.x)     !== target.x     ||
                Math.round(a.y)     !== target.y     ||
                Math.round(a.width) !== target.width ||
                Math.round(a.height)!== target.height) {
                leaf.applyGeometry(target, sr);
            }
        } catch (e) { console.error("[aerogel] onFrameGeometryChanged:", e); }
    }

    /**
     * Fired when workspace.currentDesktop changes externally (e.g. from the
     * pager widget via D-Bus setCurrentDesktop).
     *
     * We treat this as a switchToDesktop(n) call: n is the 1-based index of
     * the newly active KWin desktop.  This keeps the aerogel model consistent
     * when the widget initiates a workspace switch.
     *
     * Skipped when movingWindows is true (we set currentDesktop ourselves).
     */
    private onCurrentDesktopChanged(): void {
        if (this.movingWindows) return;
        try {
            const desk = workspace.currentDesktop;
            const desks = workspace.desktops;
            let n = -1;
            for (let i = 0; i < desks.length; i++) {
                if (desks[i].id === desk.id) { n = i + 1; break; }
            }
            if (n < 1) return;

            // Check if this is already the focused workspace -- no-op.
            const focusedScreen = this.lastFocusedScreen || workspace.activeScreen.name;
            const currentWs = this.monitorWorkspace.get(focusedScreen);
            if (currentWs === n) return;

            // Check if n is already visible on some monitor -- if so, just
            // shift focus to that monitor rather than activating n on the
            // focused monitor.  This handles the widget pager case where the
            // widget calls setCurrentDesktop to a workspace that is already
            // displayed on another monitor.
            const hostScreen = this.activeScreenForWorkspace(n);
            if (hostScreen) {
                // Workspace N is already visible -- move focus there.
                this.focusScreen(hostScreen);
                return;
            }

            // Workspace N is dormant -- treat as a switchToDesktop request.
            this.switchToDesktop(n);
        } catch (e) { console.error("[aerogel] onCurrentDesktopChanged:", e); }
    }

    private onScreensChanged(): void {
        const screens = workspace.screenOrder;
        for (let i = 0; i < screens.length; i++) {
            if (!this.monitorWorkspace.has(screens[i].name)) {
                const ws = this.findNextFreeWorkspace();
                this.workspaceMonitor.set(ws, screens[i].name);
                this.monitorWorkspace.set(screens[i].name, ws);
            }
        }
        for (const [name] of this.monitorWorkspace) {
            let found = false;
            for (let i = 0; i < screens.length; i++) {
                if (screens[i].name === name) { found = true; break; }
            }
            if (!found) {
                const ws = this.monitorWorkspace.get(name)!;
                this.monitorWorkspace.delete(name);
                // workspaceMonitor[ws] keeps pointing to this screen as home.
            }
        }
        this.retileAll();
        this.syncDesktopAndVisibility();
    }

    /**
     * Called on every cursor position change.  Detects when the pointer
     * crosses into a different screen and updates lastFocusedScreen so the
     * widget reflects the correct workspace -- even with no windows open.
     *
     * This is intentionally cheap: we only act when the screen under the
     * cursor differs from the last known focused screen, and we skip it
     * entirely while windows are being moved (movingWindows guard) to avoid
     * interfering with bulk operations.
     */
    private onCursorScreenChanged(): void {
        if (this.movingWindows) return;

        const screen = workspace.activeScreen;
        if (!screen) return;
        const screenName = screen.name;

        // No change -- bail out immediately (this fires on every mouse move).
        if (screenName === this.lastFocusedScreen) return;

        // Only update if this screen is known to aerogel.
        const ws = this.monitorWorkspace.get(screenName);
        if (ws === undefined) return;

        this.lastFocusedScreen = screenName;

        // Ensure the KWin desktop for this workspace exists before syncing.
        // On fresh boot with no windows, desktops beyond #1 may not have been
        // created yet, causing desktopForWorkspace() to return null and the
        // widget to show nothing.
        this.ensureDesktops(ws);
        this.syncDesktopAndVisibility();
    }

    // =========================================================================
    // Public shortcut actions
    // =========================================================================

    /**
     * Focus workspace N (Meta+1…9,0).
     * AeroSpace semantics:
     *   • N is active on some monitor → focus that monitor (no move).
     *   • N is dormant with assigned monitor → activate on that monitor.
     *   • N is unknown → assign to focused monitor and activate.
     */
    switchToDesktop(n: number): void {
        try {
            // Ensure the KWin desktop for workspace N exists before any sync,
            // so that ensureDesktops' createDesktop() signals settle before
            // we set currentDesktop in syncDesktopAndVisibility.
            this.ensureDesktops(n);

            // Already active on some screen?
            const host = this.activeScreenForWorkspace(n);
            if (host) {
                this.focusScreen(host);
                return;
            }
            // Dormant or unknown -- decide which screen to show it on.
            //
            // Rules (in priority order):
            //  1. If the workspace has windows and is assigned to a screen that
            //     is currently active, restore it there (home-screen semantics).
            //  2. Otherwise (unassigned, or assigned but empty) show it on the
            //     focused monitor -- empty workspaces have no home worth honouring.
            const assignedScreen = this.workspaceMonitor.get(n);
            const wsTree = this.trees.get(n);
            const wsHasWindows = wsTree !== undefined && !wsTree.isEmpty();
            const targetScreen = (wsHasWindows && assignedScreen && this.monitorWorkspace.has(assignedScreen))
                ? assignedScreen
                : (this.lastFocusedScreen || workspace.activeScreen.name);
            this.activateWorkspaceOnScreen(n, targetScreen);
            this.focusScreen(targetScreen);
        } catch (e) { console.error("[aerogel] switchToDesktop:", e); }
    }

    /**
     * Move focused window to workspace N (Meta+Shift+1…9,0).
     */
    moveWindowToDesktop(n: number): void {
        try {
            const active = workspace.activeWindow;
            if (!active) return;
            const srcWs = this.windowWorkspace(active);
            if (srcWs === n) return;

            // Ensure KWin desktop N exists before any sync (same race avoidance
            // as in switchToDesktop).
            this.ensureDesktops(n);

            this.movingWindows = true;
            try {
                this.untileWindowNoRetile(active);

                if (!this.workspaceMonitor.has(n)) {
                    const screen = this.lastFocusedScreen || workspace.activeScreen.name;
                    this.workspaceMonitor.set(n, screen);
                }

                const targetScreen = this.activeScreenForWorkspace(n);
                if (targetScreen) {
                    const scr = this.findScreenByName(targetScreen);
                    if (scr) workspace.sendClientToScreen(active, scr);
                }

                this.insertIntoWorkspace(active, n);

                if (srcWs !== null) this.retileWorkspace(srcWs);
                this.retileWorkspace(n);

                // If the window moved to an active workspace on another monitor,
                // update lastFocusedScreen to that monitor so syncDesktopAndVisibility
                // sets currentDesktop correctly and the widget shows the right number.
                if (targetScreen !== null && targetScreen !== this.lastFocusedScreen) {
                    this.lastFocusedScreen = targetScreen;
                }

                this.syncDesktopAndVisibility();
            } finally {
                this.movingWindows = false;
            }
        } catch (e) { console.error("[aerogel] moveWindowToDesktop:", e); }
    }

    /**
     * Move the focused workspace (with its windows) to the next monitor
     * (Meta+Shift+Tab).
     *
     * Semantics:
     *   1. The focused workspace, including all its windows, moves to the next
     *      monitor.  The moved workspace becomes that monitor's active workspace.
     *   2. Focus follows the workspace to the next monitor.
     *   3. The previously focused monitor needs a replacement workspace:
     *        a. Pop the most recently active workspace from that monitor's
     *           history that is still dormant (not active anywhere).
     *        b. If no history entry qualifies, create a brand-new empty workspace
     *           (lowest unused workspace number).
     *
     * This preserves an AeroSpace-style model where monitors accumulate
     * independent workspace histories.
     */
    moveWorkspaceToNextMonitor(): void {
        try {
            const screens = workspace.screenOrder;
            if (screens.length < 2) return;

            const focused = this.lastFocusedScreen || workspace.activeScreen.name;
            let idx = -1;
            for (let i = 0; i < screens.length; i++) {
                if (screens[i].name === focused) { idx = i; break; }
            }
            if (idx < 0) return;

            const nextScreenName   = screens[(idx + 1) % screens.length].name;
            const focusedWs        = this.monitorWorkspace.get(focused);
            if (focusedWs === undefined) return;

            const nextScreenObj = this.findScreenByName(nextScreenName);
            if (!nextScreenObj) return;

            // ── 1. Move focusedWs windows to the next monitor ─────────────────
            this.movingWindows = true;
            try {
                const focusedTree = this.trees.get(focusedWs);
                if (focusedTree && !focusedTree.isEmpty()) {
                    for (const leaf of focusedTree.leaves()) {
                        workspace.sendClientToScreen(leaf.window, nextScreenObj);
                    }
                }

                // ── History bookkeeping (must happen before map updates) ────────
                //
                // (a) The WS currently active on nextScreen is being displaced.
                //     Only record it in nextScreen's history if it is actually
                //     homed on nextScreen (workspaceMonitor[displacedWs] === nextScreen).
                //     If it's a visitor (homed elsewhere after a previous MST), do NOT
                //     push it -- it belongs to its real home screen's history, not here.
                //     If the displaced WS is empty, prune it so the number is reused.
                const displacedWs = this.monitorWorkspace.get(nextScreenName);
                if (displacedWs !== undefined) {
                    if (this.workspaceMonitor.get(displacedWs) === nextScreenName) {
                        this.pushMonitorHistory(nextScreenName, displacedWs);
                    }
                    this.pruneEmptyWorkspace(displacedWs);
                }

                // (b) focusedWs is leaving the focused screen.  Only record it in
                //     the focused screen's history if it is actually homed there
                //     (workspaceMonitor[focusedWs] === focused).  If it is a visitor
                //     that arrived from another monitor via a previous MST, do NOT
                //     push it -- it belongs to its real home's history, not here.
                if (this.workspaceMonitor.get(focusedWs) === focused) {
                    this.pushMonitorHistory(focused, focusedWs);
                }

                // ── Update maps ────────────────────────────────────────────────
                // focusedWs is now the active workspace on nextScreen.
                this.workspaceMonitor.set(focusedWs, nextScreenName);
                this.monitorWorkspace.set(nextScreenName, focusedWs);

                // ── 2. Find a replacement workspace for the focused monitor ────
                // Pop the most recent still-dormant non-empty WS from the focused
                // monitor's history (excluding the WS we just moved away).
                const replacement = this.popMonitorHistory(focused, focusedWs);

                this.workspaceMonitor.set(replacement, focused);
                this.monitorWorkspace.set(focused, replacement);
                this.ensureDesktops(replacement);

                // Retile and sync while movingWindows is still true so that any
                // outputChanged signals queued by sendClientToScreen are suppressed
                // until after the layout is correct.
                this.retileAll();
                this.syncDesktopAndVisibility();
            } finally {
                this.movingWindows = false;
            }

            // Focus follows the moved workspace to the next monitor.
            this.focusScreen(nextScreenName);
        } catch (e) { console.error("[aerogel] moveWorkspaceToNextMonitor:", e); }
    }

    /**
     * Push `ws` onto the per-monitor history stack for `screenName`.
     * Only non-empty workspaces (those with at least one tiled window) are
     * recorded -- empty workspaces are never stored so they cannot pollute
     * the history used by moveWorkspaceToNextMonitor().
     * Deduplicates: if `ws` is already in the stack it is moved to the top.
     * The stack is capped at 20 entries to avoid unbounded growth.
     */
    private pushMonitorHistory(screenName: string, ws: number): void {
        // Skip empty workspaces -- they have no meaningful history to restore.
        const tree = this.trees.get(ws);
        if (!tree || tree.isEmpty()) return;

        let stack = this.monitorWsHistory.get(screenName);
        if (!stack) { stack = []; this.monitorWsHistory.set(screenName, stack); }
        // Remove existing occurrence so the entry lands at the top.
        const existing = stack.indexOf(ws);
        if (existing !== -1) stack.splice(existing, 1);
        stack.push(ws);
        if (stack.length > 20) stack.splice(0, stack.length - 20);
    }

    /**
     * Pop the most recently active non-empty workspace from the history of
     * `screenName` that is currently dormant (not the active workspace on any
     * monitor) and is not `excludeWs`.
     *
     * If no qualifying history entry exists, returns a brand-new workspace
     * number (lowest number not yet known to aerogel at all).  Never returns
     * an existing empty workspace -- the caller always gets either a workspace
     * with windows or a fresh slot.
     */
    private popMonitorHistory(screenName: string, excludeWs: number): number {
        // Collect workspaces that are currently active on some monitor.
        const activeWs = new Set<number>();
        for (const [, ws] of this.monitorWorkspace) activeWs.add(ws);

        const stack = this.monitorWsHistory.get(screenName);
        if (stack) {
            // Walk from most recent (end) to oldest (start).
            for (let i = stack.length - 1; i >= 0; i--) {
                const candidate = stack[i];
                if (candidate === excludeWs || activeWs.has(candidate)) continue;
                // Only restore workspaces still homed on this screen.
                // A stale entry exists when a WS was once active here but has
                // since been re-homed to another monitor via MST.  Pulling it
                // back would cause a swap instead of a move.
                if (this.workspaceMonitor.get(candidate) !== screenName) {
                    stack.splice(i, 1); // prune stale entry
                    continue;
                }
                // Only restore if it still has windows (guard against a workspace
                // that became empty after being pushed to history).
                const tree = this.trees.get(candidate);
                if (!tree || tree.isEmpty()) {
                    stack.splice(i, 1); // prune stale entry
                    continue;
                }
                stack.splice(i, 1);
                return candidate;
            }
        }

        // No usable history -- before allocating a brand-new number, scan known
        // workspaces whose home is THIS screen for any that are dormant and
        // non-empty.  This catches the case where a workspace (e.g. WS1) exists
        // and belongs here but was never pushed to history (e.g. initial state).
        // We must restrict to workspaces homed on screenName -- otherwise we'd
        // poach workspaces that belong to other monitors (causing a swap, not a
        // move).
        for (const [ws, home] of this.workspaceMonitor) {
            if (home !== screenName) continue;
            if (ws === excludeWs || activeWs.has(ws)) continue;
            const tree = this.trees.get(ws);
            if (tree && !tree.isEmpty()) return ws;
        }

        // Truly no usable workspace -- allocate a brand-new number.
        // Only skip numbers that are already known to aerogel so we don't
        // clobber any existing workspace.
        let n = 1;
        while (this.workspaceMonitor.has(n) || activeWs.has(n)) n++;
        return n;
    }

    /**
     * If workspace `ws` is empty (no tree or empty tree) remove it from
     * `workspaceMonitor` entirely so its number can be reused.  Only call
     * this when `ws` is no longer the active workspace on any monitor.
     */
    private pruneEmptyWorkspace(ws: number): void {
        const tree = this.trees.get(ws);
        if (!tree || tree.isEmpty()) {
            this.workspaceMonitor.delete(ws);
        }
    }

    focusDirection(dir: Direction): void {
        try {
            const active = workspace.activeWindow;
            if (!active) return;
            const ws = this.windowWorkspace(active);
            if (ws === null) return;
            const tree = this.trees.get(ws);
            if (!tree) return;
            const nb = tree.findNeighbor(active, dir);
            if (nb) workspace.activeWindow = nb.window;
        } catch (e) { console.error("[aerogel] focusDirection:", e); }
    }

    swapDirection(dir: Direction): void {
        try {
            const active = workspace.activeWindow;
            if (!active) return;
            const ws = this.windowWorkspace(active);
            if (ws === null) return;
            const tree = this.trees.get(ws);
            if (!tree) return;
            const nb = tree.findNeighbor(active, dir);
            if (nb) {
                tree.swap(active, nb.window);
                this.retileWorkspace(ws);
                workspace.activeWindow = active;
            }
        } catch (e) { console.error("[aerogel] swapDirection:", e); }
    }

    toggleFloat(): void {
        try {
            const active = workspace.activeWindow;
            if (!active || !WindowFilter.isTileable(active)) return;
            const id = active.internalId;
            if (this.floatingWindows.has(id)) {
                this.floatingWindows.delete(id);
                active.keepAbove = false;
                if (!active.minimized && !active.fullScreen) {
                    this.tileWindow(active);
                    this.retileWindowTree(active);
                    this.syncDesktopAndVisibility();
                }
            } else {
                this.floatingWindows.add(id);
                this.untileWindow(active);
                active.keepAbove = true;
                const ws = this.monitorWorkspace.get(active.output.name);
                const scr = this.findScreenByName(active.output.name);
                if (scr && ws !== undefined) {
                    const desk = this.desktopForWorkspace(ws);
                    if (desk) {
                        const sr = workspace.clientArea(ClientAreaOption.MaximizeArea, scr, desk);
                        const g  = active.frameGeometry;
                        active.frameGeometry = {
                            x: sr.x + Math.round((sr.width  - g.width)  / 2),
                            y: sr.y + Math.round((sr.height - g.height) / 2),
                            width: g.width, height: g.height,
                        };
                    }
                }
                this.syncDesktopAndVisibility();
            }
        } catch (e) { console.error("[aerogel] toggleFloat:", e); }
    }

    toggleFullscreen(): void {
        try {
            const a = workspace.activeWindow;
            if (a) a.fullScreen = !a.fullScreen;
        } catch (e) { console.error("[aerogel] toggleFullscreen:", e); }
    }

    closeWindow(): void {
        try {
            const a = workspace.activeWindow;
            if (a) a.closeWindow();
        } catch (e) { console.error("[aerogel] closeWindow:", e); }
    }

    resizeSmart(delta: number): void {
        try {
            const active = workspace.activeWindow;
            if (!active) return;
            const ws = this.windowWorkspace(active);
            if (ws === null) return;
            const tree = this.trees.get(ws);
            if (!tree) return;
            const leaf = tree.findLeaf(active);
            if (!leaf || !leaf.parent) return;
            const parent = leaf.parent;
            const sr = this.screenRectForWorkspace(ws);
            if (!sr) return;
            const total = parent.orientation === Orientation.Horizontal ? sr.width : sr.height;
            if (total <= 0) return;
            const sign = (parent.first === leaf) ? 1 : -1;
            parent.firstRatio = Math.max(0.1, Math.min(0.9,
                parent.firstRatio + sign * delta / total));
            this.retileWorkspace(ws);
        } catch (e) { console.error("[aerogel] resizeSmart:", e); }
    }

    // =========================================================================
    // Workspace activation
    // =========================================================================

    /**
     * Make workspace `wsNum` visible on `screenName`.
     * Hides the screen's current workspace first.
     */
    private activateWorkspaceOnScreen(wsNum: number, screenName: string): void {
        const screen = this.findScreenByName(screenName);
        if (!screen) return;

        this.movingWindows = true;
        try {
            // Hide old workspace on this screen.
            const oldWs = this.monitorWorkspace.get(screenName);
            if (oldWs !== undefined && oldWs !== wsNum) {
                this.monitorWorkspace.delete(screenName);
                // workspaceMonitor[oldWs] keeps pointing here as its home.
                // Record in per-monitor history so moveWorkspaceToNextMonitor()
                // can restore the last-used workspace on this monitor.
                this.pushMonitorHistory(screenName, oldWs);
            }

            // Move workspace's windows to this screen.
            const tree = this.trees.get(wsNum);
            if (tree && !tree.isEmpty()) {
                const leaves = tree.leaves();
                for (const leaf of leaves) {
                    workspace.sendClientToScreen(leaf.window, screen);
                }
            }

            // Update maps.
            this.workspaceMonitor.set(wsNum, screenName);
            this.monitorWorkspace.set(screenName, wsNum);

            this.syncDesktopAndVisibility();
            this.retileWorkspace(wsNum);
        } finally {
            this.movingWindows = false;
        }
    }

    // =========================================================================
    // Desktop + visibility sync  (the heart of the model)
    // =========================================================================

    /**
     * Synchronise KWin virtual desktops and window desktop assignments so:
     *
     *  1. workspace.currentDesktop = focused monitor's active workspace's KWin desktop
     *     → widget reads this to show the right number
     *
     *  2. Focused monitor's windows  → desktops = [their real desktop]
     *     (matches currentDesktop → KWin renders them)
     *
     *  3. Unfocused monitors' active windows → desktops = []
     *     (all-desktops flag → KWin always renders them regardless of currentDesktop)
     *
     *  4. Dormant workspace windows → desktops = [their real desktop]
     *     (real desktop ≠ currentDesktop → KWin hides them)
     *
     * Must be called after any workspace switch, focus change, or window move.
     * Safe to call at any time AFTER init() -- never called during init() to
     * avoid triggering the plasmashell lastScreen() crash.
     */
    private syncDesktopAndVisibility(): void {
        const focusedScreen = this.lastFocusedScreen || workspace.activeScreen.name;
        const focusedWs     = this.monitorWorkspace.get(focusedScreen);
        if (focusedWs === undefined) return;

        // Guard: preserve the caller's movingWindows state.
        const wasMoving = this.movingWindows;
        this.movingWindows = true;
        try {
            const focusedDesk = this.desktopForWorkspace(focusedWs);

            // 1. Un-pin all previously pinned windows, restoring their real desktop.
            if (this.pinnedWindows.size > 0) {
                for (const [ws, tree] of this.trees) {
                    const desk = this.desktopForWorkspace(ws);
                    if (!desk) continue;
                    const leaves = tree.leaves();
                    for (const leaf of leaves) {
                        if (this.pinnedWindows.has(leaf.window.internalId)) {
                            leaf.window.desktops = [desk];
                        }
                    }
                }
                this.pinnedWindows.clear();
            }

            // 2. Assign every tiled window its correct desktop.
            for (const [ws, tree] of this.trees) {
                const desk = this.desktopForWorkspace(ws);
                if (!desk) continue;
                const screenForWs = this.activeScreenForWorkspace(ws);
                const isActive    = screenForWs !== null;
                const isFocused   = screenForWs === focusedScreen;

                const leaves = tree.leaves();
                for (const leaf of leaves) {
                    if (isActive && !isFocused) {
                        // Unfocused but visible → pin (all desktops).
                        leaf.window.desktops = [];
                        this.pinnedWindows.add(leaf.window.internalId);
                    } else {
                        // Focused or dormant → assign real desktop.
                        leaf.window.desktops = [desk];
                    }
                }
            }

            // 3. Set currentDesktop LAST -- after all window desktop assignments --
            // so any KWin-internal currentDesktop reset triggered by step 2
            // (e.g. KWin following a window's desktop) is overridden by our value.
            // NOTE: ensureDesktops() is intentionally NOT called here to avoid
            // the createDesktop() signal race. Callers call ensureDesktops() first.
            if (focusedDesk && workspace.currentDesktop.id !== focusedDesk.id) {
                workspace.currentDesktop = focusedDesk;
            }
        } finally {
            this.movingWindows = wasMoving;
        }
    }

    // =========================================================================
    // Tiling primitives
    // =========================================================================

    private tileWindow(window: KWinWindow): void {
        const screenName = window.output.name;
        let ws = this.monitorWorkspace.get(screenName);
        if (ws === undefined) {
            ws = this.findNextFreeWorkspace();
            this.workspaceMonitor.set(ws, screenName);
            this.monitorWorkspace.set(screenName, ws);
        }
        this.insertIntoWorkspace(window, ws);
    }

    private insertIntoWorkspace(window: KWinWindow, ws: number): void {
        let tree = this.trees.get(ws);
        if (!tree) { tree = new Tree(); this.trees.set(ws, tree); }
        if (tree.findLeaf(window) !== null) return;
        tree.insert(window);
        if (!this.windowConnections.has(window.internalId)) {
            this.subscribeWindowSignals(window);
        }
    }

    private untileWindow(window: KWinWindow): void {
        const affected = this.untileWindowNoRetile(window);
        for (const ws of affected) {
            const tree = this.trees.get(ws);
            if (tree) this.retileWorkspace(ws);
        }
        this.unsubscribeWindowSignals(window);
    }

    private untileWindowNoRetile(window: KWinWindow): number[] {
        const affected: number[] = [];
        for (const [ws, tree] of this.trees) {
            if (tree.findLeaf(window) !== null) {
                tree.remove(window);
                affected.push(ws);
            }
        }
        return affected;
    }

    // =========================================================================
    // Layout
    // =========================================================================

    private retileAll(): void {
        for (const [ws] of this.trees) this.retileWorkspace(ws);
    }

    private retileWindowTree(window: KWinWindow): void {
        const ws = this.windowWorkspace(window);
        if (ws !== null) this.retileWorkspace(ws);
    }

    private retileWorkspace(ws: number): void {
        const tree = this.trees.get(ws);
        if (!tree || tree.isEmpty()) return;
        const sr = this.screenRectForWorkspace(ws);
        if (!sr) return;
        const root = tree.getRoot();
        if (!root) return;
        BSPLayout.apply(root, sr, this.gaps);
    }

    private screenRectForWorkspace(ws: number): QRect | null {
        const screenName = this.activeScreenForWorkspace(ws);
        if (!screenName) return null;
        const screen = this.findScreenByName(screenName);
        if (!screen) return null;
        // ensureDesktops is safe here -- called after plasmashell is up.
        this.ensureDesktops(ws);
        const desk = this.desktopForWorkspace(ws);
        if (!desk) return null;
        return workspace.clientArea(ClientAreaOption.MaximizeArea, screen, desk);
    }

    // =========================================================================
    // Focus helpers
    // =========================================================================

    private focusScreen(screenName: string): void {
        const ws = this.monitorWorkspace.get(screenName);
        if (ws === undefined) return;

        // Warp the cursor to the centre of the target screen when crossing
        // monitor boundaries.  This is required on Wayland because
        // workspace.activeScreen tracks the screen under the pointer -- without
        // a warp the pointer stays on the old monitor even after focus moves,
        // so the app launcher (Meta key) and other pointer-screen logic open
        // on the wrong monitor.
        //
        // The warp is performed via the aerogel-cursor D-Bus service
        // (org.aerogel.Cursor / Warp), which delegates to ydotool(1).
        // ydotool is an optional runtime dependency: if the service is not
        // running the callDBus is a silent no-op.
        if (screenName !== workspace.activeScreen.name) {
            const screen = this.findScreenByName(screenName);
            if (screen) {
                const desk = this.desktopForWorkspace(ws);
                if (desk) {
                    const rect = workspace.clientArea(
                        ClientAreaOption.MaximizeArea, screen, desk
                    );
                    const cx = Math.round(rect.x + rect.width  / 2);
                    const cy = Math.round(rect.y + rect.height / 2);
                    callDBus(
                        "org.aerogel.Cursor",
                        "/org/aerogel/Cursor",
                        "org.aerogel.Cursor",
                        "Warp",
                        cx, cy
                    );
                }
            }
        }

        // Always update lastFocusedScreen -- even if the workspace is empty,
        // focus has conceptually moved to this monitor. This ensures
        // syncDesktopAndVisibility shows the correct workspace in the widget.
        this.lastFocusedScreen = screenName;
        this.syncDesktopAndVisibility();

        const lastId = this.lastFocused.get(ws);
        if (lastId) {
            const all = workspace.windowList();
            for (let i = 0; i < all.length; i++) {
                if (all[i].internalId === lastId) {
                    workspace.activeWindow = all[i];
                    return;
                }
            }
        }
        const tree = this.trees.get(ws);
        if (tree && !tree.isEmpty()) {
            const leaves = tree.leaves();
            if (leaves.length > 0) workspace.activeWindow = leaves[0].window;
        }
    }

    // =========================================================================
    // Lookup helpers
    // =========================================================================

    private windowWorkspace(window: KWinWindow): number | null {
        for (const [ws, tree] of this.trees) {
            if (tree.findLeaf(window) !== null) return ws;
        }
        return null;
    }

    /**
     * If workspace N is currently the active workspace on some monitor,
     * return that monitor's name.  Otherwise null.
     */
    private activeScreenForWorkspace(ws: number): string | null {
        const home = this.workspaceMonitor.get(ws);
        if (!home) return null;
        return this.monitorWorkspace.get(home) === ws ? home : null;
    }

    private findNextFreeWorkspace(): number {
        let n = 1;
        while (this.workspaceMonitor.has(n)) n++;
        return n;
    }

    private maxKnownWorkspace(): number {
        let max = 0;
        for (const [ws] of this.workspaceMonitor) if (ws > max) max = ws;
        return max || 1;
    }

    private findScreenByName(name: string): KWinOutput | null {
        const screens = workspace.screenOrder;
        for (let i = 0; i < screens.length; i++) {
            if (screens[i].name === name) return screens[i];
        }
        return null;
    }

    // =========================================================================
    // KWin desktop helpers
    // =========================================================================

    /**
     * Ensure KWin has at least `n` virtual desktops.
     * Only called after init() finishes (safe -- plasmashell is up).
     */
    private ensureDesktops(n: number): void {
        const MAX = 25;
        const target = Math.min(n, MAX);
        while (workspace.desktops.length < target) {
            workspace.createDesktop(workspace.desktops.length,
                "Desktop " + (workspace.desktops.length + 1));
        }
    }

    /** KWin desktop for workspace N (0-indexed array → ws is 1-based). */
    private desktopForWorkspace(ws: number): KWinVirtualDesktop | null {
        return workspace.desktops[ws - 1] ?? null;
    }

    // =========================================================================
    // Signal subscription
    // =========================================================================

    private subscribeWindowSignals(window: KWinWindow): void {
        const conns: WindowConnection[] = [];
        const on = (sig: QSignal<[]>, fn: () => void) => {
            sig.connect(fn); conns.push({ signal: sig, handler: fn });
        };
        on(window.minimizedChanged,               () => this.onWindowMinimizedChanged(window));
        on(window.fullScreenChanged,              () => this.onWindowFullScreenChanged(window));
        on(window.interactiveMoveResizeFinished,  () => this.onInteractiveMoveResizeFinished(window));
        on(window.desktopsChanged,                () => this.onWindowDesktopsChanged(window));
        on(window.outputChanged,                  () => this.onWindowOutputChanged(window));
        on(window.frameGeometryChanged as QSignal<[]>, () => this.onFrameGeometryChanged(window));
        this.windowConnections.set(window.internalId, conns);
    }

    private unsubscribeWindowSignals(window: KWinWindow): void {
        const conns = this.windowConnections.get(window.internalId);
        if (!conns) return;
        for (const c of conns) {
            try { c.signal.disconnect(c.handler); } catch (_) { /**/ }
        }
        this.windowConnections.delete(window.internalId);
    }

    private connectWorkspace(
        signal: QSignal<unknown[]>,
        handler: (...args: unknown[]) => void,
    ): void {
        signal.connect(handler);
        this.workspaceConnections.push({ signal, handler });
    }

    // =========================================================================
    // Diagnostics
    // =========================================================================

    private totalWindowCount(): number {
        let n = 0;
        for (const [, t] of this.trees) n += t.leaves().length;
        return n;
    }
}
