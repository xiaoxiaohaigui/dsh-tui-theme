/**
 * Bundled-theme installation (seam four: static theme assets).
 *
 * Copies the package's themes/*.json into ~/.dsh-tui/themes/ on boot. Only
 * files that do not exist yet are written — a user's edited or same-named
 * theme file is never overwritten. Every failure is contained per file: a
 * theme garnish must never break the TUI's boot.
 * @module dsh-tui-pink-theme/themeAssets
 */
export interface ThemeInstallResult {
    /** Files newly written into the target directory. */
    readonly installed: readonly string[];
    /** Files already present in the target directory (left untouched). */
    readonly skipped: readonly string[];
    /** Files that could not be installed (per-file failures). */
    readonly failed: readonly string[];
}
export declare function homeDir(): string;
/** The package's bundled themes/ directory (sibling of the built lib/). */
export declare function bundledThemesDir(): string;
/** The host's user-theme directory (~/.dsh-tui/themes). */
export declare function themesTargetDir(): string;
/**
 * Install every bundled theme JSON that the target directory is missing.
 * @param targetDir - Destination directory (defaults to ~/.dsh-tui/themes).
 * @param sourceDir - Bundled assets (defaults to this package's themes/).
 * @returns Per-file outcome. Never throws.
 */
export declare function installBundledThemes(targetDir?: string, sourceDir?: string): ThemeInstallResult;
//# sourceMappingURL=themeAssets.d.ts.map