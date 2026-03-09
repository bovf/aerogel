/// <reference path="../config/Config.ts" />

/**
 * GapConfig.ts -- holds gap measurements used during BSP layout calculation.
 *
 * innerGap: pixels inserted between two sibling nodes when splitting.
 * outerGap: pixels between the screen edge and the outermost window edges.
 */

class GapConfig {
    public readonly innerGap: number;
    public readonly outerGap: number;

    constructor(innerGap: number, outerGap: number) {
        this.innerGap = Math.max(0, Math.round(innerGap));
        this.outerGap = Math.max(0, Math.round(outerGap));
    }

    /**
     * Create a GapConfig from an AerogelConfig object.
     */
    static fromConfig(cfg: AerogelConfig): GapConfig {
        return new GapConfig(cfg.innerGap, cfg.outerGap);
    }

    /**
     * Half the inner gap -- applied to each sibling's near edge when splitting.
     */
    get halfInner(): number {
        return Math.floor(this.innerGap / 2);
    }
}
