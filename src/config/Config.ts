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
    /** WM_CLASS values to never tile (lowercase, trimmed). */
    ignoreClass: string[];
    /** Resource names to never tile (lowercase, trimmed). */
    ignoreName: string[];
    /** Caption substrings to never tile (lowercase, trimmed). */
    ignoreCaption: string[];
}

/**
 * Split a comma-separated config string into a trimmed, lowercased array.
 * Empty entries are discarded.
 */
function parseIgnoreList(raw: string): string[] {
    if (!raw) return [];
    const items: string[] = [];
    const parts = raw.split(",");
    for (let i = 0; i < parts.length; i++) {
        const s = parts[i].trim().toLowerCase();
        if (s.length > 0) items.push(s);
    }
    return items;
}

/**
 * Load all config values from KWin's readConfig(), applying typed defaults.
 */
function loadConfig(): AerogelConfig {
    return {
        innerGap:      readConfig("innerGap", 8) as number,
        outerGap:      readConfig("outerGap", 8) as number,
        ignoreClass:   parseIgnoreList(readConfig("ignoreClass", "") as string),
        ignoreName:    parseIgnoreList(readConfig("ignoreName", "") as string),
        ignoreCaption: parseIgnoreList(readConfig("ignoreCaption", "") as string),
    };
}
