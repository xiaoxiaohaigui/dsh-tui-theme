/**
 * Host-facing data paths and the persisted theme preference, shared by the
 * status line and the migration notice.
 *
 * 0.8 handed the pink family to dsh-TUI: `pink-night` / `pink-day` /
 * `pink-ansi` are built-in palettes now, and this plugin neither ships nor
 * registers any palette. It therefore only *reads* the host's own preference
 * file — `theme.json` is host state, and this module deliberately has no
 * writer: nothing in the plugin may overwrite a user's `/theme` choice.
 *
 * Home resolution mirrors the host's utils/paths.ts homeDir(): os.homedir()
 * first, USERPROFILE/HOME spellings as stripped-down fallbacks. When all three
 * come up empty the returned '' makes every derived path resolve against the
 * process cwd — the host's own semantics, kept deliberately identical rather
 * than second-guessed here.
 * @module dsh-tui-theme/themePref
 */
export declare function homeDir(): string;
/** The host's data directory (~/.dsh-tui): the only tree this plugin reads. */
export declare function dataDir(): string;
/** The host's built-in pink palettes — the themes this garnish belongs to. */
export declare const PINK_THEMES: ReadonlySet<string>;
export declare function isPinkTheme(name: string | undefined): name is string;
/** The persisted theme pref ({ theme: name }), in the host's own format. */
export declare function readThemePref(dir: string): string | undefined;
//# sourceMappingURL=themePref.d.ts.map