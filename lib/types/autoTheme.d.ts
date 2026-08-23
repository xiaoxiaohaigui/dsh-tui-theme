/**
 * Terminal-background follow: the pink pair's `auto`.
 *
 * The host's `auto` pseudo-theme resolves builtin light/dark via an OSC 11
 * query at mount and keeps the result in memory only — user themes cannot
 * ride it. This module gives pink-day/pink-night the same behavior from the
 * plugin side:
 *
 * - at apply() (which runs before the React tree mounts and reads
 *   ~/.dsh-tui/theme.json), the cached detection writes the resolved theme
 *   name into the pref synchronously — always in time for this boot;
 * - a fresh OSC 11 query then refreshes the cache for the next boot. The
 *   very first enabling (or a system flip between boots) lands one boot
 *   late — the same cadence as the host's own "re-select auto or restart".
 *
 * The pref write mirrors the host's writeThemePref byte-for-byte
 * ({"theme": name}, 2-space indent) and the light test mirrors the host's
 * luminance threshold so both sides always agree on light/dark.
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
/** The cached detection, if one exists. */
export declare function readFollowCache(dataDir: string): FollowCache | undefined;
/**
 * Map a detected background to this pair's theme name.
 * @param light - True for a light terminal background.
 */
export declare function themeForBackground(light: boolean): string;
/**
 * Apply the follow behavior synchronously from cache: writes the resolved
 * theme name into the pref when it differs. Safe before mount — pure fs.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @returns The applied theme name, or undefined when no cache exists yet.
 */
export declare function applyCachedFollow(dataDir: string): string | undefined;
/**
 * Query the terminal background (OSC 11) and refresh the cache + pref.
 * Best effort: no TTY, an unresponsive terminal, or a parse failure just
 * leaves the previous state intact. Runs before the host's own stdin
 * parsing is mounted; raw mode is restored to whatever it was.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @param stdout - Injectable for tests.
 * @param stdin - Injectable for tests.
 * @param setTimeoutFn - Injectable for tests.
 * @returns The detected light-ness, or undefined when unavailable.
 */
export declare function refreshDetectedBackground(dataDir: string, stdout?: NodeJS.WriteStream, stdin?: NodeJS.ReadStream, setTimeoutFn?: typeof setTimeout): Promise<boolean | undefined>;
/**
 * The whole follow sequence for apply(): cached value now (pre-mount),
 * fresh detection for the next boot.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @param log - Info sink for the applied/refreshed outcomes.
 */
export declare function runFollowSystem(dataDir: string, log: (message: string) => void): void;
export {};
//# sourceMappingURL=autoTheme.d.ts.map