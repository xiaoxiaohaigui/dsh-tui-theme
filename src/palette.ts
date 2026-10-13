/**
 * The three garnish colors of the built-in pink family, embedded.
 *
 * dsh-TUI does not expose the active palette to plugins: the runtime theme
 * service is register-only (`TuiThemeHost.getSnapshot/resolve/subscribe` are
 * host-only by design) and rejects the built-in names anyway, so the rich
 * status view has no way to read the colors the host is rendering with.
 *
 * The values below are the pink family's own `accent` / `inactiveShimmer` /
 * `subtle` entries, key-by-key identical to the host's built-ins (the family
 * moved upstream with PR ccch1mneyyy/dsh-TUI#1294, merged on 2026-10-12 as
 * `4f4980fe`; the merge left these three values untouched). They are the whole
 * palette surface this plugin still owns — three colors, no theme
 * registration, no files — so the garnish matches the palette it belongs to
 * without competing with it.
 *
 * Only pink themes are colored; every other palette renders with the terminal
 * default ({@link NO_COLORS}). Keep this table in step with the host's
 * `src/theme.ts` if the family's values ever change.
 * @module dsh-tui-theme/palette
 */

import { NO_COLORS, type StatusColors } from './statusView.js'
import { isPinkTheme } from './themePref.js'

/**
 * accent (glyph) / inactiveShimmer (clock, turns) / subtle (separator) of each
 * built-in pink palette. The clock and turn cells share the host's bottom-bar
 * tier: the model name and its neighbours render with `inactiveShimmer`, and
 * the garnish reads consistent when it matches (user-tested — body text was
 * too heavy, `inactive` still felt off).
 */
const PINK_PALETTES: Readonly<Record<string, StatusColors>> = Object.freeze({
  'pink-night': Object.freeze({
    glyph: 'rgb(242,123,166)',
    text: '#C4B0B9',
    separator: '#77646D',
  }),
  'pink-day': Object.freeze({
    glyph: 'rgb(222,110,150)',
    text: '#9E6E82',
    separator: '#B3A3AC',
  }),
  'pink-ansi': Object.freeze({
    glyph: 'ansi:magentaBright',
    text: 'ansi:whiteBright',
    separator: 'ansi:white',
  }),
})

/** The garnish colors for one theme name (terminal default when not pink). */
export function statusColorsFor(themeName: string | undefined): StatusColors {
  if (!isPinkTheme(themeName)) return NO_COLORS
  return PINK_PALETTES[themeName] ?? NO_COLORS
}
