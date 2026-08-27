/**
 * The single plugin identifier shared by every surface that names this
 * plugin to the host: the cordis plugin name, the tuiStatus contribution
 * key, and the /settings namespace. These are distinct roles that happen
 * to carry one value — all three import this constant rather than repeating
 * the literal, so a rename stays consistent and the test contract (which
 * re-derives the value from the package name) stays meaningful.
 * @module dsh-tui-theme/pluginId
 */
export const PLUGIN_ID = 'dsh-tui-theme'
