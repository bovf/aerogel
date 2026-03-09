/// <reference path="Node.ts" />

/**
 * Container.ts -- Internal BSP tree node.
 *
 * A Container holds exactly two children (first, second) and an orientation.
 * The orientation determines whether the children are laid out
 * horizontally (side-by-side) or vertically (stacked).
 *
 * `firstRatio` is how much of the available space the first child gets.
 * The second child always gets (1 - firstRatio) of the space.
 */

class Container extends Node {
    public orientation: Orientation;
    public first: Node;
    public second: Node;

    /**
     * Fraction of the container's space given to `first`.
     * Default 0.5 = equal split.
     */
    public firstRatio: number;

    constructor(
        orientation: Orientation,
        first: Node,
        second: Node,
        firstRatio: number = 0.5,
    ) {
        super();
        this.orientation = orientation;
        this.first  = first;
        this.second = second;
        this.firstRatio = firstRatio;

        // Wire parent pointers.
        first.parent  = this;
        second.parent = this;
    }

    isContainer(): this is Container { return true; }
    isWindowNode(): this is WindowNode { return false; }

    public leaves(): WindowNode[] {
        return [...this.first.leaves(), ...this.second.leaves()];
    }

    public findWindow(window: KWinWindow): WindowNode | null {
        return this.first.findWindow(window) ?? this.second.findWindow(window);
    }

    /**
     * Replace a child node with a new node, preserving the parent link.
     */
    public replaceChild(oldChild: Node, newChild: Node): void {
        if (this.first === oldChild) {
            this.first = newChild;
        } else if (this.second === oldChild) {
            this.second = newChild;
        } else {
            throw new Error("Container.replaceChild: oldChild not found");
        }
        newChild.parent = this;
        oldChild.parent = null;
    }

    /**
     * Return the sibling of `child` within this container.
     */
    public siblingOf(child: Node): Node {
        if (this.first === child) return this.second;
        if (this.second === child) return this.first;
        throw new Error("Container.siblingOf: node is not a child of this container");
    }

    /**
     * True if `child` is the first (left/top) child.
     */
    public isFirst(child: Node): boolean {
        return this.first === child;
    }

    /**
     * Determine the split orientation to use when inserting at a given depth.
     *
     * Even depth → Horizontal (children side-by-side).
     * Odd depth  → Vertical   (children stacked).
     */
    static orientationForDepth(depth: number): Orientation {
        return depth % 2 === 0 ? Orientation.Horizontal : Orientation.Vertical;
    }
}
