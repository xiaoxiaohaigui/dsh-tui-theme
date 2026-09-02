/**
 * Bundled-theme installation (seam four: static theme assets).
 *
 * Copies the package's themes/*.json into ~/.dsh-tui/themes/ on boot. Only
 * files that do not exist yet are written — a user's edited or same-named
 * theme file is never overwritten. The one exception is a target that no
 * longer parses as JSON (a torn write from an interrupted installation):
 * that file is backed up under a .corrupt-<timestamp> name and replaced, so
 * a crash can never shadow a bundled theme forever. Every failure is
 * contained per file: a theme garnish must never break the TUI's boot.
 * @module dsh-tui-theme/themeAssets
 */
export interface ThemeInstallResult {
    /** Files newly written into the target directory. */
    readonly installed: readonly string[];
    /** Files already present in the target directory (left untouched). */
    readonly skipped: readonly string[];
    /** Corrupt targets backed up and reinstalled (self-heal). */
    readonly repaired: readonly string[];
    /** Files that could not be installed (per-file failures). */
    readonly failed: readonly string[];
}
export interface BundledTheme {
    readonly file: string;
    readonly name: string;
    readonly displayName?: string;
    readonly base: 'light' | 'dark' | 'dark-ansi';
    readonly colors: Record<string, string>;
}
export declare function homeDir(): string;
/** The package's bundled themes/ directory (sibling of the built lib/). */
export declare function bundledThemesDir(): string;
/** The host's user-theme directory (~/.dsh-tui/themes). */
export declare function themesTargetDir(): string;
/** Read bundled descriptors for hosts that support runtime theme registration. */
export declare function readBundledThemes(sourceDir?: string): BundledTheme[];
/**
 * Install every bundled theme JSON that the target directory is missing.
 * @param targetDir - Destination directory (defaults to ~/.dsh-tui/themes).
 * @param sourceDir - Bundled assets (defaults to this package's themes/).
 * @returns Per-file outcome. Never throws.
 */
export declare function installBundledThemes(targetDir?: string, sourceDir?: string): ThemeInstallResult;
/**
 * Remove files that this activation installed when a runtime theme service
 * becomes available. A byte-for-byte check preserves edits made in the small
 * window between installation and runtime confirmation.
 */
export declare function removeBundledThemes(files: readonly string[], targetDir?: string, sourceDir?: string): string[];
/**
 * Bundled theme files present in the target directory byte-for-byte
 * identical to the bundled copy. On runtime-theme hosts such files shadow
 * the registry while adding nothing, so the entry point can point them out
 * once. User-edited or foreign same-named files are never reported — the
 * never-overwrite rule keeps them, and no toast may nag about them.
 */
export declare function findShadowedBundledThemes(targetDir?: string, sourceDir?: string): string[];
//# sourceMappingURL=themeAssets.d.ts.map