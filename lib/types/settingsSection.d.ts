/**
 * /settings integration (seam six: tuiSettingsSections over the dsh settings
 * service).
 *
 * Registers the `pink-theme` settings namespace and a declarative editing
 * section for it. Storage, schema validation, and layered resolution stay on
 * the dsh settings service; the TUI only renders. Fields carry no schema
 * defaults on purpose — an unset user layer must fall through to the cordis
 * config layer (mirrors the host's own lang/fullscreen fields), and format()
 * displays the effective value instead of a misleading blank.
 *
 * Both services are consumed through `ctx.inject`, not apply-time `get`
 * probes: this row may start before the host's service rows, and the inject
 * fires whenever each service actually registers.
 * @module dsh-tui-pink-theme/settingsSection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { StatusOptions } from './statusLine.js';
/** The plugin's settings document (every field optional at the user layer). */
export type PinkSettingsDoc = StatusOptions & {
    /** Install bundled theme JSONs on boot (cordis-config layer only). */
    autoInstallThemes?: boolean;
    /** Follow the terminal/system background: pink-day ↔ pink-night. */
    followSystem?: boolean;
};
/**
 * Register the settings namespace (mirror the resolved document to the
 * caller) and, separately, the /settings section for it. Each part waits for
 * its own service; neither is required for the other.
 *
 * @param ctx - The plugin's own activation context.
 * @param cordis - The cordis-config layer (shown as the effective value for
 *   still-unset fields).
 * @param onDoc - Called with the defined-valued subset of the settings doc,
 *   initially and on every committed edit.
 */
export declare function registerPinkSettings(ctx: Context, cordis: StatusOptions, onDoc: (doc: PinkSettingsDoc) => void): void;
//# sourceMappingURL=settingsSection.d.ts.map