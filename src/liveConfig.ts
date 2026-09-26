/**
 * The live-editable slice of the plugin's row config — the support the
 * `dsh-settings` ≥0.1.7 generation needs (dsh-TUI 0.11+) while the ≤0.1.6
 * generation keeps working unchanged.
 *
 * Two host generations read the same {@link Config} differently, and both must
 * keep working (docs/decisions/… in the dsh-tui-find repo,
 * `2026-09-24-settings-generation-adaptation.md`, is the reference record):
 *
 * - `dsh-settings` ≤0.1.6 (dsh-TUI 0.9.x/0.10.x): the `/settings` namespace is
 *   registered by the plugin and its form values come from that registration
 *   schema (settingsSection.ts). The row config is a frozen value.
 * - `dsh-settings` ≥0.1.7 (dsh-TUI 0.11+): there is no registration API — the
 *   namespace is the profile entry id and the form schema is *this* schema
 *   projected onto the fields carrying the volatile marker. Those fields then
 *   reach `apply` as live refs whose value the loader rewrites in place, so
 *   every read goes through {@link readConfigValues} first.
 *
 * `.volatile()` landed in schemastery 3.18.3 while this plugin's baseline is
 * 3.18.1/3.18.2, hence the capability probe in {@link liveField} — never a
 * version parse. A plugin that misses the transition still boots, still
 * registers its card, and simply renders `命名空间未注册`; a card field whose
 * Config key is not marked renders `（未设置）` forever. Both are silent, which
 * is why the marking is driven by one exported key list (the card↔schema
 * parity is asserted in scripts/verify.mjs and
 * scripts/verify-settings-generation.mjs).
 *
 * @module dsh-tui-theme/liveConfig
 */

/**
 * Keys the `/settings` card owns, and therefore the keys the host may edit
 * live. On `dsh-settings` ≥0.1.7 these are exactly the fields the plugin's
 * form projects, so the card's field paths, this list and the marked fields
 * must stay equal — a card field outside the list would render editable yet
 * never be served (the host's own status-bar `cost` field shows that failure
 * mode as `（未设置）` forever), and a marked key without a field would be
 * live-editable with no UI. `autoInstallThemes` / `statusEnabled` are
 * deliberately absent: they stay cordis-config knobs (README §配置).
 */
export const LIVE_CONFIG_KEYS = [
  'followSystem',
  'showGlyph',
  'statusGlyph',
  'showClock',
  'showTurns',
  'statusSeparator',
  'statusScope',
] as const

/** Whether one row-config key is part of the card's editable set. */
export function isLiveConfigKey(key: string): boolean {
  return (LIVE_CONFIG_KEYS as readonly string[]).includes(key)
}

/**
 * Mark one schema field live-editable when the host can project it.
 *
 * Two capability steps, never a version parse:
 *
 * 1. `.volatile()` — schemastery 3.18.3+; returns a marked clone and runs the
 *    framework's own volatile validation, so it is preferred wherever it
 *    exists.
 * 2. `meta.volatile = true` — the settings projection only reads that plain
 *    meta field, so writing it directly works on the 3.18.1/3.18.2 baselines
 *    too. This is the fallback dsh-TUI shipped for its own Config after issue
 *    #990 (its `editableConfig` silently no-opped on older schemastery and the
 *    whole settings page went dead on a 0.1.7 host).
 *
 * Calling `.volatile()` twice throws, so the marker is applied exactly once,
 * from the single {@link LIVE_CONFIG_KEYS} list. A schemastery that froze its
 * `meta` leaves the field unmarked (a dead card, but no boot failure — the
 * host's own choice for third-party plugins).
 */
export function liveField<T>(field: T): T {
  const candidate = field as T & { volatile?: () => T; meta?: { volatile?: unknown } }
  if (typeof candidate.volatile === 'function') return candidate.volatile()
  const meta = candidate.meta
  if (typeof meta === 'object' && meta !== null) {
    try {
      meta.volatile = true
    } catch {
      return field
    }
  }
  return field
}

/**
 * Read a row config down to plain values.
 *
 * On `dsh-settings` ≥0.1.7 (schemastery ≥3.18.3) the loader hands every
 * volatile field to `apply` as a live ref — a frozen object carrying the
 * cosmokit Volatile protocol whose value the loader rewrites in place — so
 * reading the config object again after `loader/volatile-update` yields the
 * edited values (settingsSection.ts rides exactly that). Structural, not an
 * import: the refs are cosmokit's Volatile protocol and cosmokit is not a
 * dependency of this plugin. The row config is flat, so one unwrap level per
 * key is enough; a nested knob would need a recursive walk here.
 */
export function readConfigValues<T extends object>(config: T | undefined): T {
  const plain: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config ?? {})) plain[key] = readRef(value)
  return plain as T
}

/**
 * The cosmokit Volatile brand, read by name so it matches the host's own copy
 * across module instances (`cosmokit/src/volatile.ts`). Absent from the
 * schemastery 3.18.1/3.18.2 generations this plugin also supports — probing it
 * is a plain symbol lookup, never a version parse, and the shape fallback
 * below still covers a hand-rolled ref.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Unwrap one live config ref, if that is what it is.
 *
 * The protocol brand (`cosmokit.volatile.write` in the value, exactly what
 * `isVolatile` checks) is authoritative and is probed FIRST: a real ref may
 * legitimately carry more than the `get` key, and the shape heuristic below
 * would then hand the ref object itself to the caller, which reads it as "not
 * a string/boolean" and silently falls back to the documented default — no
 * warning, no error. The shape check stays as a fallback for a ref built
 * without the brand.
 */
function readRef(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const ref = value as { get?: unknown }
  const branded = VOLATILE_WRITE in value
  if (!branded) {
    const keys = Object.keys(value)
    if (keys.length !== 1 || keys[0] !== 'get') return value
  }
  return typeof ref.get === 'function' ? readRef((ref.get as () => unknown)()) : value
}

/**
 * Whether a row-config schema carries the live marker anywhere — exactly what
 * a `dsh-settings` ≥0.1.7 host needs to serve this plugin's `/settings` page
 * (`volatileForm()` returns undefined without it and the entry never reaches
 * `describe()`, which the TUI renders as `命名空间未注册`).
 *
 * Read structurally: the schemastery 3.18.1/3.18.2 types this repo builds
 * against do not expose `.dict` on the schema type, and the caller owns the
 * schema. settingsSection.ts warns with this when a new-generation host cannot
 * serve the card, instead of leaving a bare badge as the only clue.
 */
export function hasLiveConfigFields(schema: unknown): boolean {
  const dict = (schema as { dict?: Record<string, { meta?: { volatile?: unknown } } | undefined> } | undefined)
    ?.dict
  return Object.values(dict ?? {}).some(field => field?.meta?.volatile === true)
}
