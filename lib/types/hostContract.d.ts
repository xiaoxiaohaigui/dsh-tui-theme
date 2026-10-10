/**
 * Host-contract gates: palette keys that only newer dsh-TUI releases accept.
 *
 * Why a gate instead of "just ship the keys": the runtime theme seam validates
 * a whole descriptor against the host's own Theme contract, and a single
 * unknown key rejects the descriptor outright (the host logs one warning and
 * returns its no-op disposer). A palette carrying a key the host never heard
 * of therefore does not degrade — all three sakura themes disappear at once,
 * with only a host-side log line to explain it. The static-asset path is
 * gentler (unknown keys are skipped one by one, each with a warning) but still
 * noisy on every boot.
 *
 * Upstream PR #1260 added the eight chrome keys below to the contract; the
 * first published release carrying them is dsh-TUI 0.14.0 (npm, 2026-10-07).
 * The palettes declare seven of them — `cursor` is deliberately left out, since
 * its intended value (the empty string that keeps the inverse-video caret) is
 * not a valid colour at this boundary and the host's base palette already
 * answers with it. On anything older — including every static-asset host — this
 * plugin withholds the keys it does declare and ships the 73-semantic-key
 * palettes it published as v0.7.3, so a theme never vanishes over a cosmetic
 * key.
 *
 * Detection reads the host package's own manifest
 * (`@deepseek-harness-tui/dsh-tui/package.json`, a published subpath). When it
 * cannot be resolved, or the version is a prerelease, the answer is "not
 * supported": the palettes still register, so the worst case is a missing tint
 * rather than three missing themes.
 * @module dsh-tui-theme/hostContract
 */
/**
 * The chrome keys upstream PR #1260 added to the host Theme contract: the
 * context bar's five segment fills, the thinking-effort ignition pair (crest
 * colour and the band it fades into) and the prompt caret fill. They are the
 * only keys this plugin ships that a host release can predate.
 *
 * `cursor` appears here even though no palette declares it: it belongs to the
 * same contract addition, so a future palette that does set it must not send it
 * to a host that predates the key — one unknown key rejects the descriptor.
 */
export declare const CHROME_THEME_KEYS: readonly ["contextBarSystem", "contextBarPrompt", "contextBarAssistant", "contextBarThinking", "contextBarTools", "ignition", "ignitionDim", "cursor"];
/**
 * The installed host release, or `undefined` when its manifest cannot be
 * resolved. Resolved once per process; the plugin never talks to the host
 * package at runtime otherwise.
 */
export declare function hostThemeVersion(): string | undefined;
/** Whether the installed host's Theme contract includes the chrome keys. */
export declare function hostSupportsChromeKeys(): boolean;
/** Pin the answer for hermetic tests; `undefined` restores detection. */
export declare function setChromeKeySupportForTests(value: boolean | undefined): void;
/** Drop the chrome keys; the input object is never mutated. */
export declare function withoutChromeKeys(colors: Readonly<Record<string, string>>): Record<string, string>;
//# sourceMappingURL=hostContract.d.ts.map