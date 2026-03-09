/// <reference path="../config/Config.ts" />
/// <reference path="GapConfig.ts" />
/// <reference path="../tree/Node.ts" />
/// <reference path="../tree/Container.ts" />
/// <reference path="../tree/WindowNode.ts" />

/**
 * BSPLayout.ts -- Recursive BSP layout calculator.
 *
 * Given a root rect (from workspace.clientArea) and the root node of a BSP
 * tree, this module recursively subdivides the rect according to each
 * Container's orientation and firstRatio, applying gap corrections at each
 * level, and finally calls WindowNode.applyGeometry() on every leaf.
 *
 * Gap model
 * ─────────
 * outerGap : pixels between screen edge and any outermost window face.
 * innerGap : pixels between two sibling windows where they touch.
 *
 * At each binary split, the gap between the two halves is `innerGap`:
 *   ┌──────────┬──────────┐
 *   │  first   │  second  │   ← horizontal split
 *   │          │          │     innerGap between the two
 *   └──────────┴──────────┘
 *
 * Half of innerGap (⌊innerGap/2⌋) is trimmed from the near face of each
 * child, giving a total gap of innerGap between any pair of adjacent windows.
 * This approach keeps gaps consistent regardless of nesting depth.
 *
 * The outerGap is applied once to the root rect before any recursion begins,
 * so every leaf is at least outerGap pixels from the screen edge.
 */

/**
 * Create a QRect-compatible plain object without relying on Qt.rect().
 * Qt.rect() is only available when a QML host is present; in plain-script
 * mode it throws "ReferenceError: Qt is not defined".  KWin's C++ binding
 * accepts any JS object whose x/y/width/height properties are numbers.
 */
function mkRect(x: number, y: number, width: number, height: number): QRect {
    return { x, y, width, height } as QRect;
}

namespace BSPLayout {
    /**
     * Run a full layout pass for the given tree root and screen area.
     *
     * @param root      The root node of the BSP tree (Container or WindowNode).
     * @param screenRect  The usable screen area (from workspace.clientArea).
     * @param gaps      Gap configuration.
     */
    export function apply(root: Node, screenRect: QRect, gaps: GapConfig): void {
        // Shrink the root rect by outerGap on all four sides.
        const outerRect = mkRect(
            Math.round(screenRect.x + gaps.outerGap),
            Math.round(screenRect.y + gaps.outerGap),
            Math.round(screenRect.width  - gaps.outerGap * 2),
            Math.round(screenRect.height - gaps.outerGap * 2),
        );

        layoutNode(root, outerRect, gaps, screenRect);
    }

    /**
     * Recursively lay out a node within `rect`.
     *
     * @param screenRect  The hard screen boundary -- no window may escape it.
     */
    function layoutNode(node: Node, rect: QRect, gaps: GapConfig, screenRect: QRect): void {
        if (node.isWindowNode()) {
            node.applyGeometry(rect, screenRect);
            return;
        }

        // node is a Container.
        const container = node as Container;

        // Collect the minimum sizes needed by each subtree so that splitRect
        // can adjust the ratio before any window is placed.
        const firstMin  = subtreeMinSize(container.first,  container.orientation, gaps);
        const secondMin = subtreeMinSize(container.second, container.orientation, gaps);

        const [firstRect, secondRect] = splitRect(
            rect, container.orientation, container.firstRatio, gaps, firstMin, secondMin,
        );
        layoutNode(container.first,  firstRect,  gaps, screenRect);
        layoutNode(container.second, secondRect, gaps, screenRect);
    }

    /**
     * Return the minimum size (width for H-split, height for V-split) needed
     * by an entire subtree along the split axis, accounting for inner gaps.
     *
     * For a leaf this is simply the window's minSize on the relevant axis.
     * For a Container we recurse and add the inner gap.
     */
    function subtreeMinSize(node: Node, axis: Orientation, gaps: GapConfig): number {
        if (node.isWindowNode()) {
            return axis === Orientation.Horizontal
                ? Math.ceil(node.window.minSize.width)
                : Math.ceil(node.window.minSize.height);
        }

        const c = node as Container;
        if (c.orientation === axis) {
            // Same axis: the two children sit side-by-side; add their mins + the gap.
            return subtreeMinSize(c.first, axis, gaps)
                 + gaps.innerGap
                 + subtreeMinSize(c.second, axis, gaps);
        } else {
            // Perpendicular axis: children share the full extent; take the larger min.
            return Math.max(
                subtreeMinSize(c.first,  axis, gaps),
                subtreeMinSize(c.second, axis, gaps),
            );
        }
    }

    /**
     * Split `rect` into two sub-rects according to `orientation` and `ratio`.
     *
     * `minFirst` / `minSecond` are the minimum pixel extents needed along the
     * split axis by each subtree.  The ratio is adjusted so that:
     *   1. first  child gets at least minFirst  pixels (if possible).
     *   2. second child gets at least minSecond pixels (if possible).
     *   3. If both can't fit, first child wins its minimum and second gets
     *      whatever remains (may be less than its minimum -- overlap rather
     *      than bleed into another screen).
     *
     * innerGap is accounted for by trimming half the gap from the near face
     * of each child.
     *
     * @returns [firstRect, secondRect]
     */
    function splitRect(
        rect: QRect,
        orientation: Orientation,
        ratio: number,
        gaps: GapConfig,
        minFirst: number,
        minSecond: number,
    ): [QRect, QRect] {
        const half = gaps.halfInner;        // pixels trimmed from each near face
        const full = gaps.innerGap;         // total gap between siblings

        if (orientation === Orientation.Horizontal) {
            const totalWidth = rect.width;

            // Clamp the split so each child gets at least its minimum width.
            // Available pixels after reserving the inner gap:
            const available = totalWidth - full;
            let firstWidth = Math.round(totalWidth * ratio);
            // Ensure first child gets at least minFirst (but not more than what leaves minSecond).
            firstWidth = Math.max(firstWidth, minFirst + half);
            firstWidth = Math.min(firstWidth, available - minSecond + half);
            // If even minFirst alone exceeds available, let first child have it all.
            firstWidth = Math.max(firstWidth, minFirst + half);
            firstWidth = Math.round(firstWidth);
            const secondWidth = totalWidth - firstWidth;

            const firstRect = mkRect(
                rect.x,
                rect.y,
                firstWidth  - half,           // trim right edge of first child
                rect.height,
            );
            const secondRect = mkRect(
                rect.x + firstWidth + (full - half),  // skip the gap
                rect.y,
                secondWidth - (full - half),           // trim left edge of second child
                rect.height,
            );
            return [firstRect, secondRect];
        } else {
            const totalHeight = rect.height;

            const available = totalHeight - full;
            let firstHeight = Math.round(totalHeight * ratio);
            firstHeight = Math.max(firstHeight, minFirst + half);
            firstHeight = Math.min(firstHeight, available - minSecond + half);
            firstHeight = Math.max(firstHeight, minFirst + half);
            firstHeight = Math.round(firstHeight);
            const secondHeight = totalHeight - firstHeight;

            const firstRect = mkRect(
                rect.x,
                rect.y,
                rect.width,
                firstHeight  - half,           // trim bottom edge of first child
            );
            const secondRect = mkRect(
                rect.x,
                rect.y + firstHeight + (full - half),  // skip the gap
                rect.width,
                secondHeight - (full - half),            // trim top edge of second child
            );
            return [firstRect, secondRect];
        }
    }
}
