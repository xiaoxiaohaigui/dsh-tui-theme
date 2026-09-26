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

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { TuiSettingsFieldWrite, TuiSettingsSection } from '@deepseek-harness-tui/dsh-tui/api'
import z from '@deepseek-ai/schemastery'
import { readFollowCache } from './autoTheme.js'
import { parseOrnamentDraft } from './ornament.js'
import type { StatusOptions } from './statusLine.js'
import { PLUGIN_ID } from './pluginId.js'
import { homeDir } from './themeAssets.js'

/** The plugin's settings document (every field optional at the user layer). */
export type PinkSettingsDoc = StatusOptions & {
  /** Install bundled theme JSONs on boot (cordis-config layer only). */
  autoInstallThemes?: boolean
  /** Apply a cached terminal background: pink-day <-> pink-night. */
  followSystem?: boolean
}

/** Structural views of host services; the real types live in the host. */
interface SettingsScopeLike {
  get(): unknown
  /** Returns the disposer the activation's effect ledger has to own. */
  watch(listener: (value: unknown) => void): () => void
}
/** The union of both generations' surfaces: the ≤0.1.6 namespace registration
 *  and the ≥0.1.7 Config-derived forms with their per-instance page policy. */
interface SettingsServiceLike {
  register?(namespace: unknown, schema: unknown): SettingsScopeLike
  configure?(presentation: { auto?: boolean }, owner?: unknown): unknown
}
interface TuiSettingsSectionsLike {
  register(section: TuiSettingsSection): () => void
}

/** The settings namespace this plugin owns by default, and the fallback when
 *  the Loader entry id is unusable. On ≥0.1.7 hosts the *entry id* is the
 *  namespace the host keys by, so the effective value is
 *  {@link resolveSettingsNamespace}: a default install lands on exactly this
 *  string (`cordis.patch.yml` pins `id: dsh-tui-theme`), and it stays the name
 *  the README documents for settings storage. */
export const SETTINGS_NS = PLUGIN_ID

/** The grammar plugin-owned sections must satisfy
 *  (`tuiSettingsSections.register`; the host only relaxes it for its own
 *  sections, which may carry opaque Loader ids). */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]*$/

/** The plugin's Loader entry id, when the host gives us one. */
function loaderEntryId(ctx: Context): string | undefined {
  const fiber = ctx.fiber as (typeof ctx.fiber & { entry?: { options?: { id?: unknown } } }) | undefined
  const id = fiber?.entry?.options?.id
  return typeof id === 'string' ? id : undefined
}

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
export function resolveSettingsNamespace(ctx: Context): string {
  const id = loaderEntryId(ctx)
  return id !== undefined && NAMESPACE_PATTERN.test(id) ? id : SETTINGS_NS
}

