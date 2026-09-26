/**
 * /settings integration (seam six: tuiSettingsSections over the dsh settings
 * service).
 *
 * Registers a declarative editing section for the plugin's settings and, on
 * hosts that still have the registration API, the settings namespace itself.
 * Storage, schema validation, and layered resolution stay on the dsh settings
 * service; the TUI only renders. Fields carry no schema defaults on purpose —
 * an unset user layer must fall through to the cordis config layer (mirrors
 * the host's own lang/fullscreen fields), and format() displays the effective
 * value instead of a misleading blank.
 *
 * Two generations, branched by capability (never by version),
 * `dsh-settings`'s 0.1.7 break being the reason
 * (docs/decisions/2026-09-24-settings-generation-adaptation.md):
 *
 * - **≤0.1.6** (dsh-TUI 0.9.x/0.10.x) — `settings.register(ns, schema)` owns
 *   the namespace. The card's paths resolve against the scope schema declared
 *   here, and `scope.watch` pushes edits into the plugin.
 * - **≥0.1.7** (dsh-TUI 0.11+) — there is no registration API at all
 *   (`SettingsForms` projects each profile entry's *Config* instead). The
 *   namespace is this plugin's profile entry id (see
 *   {@link resolveSettingsNamespace}) and the form schema is `Config` filtered
 *   to its volatile fields (liveConfig.ts). Edits land in the profile patch,
 *   the loader rewrites those same refs in place, and
 *   `loader/volatile-update` announces it; this module re-reads the live config
 *   on that event. The card stays ours, so the auto-generated page is turned
 *   off with `configure({ auto: false })`.
 *
 * A miss in either direction is silent and user-visible only as a card that
 * renders but never saves (≤0.1.6) or a `命名空间未注册` badge (≥0.1.7) — hence
 * the branch below warns instead of swallowing the failure.
 *
 * The section splits into two navigation groups (背景跟随 / 状态行). The two
 * text fields (glyph, separator) validate their drafts with parse(): an
 * invalid draft blocks the save, an empty draft clears back to the cordis
 * default. Both services are consumed through `ctx.inject`, not apply-time
 * `get` probes: this row may start before the host's service rows, and the
 * inject fires whenever each service actually registers.
 * @module dsh-tui-theme/settingsSection
 */
import type { Context } from '@deepseek-ai/cordis';
import type { StatusOptions } from './statusLine.js';
/** The plugin's settings document (every field optional at the user layer). */
export type PinkSettingsDoc = StatusOptions & {
    /** Install bundled theme JSONs on boot (cordis-config layer only). */
    autoInstallThemes?: boolean;
    /** Apply a cached terminal background: pink-day <-> pink-night. */
    followSystem?: boolean;
};
/** The settings namespace this plugin owns by default, and the fallback when
 *  the Loader entry id is unusable. On ≥0.1.7 hosts the *entry id* is the
 *  namespace the host keys by, so the effective value is
 *  {@link resolveSettingsNamespace}: a default install lands on exactly this
 *  string (`cordis.patch.yml` pins `id: dsh-tui-theme`), and it stays the name
 *  the README documents for settings storage. */
export declare const SETTINGS_NS = "dsh-tui-theme";
/**
 * The namespace this plugin's settings live under: the Loader entry id when it
 * satisfies the section grammar, {@link SETTINGS_NS} otherwise.
 *
 * A `dsh-settings` ≥0.1.7 host keys namespaces by the Loader entry id
 * (`SettingsForms.describe()` → `entry.options.id`), so keying the card off
 * anything else breaks the moment the row is renamed — the fragility dsh-TUI
 * #990 records, where even the host's own section had to stop hard-coding its
 * name. Both generations resolve to the same string here, so the card, the
 * legacy registration and the host's projection cannot disagree.
 */
export declare function resolveSettingsNamespace(ctx: Context): string;
/** Everything the wiring needs from the plugin's own activation. */
export interface PinkSettingsWiring {
    /** The cordis-config layer (the effective value format() falls back to for
     *  still-unset fields). */
    readonly cordis: StatusOptions & {
        followSystem?: boolean;
    };
    /** Current plain values of the plugin's own row config. On ≥0.1.7 hosts the
     *  loader rewrites the live refs in place, so calling this again after
     *  `loader/volatile-update` yields the edited values. */
    readLive(): PinkSettingsDoc;
    /** Whether the row-config schema carries the live marker
     *  (`hasLiveConfigFields(Config)`); diagnostics only. */
    readonly hasLiveFields: boolean;
    /** Receives the defined-valued subset of the settings doc — the initial one
     *  and every later edit. */
    onDoc(doc: PinkSettingsDoc): void;
}
/**
 * Register the /settings section and, on hosts that still have the
 * registration API, the settings namespace behind it. Each part waits for its
 * own service; neither is required for the other.
 *
 * @param ctx - The plugin's own activation context: the Config owner the
 *   ≥0.1.7 page policy and the volatile-update listener must attach to (their
 *   disposers ride the inject child, which is what a service reload recycles).
 * @param wiring - The value source and sink for the card.
 * @param dataDir - The host data directory (~/.dsh-tui), read by the
 *   followSystem field's format() to surface the cached follow state.
 */
export declare function registerPinkSettings(ctx: Context, wiring: PinkSettingsWiring, dataDir?: string): void;
//# sourceMappingURL=settingsSection.d.ts.map