/**
 * Cached terminal-background follow for the pink theme pair.
 *
 * dsh-TUI does not expose a plugin terminal-query seam. Plugins must
 * therefore not create their own stdin consumers or raw-mode leases: the host
 * owns both through Ink. This module only applies a previously stored result
 * before mount. A future host-owned query service can refresh that cache
 * without changing the preference format used here.
 *
 * The pref write mirrors the host's writeThemePref byte-for-byte
 * ({"theme": name}, 2-space indent).
 * @module dsh-tui-theme/autoTheme
 */
interface FollowCache {
    light: boolean;
    at: number;
}
/** The persisted theme pref ({ theme: name }), host format. */
export declare function readThemePref(dataDir: string): string | undefined;
/** Persist the theme pref in the host's exact format. */
export declare function writeThemePref(name: string, dataDir: string): boolean;
/** The cached terminal-background result, if a prior compatible writer stored one. */
export declare function readFollowCache(dataDir: string): FollowCache | undefined;
/** Map a cached background to this pair's theme name. */
export declare function themeForBackground(light: boolean): string;
/**
 * Apply the cached follow behavior synchronously before mount. It returns the
 * resolved name only when the existing preference already matched or the new
 * preference committed successfully.
 */
export declare function applyCachedFollow(dataDir: string): string | undefined;
/**
 * Apply a previously detected background without touching terminal I/O. A
 * future host-owned terminal query service may refresh theme-follow.json; this
 * plugin intentionally does not access stdin, stdout, or raw mode directly.
 */
export declare function runFollowSystem(dataDir: string, isCurrent: () => boolean, log: (message: string) => void): void;
export {};
//# sourceMappingURL=autoTheme.d.ts.map