/** Everything the wiring needs from the plugin's own activation. */
export interface PinkSettingsWiring {
  /** The cordis-config layer (the effective value format() falls back to for
   *  still-unset fields). */
  readonly cordis: StatusOptions & { followSystem?: boolean }
  /** Current plain values of the plugin's own row config. On ≥0.1.7 hosts the
   *  loader rewrites the live refs in place, so calling this again after
   *  `loader/volatile-update` yields the edited values. */
  readLive(): PinkSettingsDoc
  /** Whether the row-config schema carries the live marker
   *  (`hasLiveConfigFields(Config)`); diagnostics only. */
  readonly hasLiveFields: boolean
  /** Receives the defined-valued subset of the settings doc — the initial one
   *  and every later edit. */
  onDoc(doc: PinkSettingsDoc): void
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
export function registerPinkSettings(
  ctx: Context,
  wiring: PinkSettingsWiring,
  dataDir: string = joinHomeDataDir(),
): void {
  const ns = resolveSettingsNamespace(ctx)

  ctx.inject(['settings'], settingsCtx => {
    const settings = (settingsCtx as Context & { settings?: SettingsServiceLike }).settings
    if (settings === undefined) return

    if (typeof settings.register === 'function') {
      registerNamespaceScope(settingsCtx, settings, wiring, ns)
      return
    }
    if (typeof settings.configure !== 'function') {
      settingsCtx.logger.info(
        'dsh-tui-theme: the settings service exposes neither the namespace registration nor the Config-derived surface; the settings card stays unavailable this session',
      )
      return
    }
    diagnoseConfigGeneration(ctx, ns, wiring.hasLiveFields)
    configureOwnPage(ctx, settingsCtx, settings)
    wiring.onDoc(definedOnly(wiring.readLive()))
    watchLiveConfig(ctx, settingsCtx, wiring)
  })

  ctx.inject(['tuiSettingsSections'], sectionsCtx => {
    const sections = (sectionsCtx as Context & { tuiSettingsSections: TuiSettingsSectionsLike })
      .tuiSettingsSections
    try {
      const unregister = sections.register(sectionDefinition(ns, wiring.cordis, dataDir))
      sectionsCtx.effect(() => () => unregister())
    } catch (error) {
      // A duplicate registration (hot reload race) or a stricter host must
      // not take the plugin — or the TUI — down.
      sectionsCtx.logger.warn(
        `dsh-tui-theme: settings section registration failed: ${String(error)}`,
      )
    }
  })
}

/** The defined-valued subset of a settings document: the ≤0.1.6 user layer and
 *  the ≥0.1.7 live config both arrive with unset keys present but undefined. */
function definedOnly(doc: unknown): PinkSettingsDoc {
  if (doc === null || typeof doc !== 'object') return {}
  const clean: PinkSettingsDoc = {}
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (value !== undefined) (clean as Record<string, unknown>)[key] = value
  }
  return clean
}

/**
 * ≤0.1.6 generation: own the namespace and follow its scope. The schema spells
 * out the same field set the card exposes and deliberately carries no defaults
 * — an unset user layer must fall through to the cordis layer, which format()
 * already displays as the effective value.
 */
function registerNamespaceScope(
  settingsCtx: Context,
  settings: SettingsServiceLike,
  wiring: PinkSettingsWiring,
  ns: string,
): void {
  try {
    // Call it as a method (optional-call on the property): the provider's
    // register() reads its own state, so a detached reference would lose
    // `this` and throw.
    //
    // The namespace is passed as a plain string: dsh-settings validates the
    // raw value at registration time, and alpha.2 hosts removed the runtime
    // settingsNamespace() helper, so a branded value would be a missing named
    // export there while older hosts keep the same behavior.
    const scope = settings.register?.(
      ns as SettingsNamespace,
      z.object({
        followSystem: z.boolean(),
        showGlyph: z.boolean(),
        showClock: z.boolean(),
        showTurns: z.boolean(),
        statusScope: z.union(['pink-only', 'all-themes'] as const),
        statusGlyph: z.string(),
        statusSeparator: z.string(),
      }),
    )
    if (scope === undefined) throw new Error('the settings service exposes no register()')
    // Own the watcher on the inject-scoped ledger so it survives exactly as
    // long as this activation (scope.watch's disposer is otherwise leaked).
    const emit = (doc: unknown): void => {
      wiring.onDoc(definedOnly(doc))
    }
    settingsCtx.effect(() => {
      emit(scope.get())
      return scope.watch(emit)
    })
  } catch (error) {
    // Contained, but never silent: swallowing the provider's error is what
    // made the ≥0.1.7 transition surface as a bare `命名空间未注册` badge with
    // no line in the log to explain it.
    settingsCtx.logger.warn(
      `dsh-tui-theme: settings namespace registration failed: ${String(error)}`,
    )
  }
}

/**
 * Explain the two ways a ≥0.1.7 host can leave this card unserved, instead of
 * letting `命名空间未注册` be the only clue (the diagnosis cost of dsh-TUI #990).
 * Both are warnings, not failures: the row config and every other seam keep
 * working.
 */
function diagnoseConfigGeneration(ctx: Context, ns: string, hasLiveFields: boolean): void {
  const entryId = loaderEntryId(ctx)
  if (entryId !== undefined && entryId !== ns) {
    ctx.logger.warn(
      `dsh-tui-theme: the settings service keys namespaces by Loader entry id "${entryId}", which is not a valid section namespace — the settings card cannot be served; rename the plugin row to a lowercase kebab-case id`,
    )
  }
  if (!hasLiveFields) {
    ctx.logger.warn(
      'dsh-tui-theme: no row-config field carries the live marker — this host cannot serve the settings card (needs a schemastery that accepts volatile fields); the row config keeps working',
    )
  }
}

