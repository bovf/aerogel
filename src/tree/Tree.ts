/// <reference path="Node.ts" />
/// <reference path="Container.ts" />
/// <reference path="WindowNode.ts" />

/**
 * Tree.ts -- BSP tree for a single (virtualDesktop × screen) pair.
 *
 * Responsibilities:
 *   - insert(window): find the focused leaf (or any leaf), split its cell and
 *     place the new window as a sibling.
 *   - remove(window): detach the leaf's parent container, replace it with the
 *     sibling, preserving proportions.
 *   - swap(a, b): exchange the windows at two leaf nodes in-place.
 *   - findNeighbor(window, dir): traverse up and across the tree to find the
 *     nearest WindowNode in the given direction.
 *   - leaves(): return all WindowNodes in layout order.
 *   - isEmpty(): true when no windows are in the tree.
 */

class Tree {
    /** Root of the BSP tree. null when there are no windows. */
    private root: Node | null = null;

    /**
     * The window that was focused most recently -- used as the split target
     * when a new window is inserted.
     */
    private focusedWindow: KWinWindow | null = null;

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** True when the tree contains no windows. */
    isEmpty(): boolean {
        return this.root === null;
    }

    /** Return all leaf WindowNodes in tree order. */
    leaves(): WindowNode[] {
        if (this.root === null) return [];
        return this.root.leaves();
    }

    /** Return the root node (null if empty). Used by BSPLayout.apply(). */
    getRoot(): Node | null {
        return this.root;
    }

    /** Update the tracked focused window (called from windowActivated). */
    setFocused(window: KWinWindow): void {
        this.focusedWindow = window;
    }

    /**
     * Insert a new window into the tree.
     *
     * Algorithm:
     *   1. If the tree is empty, the new window becomes the sole root leaf.
     *   2. Otherwise find the "target" leaf -- the currently focused window's
     *      node, or the last leaf if nothing is focused.
     *   3. Determine split orientation from target.depth().
     *   4. Replace target in the tree with a new Container(orientation, target, newLeaf).
     *   5. Both children start at ratio = 0.5 (equal split).
     */
    insert(window: KWinWindow): WindowNode {
        const newLeaf = new WindowNode(window);

        if (this.root === null) {
            // First window: becomes the root.
            this.root = newLeaf;
            return newLeaf;
        }

        // Find the best split target.
        const target = this.findSplitTarget();

        // Determine orientation based on the target's current depth.
        const orientation = Container.orientationForDepth(target.depth());

        // Capture the target's parent BEFORE the Container constructor
        // overwrites target.parent (the constructor wires both children's
        // parent to the new container).
        const targetParent = target.parent;

        // Build the replacement container.
        const container = new Container(orientation, target, newLeaf, 0.5);
        // At this point: target.parent = container, newLeaf.parent = container.

        // Splice the new container into the tree where `target` used to be.
        if (targetParent === null) {
            // target was the root → container becomes the new root.
            container.parent = null;
            this.root = container;
        } else {
            // Replace target with container in the grandparent.
            // We cannot use replaceChild here because it would clobber
            // target.parent (which the Container constructor already set).
            if (targetParent.first === target) {
                targetParent.first = container;
            } else {
                targetParent.second = container;
            }
            container.parent = targetParent;
            // target.parent is already correctly set to container by the constructor.
        }

        return newLeaf;
    }

    /**
     * Remove a window from the tree.
     *
     * Algorithm:
     *   1. Find the WindowNode for `window`.
     *   2. If it is the root (only window), set root to null.
     *   3. Otherwise, get its parent Container and the sibling node.
     *      Replace the parent with the sibling in the grandparent (or root).
     *      The sibling inherits the parent's ratio so proportions are preserved.
     */
    remove(window: KWinWindow): void {
        const leaf = this.findLeaf(window);
        if (leaf === null) return;

        if (this.focusedWindow === window) {
            this.focusedWindow = null;
        }

        if (leaf.parent === null) {
            // Only window in the tree.
            this.root = null;
            return;
        }

        const parentContainer = leaf.parent;
        const sibling = parentContainer.siblingOf(leaf);

        // Preserve the parent's ratio in the sibling so the sibling occupies
        // the same space the parent container did.
        sibling.ratio = parentContainer.ratio;

        if (parentContainer.parent === null) {
            // Parent was the root → sibling becomes root.
            sibling.parent = null;
            this.root = sibling;
        } else {
            // Splice sibling into grandparent.
            parentContainer.parent.replaceChild(parentContainer, sibling);
        }

        // Detach the removed leaf.
        leaf.parent = null;
    }

    /**
     * Swap two windows within the tree (their leaf nodes exchange window refs
     * and lastRect values -- geometry will be re-applied by the next layout pass).
     */
    swap(a: KWinWindow, b: KWinWindow): void {
        const leafA = this.findLeaf(a);
        const leafB = this.findLeaf(b);
        if (leafA === null || leafB === null) return;

        // Swap the window references.
        (leafA as { window: KWinWindow }).window = b;
        (leafB as { window: KWinWindow }).window = a;
    }

