/**
 * Node.ts -- Abstract base for BSP tree nodes.
 *
 * The tree has two kinds of nodes:
 *   - Container: an internal node with an orientation (H or V) and two children.
 *   - WindowNode: a leaf node that wraps a single KWin window.
 *
 * Each node stores a `ratio` (0..1) which represents how much of its parent's
 * space it should consume. The sibling always gets (1 - ratio). For a fresh
 * 50/50 split, ratio = 0.5.
 */

/** Split orientation for Container nodes. */
const enum Orientation {
    /** Horizontal split: children are placed side-by-side (left | right). */
    Horizontal = "H",
    /** Vertical split: children are placed top-and-bottom (top / bottom). */
    Vertical   = "V",
}

/**
 * Direction enum used for focus/swap navigation.
 */
const enum Direction {
    Left  = "left",
    Right = "right",
    Up    = "up",
    Down  = "down",
}

/** Abstract BSP tree node. */
abstract class Node {
    /**
     * Fraction of the parent's space this node occupies.
     * The sibling's fraction = 1 - parent.ratio (where parent tracks this node's
     * position as first or second child, see Container).
     */
    public ratio: number = 0.5;

    /** Back-reference to the parent Container, or null for the root. */
    public parent: Container | null = null;

    /** True if this is a Container (internal node). */
    abstract isContainer(): this is Container;

    /** True if this is a WindowNode (leaf). */
    abstract isWindowNode(): this is WindowNode;

    /**
     * Depth of this node in the tree (root = 0).
     * Used to determine split orientation: even depth → Horizontal, odd → Vertical.
     */
    public depth(): number {
        if (this.parent === null) return 0;
        return this.parent.depth() + 1;
    }

    /**
     * Collect all WindowNode leaves under this node.
     */
    public abstract leaves(): WindowNode[];

    /**
     * Find the WindowNode wrapping the given KWin window, or null.
     */
    public abstract findWindow(window: KWinWindow): WindowNode | null;
}