/**
 * ≥0.1.7 generation: the namespace is this profile entry and its form schema is
 * the marked slice of `Config`, so there is nothing to register. The card is
 * the plugin's own page, so opt out of the auto-generated one; the policy must
 * be attached to the plugin's own fiber (the entry that owns the Config), not
 * to the injected child.
 */
function configureOwnPage(ctx: Context, settingsCtx: Context, settings: SettingsServiceLike): void {
  try {
    const dispose = settings.configure?.({ auto: false }, ctx.fiber)
    if (typeof dispose === 'function') {
      const stop = dispose as () => void
      settingsCtx.effect(() => stop)
    }
  } catch (error) {
    // Decorative: the card renders and saves either way; a future
    // auto-generated page would merely duplicate it. `configure` throws when
    // this fiber already registered a policy (a second inject pass).
    settingsCtx.logger.info(`dsh-tui-theme: settings page policy not applied (${String(error)})`)
  }
}

/**
 * Follow the loader's live-config announcements.
 *
 * The *listener* registers on the plugin's own context: the loader emits
 * `loader/volatile-update` on the Config-owning fiber and `Context.filter`
 * delivers it to that fiber alone, which is the same reason the host's compat
 * shim passes the Config owner rather than the injected child.
 *
 * Its *disposal*, however, belongs to the inject child (`owner`). This body
 * runs once per settings-service arrival, in a fiber cordis recycles, while the
 * plugin fiber outlives every pass: an effect owned by the plugin would let a
 * second pass stack a second listener on top of the first (each event then
 * re-reading the config twice). Without the event the initial read stands for
 * the session — logged, because that means `/settings` edits would not reach
 * the running plugin until it reloads.
 */
function watchLiveConfig(ctx: Context, owner: Context, wiring: PinkSettingsWiring): void {
  const refresh = (): void => {
    wiring.onDoc(definedOnly(wiring.readLive()))
  }
  const events = ctx as unknown as { on?: (event: string, listener: () => void) => unknown }
  let dispose: unknown
  try {
    dispose = events.on?.('loader/volatile-update', refresh)
  } catch {
    dispose = undefined
  }
  if (typeof dispose !== 'function') {
    ctx.logger.info(
      'dsh-tui-theme: loader/volatile-update is unavailable; /settings edits apply at the next plugin reload',
    )
    return
  }
  // `ctx.on` already ties the listener to the plugin fiber (cordis's own
  // effect inside `Context.on`); this one exists for the recycled inject child,
  // so it must run on that child's ledger rather than the plugin's.
  owner.effect(() => dispose as () => void)
}

function joinHomeDataDir(): string {
  return join(homeDir(), '.dsh-tui')
}

/** Draft gate shared by the two ornament fields (see ornament.ts). */
function ornamentParse(text: string): TuiSettingsFieldWrite | undefined {
  const draft = parseOrnamentDraft(text)
  if (draft === undefined) return undefined
  return draft.kind === 'clear' ? { kind: 'clear' } : { kind: 'set', value: draft.value }
}