    /**
     * Find the nearest WindowNode in direction `dir` relative to `from`.
     *
     * Algorithm:
     *   Walk up the tree from `from`'s leaf until we find a Container whose
     *   orientation matches the movement axis AND the movement goes "across"
     *   to the sibling sub-tree. Then descend into the sibling picking the
     *   nearest (first or last) leaf.
     *
     * Returns null if no neighbor exists in that direction.
     */
    findNeighbor(from: KWinWindow, dir: Direction): WindowNode | null {
        const leaf = this.findLeaf(from);
        if (leaf === null) return null;

        // Determine which orientation and which "side" we're looking for.
        const isHorizontal = (dir === Direction.Left || dir === Direction.Right);
        const goingForward  = (dir === Direction.Right || dir === Direction.Down);
        const targetOrientation = isHorizontal ? Orientation.Horizontal : Orientation.Vertical;

        // Walk up the tree.
        let current: Node = leaf;
        while (current.parent !== null) {
            const parent = current.parent;
            if (parent.orientation === targetOrientation) {
                const isFirstChild = parent.isFirst(current);
                // We can cross to the sibling if:
                //   moving forward (right/down) and we are the first child, OR
                //   moving backward (left/up)  and we are the second child.
                if ((goingForward && isFirstChild) || (!goingForward && !isFirstChild)) {
                    const siblingSubtree = parent.siblingOf(current);
                    // Descend into sibling: pick the nearest leaf.
                    // Going forward into sibling → pick the leftmost/topmost leaf.
                    // Going backward into sibling → pick the rightmost/bottommost leaf.
                    return goingForward
                        ? Tree.firstLeaf(siblingSubtree)
                        : Tree.lastLeaf(siblingSubtree);
                }
            }
            current = parent;
        }

        // No neighbor in this direction.
        return null;
    }

    /**
     * Find the WindowNode for a given KWin window. Returns null if not found.
     */
    findLeaf(window: KWinWindow): WindowNode | null {
        if (this.root === null) return null;
        return this.root.findWindow(window);
    }

    /**
     * Adjust the split ratio of a window's parent container to match a
     * manually resized geometry. Called after interactiveMoveResizeFinished.
     *
     * We compare the new actual size of the resized window against the total
     * space of its parent container, and update firstRatio accordingly.
     *
     * @param window     The window that was resized.
     * @param screenRect The current screen/work area rect (for context).
     */
    adjustRatioAfterResize(window: KWinWindow, _screenRect: QRect): void {
        const leaf = this.findLeaf(window);
        if (leaf === null || leaf.parent === null) return;

        const parent = leaf.parent;
        const actualRect = window.frameGeometry;

        // Use the last known rects of the first and second child sub-trees to
        // estimate the container bounding box. We use the outer envelope of
        // both children -- this is an approximation that ignores the inner gap,
        // but is accurate enough for proportional ratio adjustment.
        const firstLeaves  = parent.first.leaves();
        const secondLeaves = parent.second.leaves();
        if (firstLeaves.length === 0 || secondLeaves.length === 0) return;

        // Get bounding-box corners for first and second sub-trees.
        const firstBBox  = bboxOf(firstLeaves);
        const secondBBox = bboxOf(secondLeaves);
        if (!firstBBox || !secondBBox) return;

        if (parent.orientation === Orientation.Horizontal) {
            const totalWidth = (secondBBox.x + secondBBox.width) - firstBBox.x;
            if (totalWidth <= 0) return;
            // The ratio of the first child is based on its bbox width relative to total.
            const firstWidth = firstBBox.width;
            // If we just resized a first-child leaf, use actualRect.width as first-child size.
            if (parent.isFirst(leaf)) {
                parent.firstRatio = Math.max(0.1, Math.min(0.9, actualRect.width / totalWidth));
            } else {
                parent.firstRatio = Math.max(0.1, Math.min(0.9, firstWidth / totalWidth));
            }
        } else {
            const totalHeight = (secondBBox.y + secondBBox.height) - firstBBox.y;
            if (totalHeight <= 0) return;
            const firstHeight = firstBBox.height;
            if (parent.isFirst(leaf)) {
                parent.firstRatio = Math.max(0.1, Math.min(0.9, actualRect.height / totalHeight));
            } else {
                parent.firstRatio = Math.max(0.1, Math.min(0.9, firstHeight / totalHeight));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Find the best node to split when inserting a new window.
     * Prefers the currently focused window; falls back to the last leaf.
     */
    private findSplitTarget(): WindowNode {
        if (this.focusedWindow !== null) {
            const focused = this.findLeaf(this.focusedWindow);
            if (focused !== null) return focused;
        }
        // Fall back to the last leaf in tree order.
        const allLeaves = this.leaves();
        return allLeaves[allLeaves.length - 1];
    }

    /** Recursively find the first (leftmost/topmost) leaf in a subtree. */
    static firstLeaf(node: Node): WindowNode {
        if (node.isWindowNode()) return node;
        return Tree.firstLeaf((node as Container).first);
    }

    /** Recursively find the last (rightmost/bottommost) leaf in a subtree. */
    static lastLeaf(node: Node): WindowNode {
        if (node.isWindowNode()) return node;
        return Tree.lastLeaf((node as Container).second);
    }
}

/**
 * Compute the bounding-box QRect that contains all the lastRects of the
 * given WindowNodes. Returns null if none have a lastRect yet.
 */
function bboxOf(nodes: WindowNode[]): QRect | null {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    let found = false;
    for (const n of nodes) {
        const r = n.lastRect;
        if (!r) continue;
        found = true;
        if (r.x < x1) x1 = r.x;
        if (r.y < y1) y1 = r.y;
        if (r.x + r.width  > x2) x2 = r.x + r.width;
        if (r.y + r.height > y2) y2 = r.y + r.height;
    }
    if (!found) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } as QRect;
}
