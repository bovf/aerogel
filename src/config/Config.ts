/**
 * Config.ts -- typed wrappers around readConfig() for all script settings.
 *
 * Config keys must match the entries in package/contents/config/main.xml.
 */

interface AerogelConfig {
    /** Gap in pixels between sibling windows inside the tree. */
    innerGap: number;
    /** Gap in pixels between the outermost windows and the screen edge. */
    outerGap: number;
}

/**
 * Load all config values from KWin's readConfig(), applying typed defaults.
 */
function loadConfig(): AerogelConfig {
    return {
        innerGap: readConfig("innerGap", 8) as number,
        outerGap: readConfig("outerGap", 8) as number,
    };
}