/** The cached follow result as a date (undefined when absent/invalid). */
function followCacheDate(at: unknown): string | undefined {
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The declarative /settings block (labels bilingual, zh via descriptions). */
function sectionDefinition(
  ns: string,
  cordis: StatusOptions & { followSystem?: boolean },
  dataDir: string,
): TuiSettingsSection {
  return {
    ns,
    title: 'pink-theme',
    descriptions: { zh: 'pink-theme' },
    groups: [
      { id: 'follow', title: 'Background follow', descriptions: { zh: '背景跟随' } },
      { id: 'status-line', title: 'Status line', descriptions: { zh: '状态行' } },
    ],
    fields: [
      {
        path: ['followSystem'],
        group: 'follow',
        label: 'Apply saved terminal background',
        descriptions: { zh: '应用上次保存的终端背景' },
        hint: 'Apply a previously saved terminal background result at startup. dsh-TUI does not expose a safe plugin query, so this plugin does not refresh the cache.',
        hintDescriptions: {
          zh: '启动时应用此前保存的终端背景结果。dsh-TUI 未提供安全的插件查询接缝，因此本插件不会刷新该缓存。',
        },
        kind: 'boolean',
        format: (value: unknown): string => {
          const on = typeof value === 'boolean' ? value : (cordis.followSystem ?? false)
          if (!on) return 'off'
          // A low-frequency, synchronous read of a tiny file on the settings
          // screen only (never on the render path), putting the "toggled on,
          // nothing happened" reason on the surface: the state of the cache
          // this startup would consult.
          const cache = readFollowCache(dataDir)
          if (cache === undefined) return 'on（无缓存，启动时不动）'
          const day = followCacheDate(cache.at)
          return `on（缓存: ${cache.light ? 'light' : 'dark'}${day === undefined ? '' : ` · ${day}`}）`
        },
      },
      {
        path: ['showGlyph'],
        group: 'status-line',
        label: 'Blossom ✿',
        descriptions: { zh: '花符 ✿' },
        hint: 'Lead the decorative line above the prompt with ✿.',
        hintDescriptions: { zh: '输入框上方装饰行的开头花符。' },
        kind: 'boolean',
        format: (value: unknown): string => String(value ?? cordis.showGlyph),
      },
      {
        path: ['statusGlyph'],
        group: 'status-line',
        label: 'Blossom glyph',
        descriptions: { zh: '花符字符' },
        hint: 'The character leading the decorative line. 1–2 display cells, no control characters; empty resets to the default.',
        hintDescriptions: {
          zh: '装饰行开头的字符。支持 1–2 个显示单元，不接受控制字符；留空恢复默认。',
        },
        kind: 'text',
        placeholder: '✿',
        format: (value: unknown): string =>
          typeof value === 'string' && value !== '' ? value : String(cordis.statusGlyph ?? '✿'),
        parse: ornamentParse,
      },
      {
        path: ['showClock'],
        group: 'status-line',
        label: 'Clock',
        descriptions: { zh: '时钟' },
        kind: 'boolean',
        format: (value: unknown): string => String(value ?? cordis.showClock),
      },
      {
        path: ['showTurns'],
        group: 'status-line',
        label: 'Turn count',
        descriptions: { zh: '轮数' },
        hint: 'Turns of the live session counted since the TUI started.',
        hintDescriptions: { zh: '自本次启动以来当前会话的轮数。' },
        kind: 'boolean',
        format: (value: unknown): string => String(value ?? cordis.showTurns),
      },
      {
        path: ['statusSeparator'],
        group: 'status-line',
        label: 'Separator',
        descriptions: { zh: '分隔符' },
        hint: 'The character between the line’s cells. 1–2 display cells, no control characters; empty resets to the default.',
        hintDescriptions: {
          zh: '装饰行各段之间的分隔字符。支持 1–2 个显示单元，不接受控制字符；留空恢复默认。',
        },
        kind: 'text',
        placeholder: '·',
        format: (value: unknown): string =>
          typeof value === 'string' && value !== '' ? value : String(cordis.statusSeparator ?? '·'),
        parse: ornamentParse,
      },
      {
        path: ['statusScope'],
        group: 'status-line',
        label: 'Status line display',
        descriptions: { zh: '状态行展示' },
        hint: 'The blossom line is exclusive to the pink palettes by default; all-themes keeps it visible under other themes.',
        hintDescriptions: {
          zh: '状态行默认为樱花粉主题专属；所有主题时在其他主题下同样显示。',
        },
        kind: 'select',
        options: [
          { value: 'pink-only', label: 'Pink themes only', descriptions: { zh: '樱花粉主题' } },
          { value: 'all-themes', label: 'All themes', descriptions: { zh: '所有主题' } },
        ],
        format: (value: unknown): string =>
          typeof value === 'string' ? value : (cordis.statusScope ?? 'pink-only'),
      },
    ],
  }
}
