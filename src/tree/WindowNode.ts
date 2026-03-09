/// <reference path="Node.ts" />

/**
 * WindowNode.ts -- Leaf node in the BSP tree.
 *
 * Each WindowNode wraps exactly one KWin window. During layout, BSPLayout
 * assigns a QRect to `lastRect` and then calls `applyGeometry()` to push the
 * rect to KWin.
 */

class WindowNode extends Node {
    public readonly window: KWinWindow;

    /**
     * The rect most recently calculated by BSPLayout for this node.
     * Stored so we can reuse it after manual resize adjustments.
     */
    public lastRect: QRect | null = null;

    /**
     * True while we are programmatically setting frameGeometry, so the
     * frameGeometryChanged handler can ignore the event.
     */
    public settingGeometry: boolean = false;

    constructor(window: KWinWindow) {
        super();
        this.window = window;
    }

    isContainer(): this is Container { return false; }
    isWindowNode(): this is WindowNode { return true; }

    public leaves(): WindowNode[] {
        return [this];
    }

    public findWindow(target: KWinWindow): WindowNode | null {
        return this.window === target ? this : null;
    }

    /**
     * Apply a calculated rect to the underlying KWin window.
     *
     * Clamps width/height to the window's minSize, then clamps the window's
     * position so it cannot escape the hard screen boundary (`screenRect`).
     * In the degenerate case where minSize > screenRect size, the window is
     * pinned to the screen origin and may overlap siblings -- this is
     * preferable to bleeding into an adjacent monitor.
     *
     * @param rect        The desired geometry (already minSize-adjusted by BSPLayout).
     * @param screenRect  The hard screen boundary; window position is clamped to this.
     */
    public applyGeometry(rect: QRect, screenRect: QRect): void {
        const minW = Math.ceil(this.window.minSize.width);
        const minH = Math.ceil(this.window.minSize.height);

        let x = Math.round(rect.x);
        let y = Math.round(rect.y);
        let w = Math.max(minW, Math.round(rect.width));
        let h = Math.max(minH, Math.round(rect.height));

        // Clamp position so the window's right/bottom edge stays within the
        // screen boundary.  BSPLayout already adjusts the split ratio to give
        // each child its minSize, but this is the last-resort guard.
        const screenRight  = Math.round(screenRect.x + screenRect.width);
        const screenBottom = Math.round(screenRect.y + screenRect.height);
        x = Math.min(x, screenRight  - w);
        y = Math.min(y, screenBottom - h);
        // Never push the window before the screen origin.
        x = Math.max(x, Math.round(screenRect.x));
        y = Math.max(y, Math.round(screenRect.y));

        this.settingGeometry = true;
        try {
            // Un-maximize the window so frameGeometry can be set.
            // On Wayland, KWin ignores frameGeometry writes on maximized windows.
            this.window.setMaximize(false, false);

            const target: QRect = { x, y, width: w, height: h } as QRect;
            this.window.frameGeometry = target;

            this.lastRect = { x, y, width: w, height: h } as QRect;
        } finally {
            this.settingGeometry = false;
        }
    }
}
