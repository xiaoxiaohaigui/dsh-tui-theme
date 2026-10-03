/**
 * The three garnish colors of the built-in pink family, embedded.
 *
 * dsh-TUI does not expose the active palette to plugins: the runtime theme
 * service is register-only (`TuiThemeHost.getSnapshot/resolve/subscribe` are
 * host-only by design) and rejects the built-in names anyway, so the rich
 * status view has no way to read the colors the host is rendering with.
 *
 * The values below are the pink family's own `accent` / `inactiveShimmer` /
 * `subtle` entries, key-by-key identical to the host's built-ins (checked when
 * the family moved upstream, PR ccch1mneyyy/dsh-TUI#1294). They are the whole
 * palette surface this plugin still owns — three colors, no theme
 * registration, no files — so the garnish matches the palette it belongs to
 * without competing with it.
 *
 * Only pink themes are colored; every other palette renders with the terminal
 * default ({@link NO_COLORS}). Keep this table in step with the host's
 * `src/theme.ts` if the family's values ever change.
 * @module dsh-tui-theme/palette
 */
import { type StatusColors } from './statusView.js';
/** The garnish colors for one theme name (terminal default when not pink). */
export declare function statusColorsFor(themeName: string | undefined): StatusColors;
//# sourceMappingURL=palette.d.ts.map