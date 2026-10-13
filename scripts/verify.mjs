/**
 * Hermetic verification for dsh-tui-theme (no TTY, no real HOME).
 *
 * 0.8 scope: the package ships no themes any more. The pink family
 * (pink-night / pink-day / pink-ansi) is a dsh-TUI built-in since the upstream
 * merge, so this plugin keeps only the blossom status line, the /settings card
 * and the one-shot toast about leftover ≤0.7.x theme files. Beyond the features
 * themselves the suite pins the two invariants the handover depends on:
 *
 *  1. the plugin never writes into the host's data directory — the single
 *     exception is the migration-notice marker, written once and only after a
 *     notice actually reached the host's toast sink while a legacy pink-* file
 *     was there (scenarios 11, 12 and 17);
 *  2. it never registers a theme, installs a theme file, or repairs one, even
 *     when a runtime theme service is present (scenario 17).
 *
 * Points HOME/USERPROFILE at a throwaway sandbox BEFORE importing anything
 * (the same technique the host's scripts/verify-themes.mjs uses), then walks
 * the seams the plugin still consumes: tuiStatus (scalar and rich paths),
 * tuiSettingsSections + settings (both dsh-settings generations), tuiToast.
 *
 * Run with: npm run verify   (after npm run build)
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { assertSettingsContract, SETTINGS_FIELDS } from './expected-settings-contract.mjs'

const sandboxHome = mkdtempSync(join(tmpdir(), 'pink-status-verify-'))
const originalThemeOverride = process.env.DSH_TUI_THEME
const restoreThemeOverride = () => {
  if (originalThemeOverride === undefined) {
    delete process.env.DSH_TUI_THEME
  } else {
    process.env.DSH_TUI_THEME = originalThemeOverride
  }
}
delete process.env.DSH_TUI_THEME
process.once('exit', restoreThemeOverride)
process.env.USERPROFILE = sandboxHome
process.env.HOME = sandboxHome

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const builtinFs = require('node:fs')
const sandboxData = join(sandboxHome, '.dsh-tui')
const sandboxThemes = join(sandboxData, 'themes')
const NOTICE_FILE = 'theme-plugin-notice.json'

const { name, apply, Config } = await import('../lib/types/index.js')
const { LIVE_CONFIG_KEYS, hasLiveConfigFields, readConfigValues } = await import('../lib/types/liveConfig.js')
const { resolveSettingsNamespace, SETTINGS_NS } = await import('../lib/types/settingsSection.js')
const { startStatusLine, invalidateThemePrefCacheForTests } = await import('../lib/types/statusLine.js')
const { setToastRetryDelaysForTests } = await import('../lib/types/toast.js')
const { readThemePref } = await import('../lib/types/themePref.js')
const { statusColorsFor } = await import('../lib/types/palette.js')
const { findLegacyThemeFiles } = await import('../lib/types/legacyNotice.js')
const { displayCells } = await import('../lib/types/ornament.js')

assert.equal(name, 'dsh-tui-theme')
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const applyAndSettle = async (ctx, config) => {
  apply(ctx, config)
  await settle()
}

/** The host's persisted theme preference, written the way the host writes it. */
const setActiveTheme = theme => {
  mkdirSync(sandboxData, { recursive: true })
  if (theme === undefined) rmSync(join(sandboxData, 'theme.json'), { force: true })
  else writeFileSync(join(sandboxData, 'theme.json'), JSON.stringify({ theme }, null, 2))
  invalidateThemePrefCacheForTests()
}

/** A stub Cordis-like context; every seam optional and recorded. */
function makeStubCtx({ status, sections, settingsService, themes, toast, entryId, deferToast = false } = {}) {
  const record = { handlers: new Map(), disposers: [], statusCalls: [], sectionsCalls: [], registerCalls: [], watchers: [], warnings: [], infos: [], children: {}, injectRequests: new Map() }
  let availableToast = toast
  const deferredToastCallbacks = []
  const logger = { info: msg => record.infos.push(String(msg)), warn: msg => record.warnings.push(String(msg)), error: () => {} }
  const serviceFor = dep => ({
    settings: settingsService,
    tuiStatus: status,
    tuiSettingsSections: sections,
    tuiThemes: themes,
    tuiToast: availableToast,
  })[dep]
  const base = {
    logger,
    // The Loader entry the host reports for this row: the ≥0.1.7 namespace
    // and the owner of the Config the page policy must attach to.
    fiber: entryId === undefined ? undefined : { entry: { options: { id: entryId } } },
    get(serviceName) {
      if (serviceName === 'tuiStatus') return status
      if (serviceName === 'tuiSettingsSections') return sections
      if (serviceName === 'tuiThemes') return themes
      if (serviceName === 'tuiToast') return availableToast
      return undefined
    },
    on(event, handler) {
      const list = record.handlers.get(event) ?? []
      list.push(handler)
      record.handlers.set(event, list)
      // Like the real `ctx.on`: the returned disposer unregisters the listener.
      return () => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') record.disposers.push(dispose)
    },
    inject(deps, callback) {
      // Simulate cordis: the callback runs once every requested service
      // exists (immediately here), and property access works inside it. The
      // request is remembered so a scenario can replay the body the way a
      // service reload does — fresh child fiber, previous one recycled.
      const key = deps.join('+')
      const props = () => Object.fromEntries(deps.map(dep => [dep, serviceFor(dep)]))
      const run = () => callback(childCtx(props(), key))
      if (deferToast && availableToast === undefined && deps.includes('tuiToast')) {
        deferredToastCallbacks.push(() => {
          record.injectRequests.set(key, run)
          run()
        })
        return
      }
      if (deps.every(dep => serviceFor(dep) !== undefined)) {
        record.injectRequests.set(key, run)
        run()
      }
    },
  }
  /**
   * An `inject` child context, as cordis creates one per body run: its own
   * effect ledger, disposed when the fiber is recycled (a service arriving
   * again). Disposers also land in `record.disposers`, so a scenario's flat
   * "disposal never throws" sweep still reaches them.
   */
  const childCtx = (props, key) => {
    const effects = []
    const child = {
      ...base,
      ...props,
      effect(factory) {
        const dispose = factory()
        if (typeof dispose === 'function') {
          effects.push(dispose)
          record.disposers.push(dispose)
        }
      },
      dispose() {
        for (const dispose of effects.splice(0)) dispose()
      },
    }
    if (key !== undefined) (record.children[key] ??= []).push(child)
    return child
  }
  /** Disposes the children of one `inject` request and replays its body. */
  record.reinject = key => {
    const replay = record.injectRequests.get(key)
    if (replay === undefined) throw new Error(`no inject request recorded for "${key}"`)
    for (const child of (record.children[key] ?? []).splice(0)) child.dispose()
    replay()
  }
  record.activateToast = service => {
    availableToast = service
    for (const run of deferredToastCallbacks.splice(0)) run()
  }
  return { ctx: base, record }
}

const fakeStatus = calls => ({ set(key, text) { calls.push([key, text]); return () => {} } })
/**
 * A 0.10.1+ status service: registerView present. `refuse` simulates the
 * host rejecting the registration (returns undefined, warning invisible);
 * `throws` simulates a hostile service whose registration throws — the
 * plugin must warn and fall back, never propagate.
 */
const fakeRichStatus = (calls, viewCalls, { refuse = false, throws = false } = {}) => ({
  set(key, text) { calls.push([key, text]); return () => {} },
  registerView(descriptor, identity) {
    viewCalls.push([descriptor, identity])
    if (throws) throw new Error('status view registry unavailable')
    if (refuse) return undefined
    return () => {}
  },
})
const fakeSections = calls => ({ register(section) { calls.push(section); return () => {} } })
/** A runtime theme service, present so the "never registers" invariant bites. */
const fakeThemes = registers => ({
  register(descriptor, identity) {
    registers.push([descriptor, identity])
    return () => {}
  },
})
const fakeSettingsService = (record, doc) => ({
  register(namespace, schema) {
    // Called as a method, never as a detached reference: the real provider's
    // register() reads its own state, so losing `this` throws there. ESM is
    // strict, so a detached call sees `this === undefined`.
    if (this === undefined) throw new Error('register() lost its receiver')
    record.registerCalls.push([namespace, schema])
    return {
      get: () => doc,
      watch(listener) { record.watchers.push(listener); return () => {} },
    }
  },
})
/**
 * A `dsh-settings` ≥0.1.7 service: no `register` at all, a per-instance page
 * policy instead. The values do not come from here — they are the plugin's own
 * live Config (liveConfig.readConfigValues), which the loader rewrites in
 * place. The owner fiber is recorded so the scenario can assert the policy
 * landed on the Config-owning plugin fiber, never the inject child.
 */
const fakeConfigSettingsService = record => ({
  configure(presentation, owner) {
    if (this === undefined) throw new Error('configure() lost its receiver')
    record.configureCalls.push([presentation, owner])
    return () => {}
  },
})
/** The cosmokit Volatile protocol: a frozen branded ref whose value the loader
 *  rewrites (`Symbol.for('cosmokit.volatile.write')`; `extra` models a ref
 *  carrying more than `get`). `read` is a thunk so a scenario can model the
 *  in-place rewrite. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')
const liveRef = (read, extra) => Object.freeze({ get: read, [VOLATILE_WRITE]: () => {}, ...extra })
/** Records delivered toasts; the first `dropFirst` shows are dropped (no sink yet). */
const fakeToast = (deliveries, { dropFirst = 0 } = {}) => {
  let shown = 0
  return {
    show(text, options) {
      shown += 1
      if (shown <= dropFirst) return false
      deliveries.push([String(text), options?.color])
      return true
    },
  }
}

const emit = (record, event, ...args) => {
  for (const handler of record.handlers.get(event) ?? []) handler(...args)
}
/** Wait for a delivery that a retry chain owes us. */
const waitFor = async predicate => {
  const deadline = Date.now() + 2_000
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

// ── 1. bare host: no seam present → nothing happens, nothing is written ─────
{
  const { ctx, record } = makeStubCtx()
  apply(ctx)
  assert.deepEqual(record.warnings, [])
  assert.equal(record.handlers.size, 0, 'no event handlers without the status seam')
  assert.deepEqual(readdirSync(sandboxHome), [], 'a seam-less host must not be touched at all')
  console.log('✓ bare host (no seams): silent no-op, not a single file written')
}

// ── 2. full host: status line, settings card and the ≤0.1.6 namespace ───────
{
  setActiveTheme('pink-night')
  const statusCalls = []
  const sectionsCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    sections: fakeSections(sectionsCalls),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)

  // Status line: one keyed contribution with glyph · clock.
  assert.equal(statusCalls.length > 0, true)
  const [key, first] = statusCalls[0]
  assert.equal(key, 'dsh-tui-theme')
  assert.match(first, /^✿ · \d{2}:\d{2}$/)

  // Turns counted from session events (live, no log appends).
  const session = { id: 's1' }
  emit(record, 'session/event', session, { type: 'turn/end' })
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 2✦$/)

  // Settings namespace registered and the section declaration remains within
  // the shared host form contract.
  assert.equal(settingsRecord.registerCalls.length, 1)
  // The registration schema is the ≤0.1.6 host's only field list, and it is
  // hand-written (settingsSection.registerNamespaceScope) — the one place the
  // card's keys are not derived from LIVE_CONFIG_KEYS. Set equality keeps the
  // "one editable surface" invariant true across both generations: a key added
  // to LIVE_CONFIG_KEYS alone would render and save on a ≥0.1.7 card and be
  // silently unpersistable on an old host.
  assert.deepEqual(
    Object.keys(settingsRecord.registerCalls[0][1].dict).sort(),
    [...LIVE_CONFIG_KEYS].sort(),
    'the ≤0.1.6 namespace schema and LIVE_CONFIG_KEYS must stay equal',
  )
  assert.equal(sectionsCalls.length, 1)
  assertSettingsContract(assert, sectionsCalls[0])

  // A committed /settings edit lands live on the next render.
  for (const watcher of settingsRecord.watchers) {
    watcher({ showGlyph: false, showClock: false })
  }
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^3✦$/)

  // The plugin never wrote into the host's data directory: the pref the test
  // planted is still the only file there.
  assert.deepEqual(readdirSync(sandboxData), ['theme.json'], 'no theme file, no marker, no cache')

  // Disposal never throws.
  for (const dispose of record.disposers) dispose()
  console.log('✓ full host: status line live, settings wired, nothing written')
}

// ── 3. live-config marking: the card and the marked Config keys are one set ─
{
  // The marker is what a ≥0.1.7 host projects (`volatileForm`), and the card's
  // field paths are what it serves; set equality both ways is the invariant
  // that keeps a field from rendering editable while nothing serves it (or a
  // marked key editable with no UI). This repo's schemastery is the 3.18.2
  // baseline with no `.volatile()`, so this also pins the `meta` fallback a
  // plugin resolving an old copy depends on (the病根 of dsh-TUI #990).
  const dict = Config.dict
  assert.equal(hasLiveConfigFields(Config), true, 'the shipped Config carries the live marker')
  for (const key of LIVE_CONFIG_KEYS) {
    assert.equal(dict[key]?.meta?.volatile, true, `${key} must be marked live`)
  }
  assert.equal(dict.statusEnabled?.meta?.volatile, undefined, 'statusEnabled stays a cordis-only knob')
  assert.equal(dict.autoInstallThemes, undefined, 'the theme knobs are gone, not merely unmarked')
  assert.equal(dict.followSystem, undefined, 'the follow knob is gone with the theme half')
  assert.deepEqual(
    SETTINGS_FIELDS.map(([path]) => path.join('.')).sort(),
    [...LIVE_CONFIG_KEYS].sort(),
    'the card fields and LIVE_CONFIG_KEYS must stay equal',
  )

  // Unwrapping: the protocol brand is the authority (a ref may carry extra
  // keys), a bare `{ get }` stays a fallback, and plain values pass through.
  assert.deepEqual(
    readConfigValues({
      statusGlyph: liveRef(() => '❀', { id: 'live-1' }),
      showClock: liveRef(() => true),
      showTurns: { get: () => false },
      statusScope: 'all-themes',
    }),
    { statusGlyph: '❀', showClock: true, showTurns: false, statusScope: 'all-themes' },
  )
  assert.deepEqual(readConfigValues(undefined), {})

  // Namespace resolution: the Loader entry id when it fits the section
  // grammar, the documented constant otherwise (both generations agree).
  assert.equal(SETTINGS_NS, 'dsh-tui-theme')
  const withEntry = id => ({ fiber: { entry: { options: { id } } } })
  assert.equal(resolveSettingsNamespace(withEntry('custom-theme')), 'custom-theme')
  assert.equal(resolveSettingsNamespace(withEntry('Custom.TUI')), SETTINGS_NS)
  assert.equal(resolveSettingsNamespace({}), SETTINGS_NS)
  console.log('✓ live config: meta marking, card↔key parity, ref unwrapping, namespace fallback')
}

// ── 4. dsh-settings ≥0.1.7: the card is fed by the live Config ─────────────
{
  setActiveTheme('pink-night')
  const statusCalls = []
  const sectionsCalls = []
  const settingsRecord = { registerCalls: [], configureCalls: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    sections: fakeSections(sectionsCalls),
    settingsService: fakeConfigSettingsService(settingsRecord),
    entryId: 'dsh-tui-theme',
  })
  // Apply-time shape of a ≥0.1.7 host: the marked fields arrive as live refs
  // (one of them carrying an extra key — the shape the brand probe exists
  // for), the cordis-only knob as a plain value. The thunks model the loader's
  // in-place rewrite.
  const live = { glyph: '❀', clock: false }
  await applyAndSettle(ctx, {
    statusEnabled: true,
    statusGlyph: liveRef(() => live.glyph, { id: 'live-1' }),
    statusSeparator: '·',
    showGlyph: liveRef(() => true),
    showClock: liveRef(() => live.clock),
    showTurns: false,
    statusScope: 'pink-only',
  })

  assert.equal(sectionsCalls.length, 1, 'the card registers exactly once')
  assert.equal(sectionsCalls[0].ns, 'dsh-tui-theme', 'the card follows the Loader entry id')
  assertSettingsContract(assert, sectionsCalls[0])
  assert.equal(settingsRecord.registerCalls.length, 0, 'no namespace registration on the ≥0.1.7 generation')
  assert.deepEqual(
    settingsRecord.configureCalls,
    [[{ auto: false }, ctx.fiber]],
    'the auto page is declined on the Config-owning plugin fiber',
  )
  assert.deepEqual(record.warnings, [], 'a healthy ≥0.1.7 host warns about nothing')
  assert.equal(
    (record.handlers.get('loader/volatile-update') ?? []).length,
    1,
    'the volatile event is followed on the plugin context',
  )

  // Unwrapped refs feed the line: a raw ref fails the string check and would
  // show the cordis default glyph instead of the configured one.
  assert.equal(statusCalls.at(-1)[1], '❀')

  // The loader rewrites the ref and announces it: the edit lands on the next
  // render without a reload.
  live.clock = true
  emit(record, 'loader/volatile-update', [['showClock']])
  emit(record, 'session/event', { id: 'n1' }, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^❀ · \d{2}:\d{2}$/, 'a volatile update re-reads the edited config')

  for (const dispose of record.disposers) dispose()
  console.log('✓ settings ≥0.1.7: Config-derived card on the plugin fiber, live refs unwrapped, volatile update re-read')
}

// ── 5. ≥0.1.7 degradation is diagnosed, never a bare badge ─────────────────
{
  // A settings service with neither surface (an unrecognized generation): one
  // info line, and the card still registers.
  const sectionsCalls = []
  const bare = makeStubCtx({
    sections: fakeSections(sectionsCalls),
    settingsService: {},
    entryId: 'dsh-tui-theme',
  })
  await applyAndSettle(bare.ctx)
  assert.deepEqual(bare.record.warnings, [])
  assert.equal(
    bare.record.infos.some(line => line.includes('neither the namespace registration')),
    true,
    'the missing surface is explained',
  )
  assert.equal(sectionsCalls.length, 1, 'the card still registers')

  // A Loader entry id the section grammar rejects: the host keys by that id,
  // so warn and fall back to the constant for the card and the registration.
  const fallbackCalls = []
  const fallbackRecord = { registerCalls: [], configureCalls: [] }
  const invalid = makeStubCtx({
    sections: fakeSections(fallbackCalls),
    settingsService: fakeConfigSettingsService(fallbackRecord),
    entryId: 'Custom.TUI',
  })
  await applyAndSettle(invalid.ctx)
  assert.equal(fallbackCalls[0].ns, 'dsh-tui-theme', 'an unusable entry id falls back to the constant')
  assert.equal(
    invalid.record.warnings.some(line => line.includes('Loader entry id')),
    true,
    'the entry-id mismatch is warned about',
  )
  assert.equal(fallbackRecord.configureCalls.length, 1, 'the page policy is still attempted')
  console.log('✓ settings degradation: missing surface and unusable entry id are diagnosed')
}

// ── 6. settings service reload: the volatile listener is never stacked ─────
{
  // `ctx.inject()` runs its body in a fiber cordis recycles when the service
  // arrives again (a settings reload, an isolate/plugin restart). The listener
  // itself must live on the plugin's own context — that is where the loader
  // delivers `loader/volatile-update` — but a disposer owned there survives the
  // recycling and lets the second pass add a second listener, so every later
  // event re-reads the config twice.
  setActiveTheme('pink-night')
  const settingsRecord = { registerCalls: [], configureCalls: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus([]),
    settingsService: fakeConfigSettingsService(settingsRecord),
    entryId: 'dsh-tui-theme',
  })
  let glyphReads = 0
  await applyAndSettle(ctx, {
    statusEnabled: true,
    statusGlyph: liveRef(() => { glyphReads += 1; return '✿' }),
    statusSeparator: '·',
    showGlyph: liveRef(() => true),
    showClock: liveRef(() => true),
    showTurns: false,
    statusScope: 'pink-only',
  })
  const listeners = () => (record.handlers.get('loader/volatile-update') ?? []).length
  assert.equal(listeners(), 1, 'the first pass registers exactly one listener')

  record.reinject('settings')
  assert.equal(listeners(), 1, 'a second inject pass must not stack a listener')
  const before = glyphReads
  emit(record, 'loader/volatile-update', [['statusGlyph']])
  assert.equal(glyphReads - before, 1, 'one event must drive exactly one re-read')

  for (const dispose of record.disposers) dispose()
  console.log('✓ settings reload: the inject child is recycled, the volatile listener is not duplicated')
}

// ── 7. statusEnabled: false silences the whole line ────────────────────────
{
  const statusCalls = []
  const { ctx } = makeStubCtx({ status: fakeStatus(statusCalls) })
  await applyAndSettle(ctx, { statusEnabled: false })
  assert.equal(statusCalls.length > 0, true, 'render still ran once')
  // Every contribution is cleared (undefined), not rendered.
  for (const [, text] of statusCalls) assert.equal(text, undefined)
  console.log('✓ statusEnabled=false: the line contributes nothing')
}

// ── 8. theme gating: the line belongs to the built-in pink palettes ────────
{
  setActiveTheme('pink-night')
  const statusCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)
  const session = { id: 'g1' }

  // Pink active → renders.
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 1✦$/)

  // Non-pink theme active → hidden by default. The pref cache is dropped so
  // the rewrite is visible immediately (production invalidation is the TTL).
  setActiveTheme('dark')
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.equal(statusCalls.at(-1)[1], undefined)

  // Opt in via /settings → shown on non-pink too (the turn count kept
  // ticking while the line was hidden — turns count since the TUI started).
  for (const w of settingsRecord.watchers) w({ statusScope: 'all-themes' })
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 3✦$/)

  // Host precedence: DSH_TUI_THEME wins over the dark pref.
  const baselineThemeOverride = process.env.DSH_TUI_THEME
  try {
    process.env.DSH_TUI_THEME = 'pink-day'
    for (const w of settingsRecord.watchers) w({})
    emit(record, 'session/event', session, { type: 'turn/end' })
    assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 4✦$/)
  } finally {
    if (baselineThemeOverride === undefined) {
      delete process.env.DSH_TUI_THEME
    } else {
      process.env.DSH_TUI_THEME = baselineThemeOverride
    }
  }

  // Every pink built-in name is in scope, not just the two the plugin used to
  // install: the family is the host's now.
  const colors = name => statusColorsFor(name)
  assert.notEqual(colors('pink-ansi').glyph, undefined)
  assert.equal(colors('dark').glyph, undefined, 'non-pink palettes stay uncolored')
  assert.equal(colors(undefined).glyph, undefined)
  assert.equal(colors('auto').glyph, undefined)
  console.log('✓ theme gating: pink-only by default, opt-in shows everywhere, host precedence honored')
}

// ── 9. settings service hostility: registration throws → warn, never crash ─
{
  const throwingSettings = {
    register() { throw new Error('namespace already registered (hot reload)') },
  }
  const { ctx, record } = makeStubCtx({ settingsService: throwingSettings })
  await applyAndSettle(ctx) // must not throw
  assert.equal(record.warnings.length, 1, 'registration failure logs one warning')
  assert.match(record.warnings[0], /settings namespace registration failed/)
  console.log('✓ hostile settings service: registration failure warns, never propagates')
}

// ── 10. status injection: session handlers die with tuiStatus activation ───
{
  const outerHandlers = new Map()
  let activate
  const outerCtx = {
    on(event, handler) {
      const handlers = outerHandlers.get(event) ?? []
      handlers.push(handler)
      outerHandlers.set(event, handlers)
      return () => {}
    },
    inject(_deps, callback) { activate = callback },
  }
  const makeActivation = calls => {
    const handlers = new Map()
    const disposers = []
    return {
      tuiStatus: fakeStatus(calls),
      on(event, handler) {
        const eventHandlers = handlers.get(event) ?? []
        eventHandlers.push(handler)
        handlers.set(event, eventHandlers)
        return () => handlers.set(event, eventHandlers.filter(entry => entry !== handler))
      },
      effect(factory) {
        const dispose = factory()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      emit(event, ...args) {
        for (const handler of handlers.get(event) ?? []) handler(...args)
      },
      dispose() {
        handlers.clear()
        for (const dispose of disposers) dispose()
      },
      handlerCount(event) { return (handlers.get(event) ?? []).length },
    }
  }
  const effective = {
    statusEnabled: true,
    statusGlyph: '✿',
    statusSeparator: '·',
    showGlyph: false,
    showClock: false,
    showTurns: true,
    statusScope: 'all-themes',
  }
  setActiveTheme('pink-night')
  startStatusLine(outerCtx, () => effective)

  const firstCalls = []
  const first = makeActivation(firstCalls)
  activate(first)
  assert.equal(outerHandlers.size, 0, 'status activation must not register outer-owned session handlers')
  assert.equal(first.handlerCount('session/event'), 1)
  first.emit('session/event', { id: 'first' }, { type: 'turn/end' })
  assert.equal(firstCalls.at(-1)[1], '1✦')
  first.dispose()
  first.emit('session/event', { id: 'stale' }, { type: 'turn/end' })
  assert.equal(firstCalls.at(-1)[1], '1✦', 'disposed activation ignores later session events')

  const secondCalls = []
  const second = makeActivation(secondCalls)
  activate(second)
  second.emit('session/event', { id: 'second' }, { type: 'turn/end' })
  assert.equal(secondCalls.at(-1)[1], '1✦', 'replacement activation owns the only live handler')
  assert.equal(firstCalls.at(-1)[1], '1✦')
  second.dispose()
  console.log('✓ status lifecycle: session handlers follow tuiStatus activation')
}

// ── 11. toast relay: delivered, dropped-and-retried, seam-less and bounded ─
{
  // Generous retry slots here on purpose: Windows timer coalescing can delay a
  // 0ms macrotask past 5ms, and the chain must still have a slot left for the
  // sink that arrives late (the production delays are [2s, 4s]).
  setToastRetryDelaysForTests([20, 20, 20, 20])
  const themeFile = join(sandboxThemes, 'pink-night.json')
  const seedLegacyFile = () => {
    mkdirSync(sandboxThemes, { recursive: true })
    writeFileSync(themeFile, '{ "name": "pink-night", "colors": {} }')
    rmSync(join(sandboxData, NOTICE_FILE), { force: true })
  }

  // 11a. The toast seam trails apply on a real host (extensions row), so the
  // notice must survive on the bounded retry until the sink shows up — and the
  // marker that keeps later boots quiet must follow that delivery, not the
  // attempt (the failure mode R-005 described: a marker written for a notice
  // nobody could see swallows the one-time notice forever).
  seedLegacyFile()
  const retryDeliveries = []
  const retryContext = makeStubCtx({ deferToast: true })
  await applyAndSettle(retryContext.ctx)
  assert.equal(retryDeliveries.length, 0, 'no sink yet, no delivery')
  assert.equal(
    existsSync(join(sandboxData, NOTICE_FILE)),
    false,
    'a notice that has not landed yet is not recorded',
  )
  retryContext.record.activateToast(fakeToast(retryDeliveries, { dropFirst: 1 }))
  await waitFor(() => retryDeliveries.length > 0)
  assert.equal(retryDeliveries.length, 1, 'a dropped toast is retried and delivered')
  assert.match(retryDeliveries[0][0], /pink-night\.json/)
  assert.equal(retryDeliveries[0][1], undefined, 'the notice is neutral, not an error')
  await waitFor(() => existsSync(join(sandboxData, NOTICE_FILE)))
  assert.equal(
    existsSync(join(sandboxData, NOTICE_FILE)),
    true,
    'the marker follows a notice delivered on a retry',
  )

  // 11b. A sink that never arrives keeps the send bounded: the chain gives up,
  // a late seam must not resurrect an abandoned toast, and no marker may be
  // left behind — that marker is what would swallow the notice for good.
  setToastRetryDelaysForTests([5, 5])
  const lateDeliveries = []
  const lateContext = makeStubCtx({ deferToast: true })
  rmSync(join(sandboxData, NOTICE_FILE), { force: true })
  await applyAndSettle(lateContext.ctx)
  await new Promise(resolve => setTimeout(resolve, 50)) // the [5, 5] chain is long exhausted
  lateContext.record.activateToast(fakeToast(lateDeliveries))
  await settle()
  assert.equal(lateDeliveries.length, 0, 'an abandoned toast is not resurrected by a late seam')
  assert.equal(
    existsSync(join(sandboxData, NOTICE_FILE)),
    false,
    'a notice no sink ever accepted leaves no marker',
  )

  // 11c. Because 11b recorded nothing, the next boot with a working sink still
  // issues the notice: a host upgraded to 0.10+ (and later to the built-in
  // family) hears the one thing this plugin exists to say.
  setToastRetryDelaysForTests([20, 20, 20, 20])
  const nextBootDeliveries = []
  const nextBoot = makeStubCtx({ toast: fakeToast(nextBootDeliveries) })
  await applyAndSettle(nextBoot.ctx)
  assert.equal(nextBootDeliveries.length, 1, 'the boot after a failed notice still delivers it')
  assert.match(nextBootDeliveries[0][0], /pink-night\.json/)
  assert.equal(
    existsSync(join(sandboxData, NOTICE_FILE)),
    true,
    'that delivery records the marker',
  )

  setToastRetryDelaysForTests([2_000, 4_000])
  rmSync(sandboxThemes, { recursive: true, force: true })
  rmSync(join(sandboxData, NOTICE_FILE), { force: true })
  console.log('✓ toast relay: retried until the seam arrives, bounded once it gave up')
}

// ── 12. legacy notice: one toast, one marker, and only for plugin files ────
{
  rmSync(sandboxThemes, { recursive: true, force: true })
  rmSync(join(sandboxData, NOTICE_FILE), { force: true })

  // A user's own theme file is not a migration artifact: foreign names are
  // ignored, and with nothing to report there is no toast and no marker.
  mkdirSync(sandboxThemes, { recursive: true })
  writeFileSync(join(sandboxThemes, 'my-theme.json'), '{ "name": "my-theme", "colors": {} }')
  assert.deepEqual(findLegacyThemeFiles(), [])
  const quietDeliveries = []
  const quietContext = makeStubCtx({ toast: fakeToast(quietDeliveries) })
  await applyAndSettle(quietContext.ctx)
  assert.equal(quietDeliveries.length, 0, 'no legacy file, no notice')
  assert.equal(existsSync(join(sandboxData, NOTICE_FILE)), false, 'no marker without a notice')

  // Leftover plugin files: one toast naming them, and a marker so the next
  // boot stays quiet. The files themselves are never touched — deleting a
  // user's theme is not this plugin's business any more. All three names are
  // written because the host caps toast text at 200 cells: the longest list
  // must still fit untruncated (asserted below).
  const legacy = join(sandboxThemes, 'pink-day.json')
  writeFileSync(legacy, '{ "name": "pink-day", "colors": {} }')
  writeFileSync(join(sandboxThemes, 'pink-ansi.json'), '{ "name": "pink-ansi", "colors": {} }')
  writeFileSync(join(sandboxThemes, 'pink-night.json'), '{ "name": "pink-night", "colors": {} }')
  assert.deepEqual(findLegacyThemeFiles(), ['pink-ansi.json', 'pink-day.json', 'pink-night.json'])
  const deliveries = []
  const first = makeStubCtx({ toast: fakeToast(deliveries) })
  await applyAndSettle(first.ctx)
  assert.equal(deliveries.length, 1, 'the leftover file is pointed out exactly once')
  assert.match(deliveries[0][0], /pink-day\.json/)
  assert.match(deliveries[0][0], /dsh-TUI/)
  // The notice is generation-neutral: the built-in precedence is a condition,
  // never a claim that this host has the family (0.10/0.11 ship tuiToast and
  // no pink palettes, and there the file is still the theme's only source).
  assert.match(deliveries[0][0], /若已内置同名粉主题/)
  // The host dedupes a static theme by its JSON `name`, not by the file name,
  // so the advice must name that field — "rename the file" alone changes
  // nothing (probed against the pink-carrying host build).
  assert.match(deliveries[0][0], /name/)
  // Moving off the pink names takes the theme out of PINK_THEMES, so the scope
  // fix has to travel with the advice instead of silently hiding the line.
  assert.match(deliveries[0][0], /所有主题/)
  assert.ok(
    displayCells(deliveries[0][0]) <= 200,
    `the longest notice must fit the host's 200-cell toast cap, got ${displayCells(deliveries[0][0])}`,
  )
  assert.equal(existsSync(join(sandboxData, NOTICE_FILE)), true, 'the delivered notice is recorded')
  assert.equal(
    readFileSync(legacy, 'utf8'),
    '{ "name": "pink-day", "colors": {} }',
    'the notice never edits or deletes the file',
  )

  const secondDeliveries = []
  const second = makeStubCtx({ toast: fakeToast(secondDeliveries) })
  await applyAndSettle(second.ctx)
  assert.equal(secondDeliveries.length, 0, 'the marker keeps later boots quiet')

  rmSync(sandboxThemes, { recursive: true, force: true })
  rmSync(join(sandboxData, NOTICE_FILE), { force: true })
  console.log('✓ legacy notice: one neutral toast for plugin files, recorded once, file untouched')
}

// ── 13. hot path: the token firehose must not reach render or the disk ─────
{
  setActiveTheme('pink-night')
  const themePrefPath = join(sandboxData, 'theme.json')
  const statusCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)
  const session = { id: 'h1' }
  emit(record, 'session/event', session, { type: 'turn/end' })
  const baselineCalls = statusCalls.length
  assert.match(statusCalls.at(-1)[1], /1✦$/)

  // A firehose burst (streaming chunks, tool traffic, step brackets) updates
  // the tracked session but must render nothing and never touch the disk.
  const originalRead = builtinFs.readFileSync
  let prefReads = 0
  try {
    builtinFs.readFileSync = (path, ...rest) => {
      if (String(path) === themePrefPath) prefReads += 1
      return originalRead(path, ...rest)
    }
    syncBuiltinESMExports()
    for (let index = 0; index < 50; index += 1) {
      emit(record, 'session/event', session, {
        type: 'assistant/chunk',
        turn: 1,
        step: 1,
        chunk: { type: 'text', text: 'x' },
      })
    }
    emit(record, 'session/event', session, {
      type: 'tool/call', turn: 1, step: 1, callId: 'c1', name: 'tool', arguments: '{}',
    })
    emit(record, 'session/event', session, { type: 'step/end', turn: 1, step: 1 })
    emit(record, 'session/event', session, { type: 'todo/write', todos: [] })
    assert.equal(statusCalls.length, baselineCalls, 'firehose events render nothing')
    assert.equal(prefReads, 0, 'firehose events never read the theme pref')

    // A turn boundary renders — the mtime gate costs one stat (not counted
    // here), and the warm cache answers without a read, so even boundary
    // renders stay off the read path.
    emit(record, 'session/event', session, { type: 'turn/end' })
    assert.equal(statusCalls.length, baselineCalls + 1, 'a turn boundary renders')
    assert.equal(prefReads, 0, 'the warm cache serves the boundary render')

    // A session switch repaints at its first turn/start with a fresh count.
    const nextSession = { id: 'h2' }
    emit(record, 'session/event', nextSession, { type: 'turn/start' })
    assert.equal(statusCalls.length, baselineCalls + 2)
    assert.match(statusCalls.at(-1)[1], /0✦$/)
    assert.equal(prefReads, 0)

    // A pref rewrite (the host's /theme switch) is seen at the very next
    // render: the stat notices the moved mtime and pays exactly one re-read,
    // and the non-pink pref hides the line — no waiting out the TTL (the
    // stale window used to show as wrong rich-view colors).
    writeFileSync(themePrefPath, JSON.stringify({ theme: 'dark' }, null, 2))
    emit(record, 'session/event', nextSession, { type: 'turn/end' })
    assert.equal(statusCalls.length, baselineCalls + 3)
    assert.equal(statusCalls.at(-1)[1], undefined, 'the pref rewrite is seen at the next render')
    assert.equal(prefReads, 1, 'the moved mtime costs exactly one re-read')

    // An unchanged pref keeps the cache warm: the render reruns, but the
    // hidden line's text is unchanged so set() is deduplicated away, and
    // no read happens.
    emit(record, 'session/event', nextSession, { type: 'turn/end' })
    assert.equal(statusCalls.length, baselineCalls + 3, 'an unchanged line does not rewrite the store')
    assert.equal(prefReads, 1, 'the unchanged mtime serves the cache')

    // Test-only invalidation (the TTL-expiry stand-in) re-reads too.
    invalidateThemePrefCacheForTests()
    emit(record, 'session/event', nextSession, { type: 'turn/end' })
    assert.equal(prefReads, 2, 'invalidation re-reads the pref exactly once')
    assert.equal(statusCalls.at(-1)[1], undefined, 'the non-pink pref keeps the line hidden')
  } finally {
    builtinFs.readFileSync = originalRead
    syncBuiltinESMExports()
    invalidateThemePrefCacheForTests()
  }
  console.log('✓ hot path: firehose events render nothing and never read the pref; boundaries use the cache')
}

// ── 14. settings panel UX: one group, ornament drafts, live edits ──────────
{
  setActiveTheme('pink-night')
  const statusCalls = []
  const sectionsCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    sections: fakeSections(sectionsCalls),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)
  const section = sectionsCalls[0]
  const fieldByPath = path =>
    section.fields.find(field => JSON.stringify(field.path) === JSON.stringify(path))

  // One navigation group, every field assigned; the theme half of the card is
  // gone with the feature (no palette, no background follow).
  assert.deepEqual(section.groups.map(group => group.id), ['status-line'])
  assert.equal(section.title, 'dsh-tui-theme')
  for (const path of [['showGlyph'], ['statusGlyph'], ['showClock'], ['showTurns'], ['statusSeparator'], ['statusScope']]) {
    assert.equal(fieldByPath(path).group, 'status-line', `${path.join('.')} belongs to the group`)
  }
  assert.equal(fieldByPath(['followSystem']), undefined, 'background follow left with the themes')

  // Ornament draft gate: 1–2 display cells, control chars refused, empty
  // resets to the built-in default, unset displays the effective value.
  const glyph = fieldByPath(['statusGlyph'])
  assert.equal(glyph.kind, 'text')
  assert.deepEqual(glyph.parse(''), { kind: 'clear' })
  assert.deepEqual(glyph.parse('❀'), { kind: 'set', value: '❀' })
  assert.deepEqual(glyph.parse('樱'), { kind: 'set', value: '樱' }, 'a 2-cell CJK char is allowed')
  assert.equal(glyph.parse('abc'), undefined, '3 cells are rejected')
  assert.equal(glyph.parse('a\u0007b'), undefined, 'control characters are rejected')
  assert.deepEqual(glyph.parse(' \u00A0 '), { kind: 'clear' }, 'whitespace-only drafts reset to the default')
  assert.equal(glyph.format(undefined), '✿', 'unset shows the effective default')
  assert.equal(glyph.format('❀'), '❀')
  const separator = fieldByPath(['statusSeparator'])
  assert.equal(separator.kind, 'text')
  assert.deepEqual(separator.parse('✦'), { kind: 'set', value: '✦' })
  assert.equal(separator.format(undefined), '·')

  // A committed ornament edit lands live on the scalar line.
  for (const watcher of settingsRecord.watchers) {
    watcher({ statusGlyph: '❀', statusSeparator: '~' })
  }
  emit(record, 'session/event', { id: 'u1' }, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^❀ ~ \d{2}:\d{2} ~ 1✦$/)

  // Hand-edited config layers bypass the draft gate; the render side
  // sanitizes anyway (control chars stripped, capped at 2 cells).
  for (const watcher of settingsRecord.watchers) {
    watcher({ statusGlyph: 'x\u0007yz', statusSeparator: '~' })
  }
  emit(record, 'session/event', { id: 'u1' }, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^xy ~ /, 'control chars stripped and the rest capped at 2 cells')
  console.log('✓ settings panel: one group, ornament drafts gated, edits land live')
}

// ── 15. rich status view: embedded palette colors on registerView hosts ────
{
  setActiveTheme('pink-night')
  const statusCalls = []
  const viewCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeRichStatus(statusCalls, viewCalls),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)

  assert.equal(viewCalls.length, 1, 'the rich view is registered exactly once')
  assert.equal(statusCalls.length, 0, 'the rich path never writes scalar text')
  const [descriptor, identity] = viewCalls[0]
  assert.equal(descriptor.key, 'dsh-tui-theme', 'the rich view keeps the shared contribution key')
  assert.equal(descriptor.maxRows, 1)
  assert.equal(typeof descriptor.component, 'function')
  assert.equal(identity?.tuiStatus !== undefined, true, 'identity is the inject-scoped context')

  // Render the component against a minimal fake of the host kit: the element
  // tree must map the snapshot to themed Text cells.
  const renderComponent = () =>
    descriptor.component({
      React: {
        createElement: (type, props, ...children) => ({ type, props, children: children.length === 1 && Array.isArray(children[0]) ? children[0] : children }),
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      },
      ui: { Box: 'box', Text: 'text' },
    })
  const element = renderComponent()
  assert.equal(element.type, 'box', 'one row Box')
  assert.equal(element.children[0].type, 'text')
  assert.equal(element.children[0].props.color, 'rgb(242,123,166)', 'the glyph uses the night palette accent')
  assert.equal(element.children[0].children[0], '✿')
  assert.equal(element.children[1].props.color, '#77646D', 'the separator uses the night palette subtle')
  assert.match(element.children[2].children[0], /^\d{2}:\d{2}$/)
  assert.equal(element.children[2].props.color, '#C4B0B9', 'the clock uses the night palette inactiveShimmer')

  // A decoy palette file must not be consulted: the colors are embedded now,
  // and the host owns the palette table.
  mkdirSync(sandboxThemes, { recursive: true })
  writeFileSync(
    join(sandboxThemes, 'pink-night.json'),
    JSON.stringify({ name: 'pink-night', base: 'dark', colors: { accent: '#000000', inactiveShimmer: '#000000', subtle: '#000000' } }),
  )
  emit(record, 'session/event', { id: 'decoy' }, { type: 'turn/end' })
  assert.equal(renderComponent().children[0].props.color, 'rgb(242,123,166)', 'a decoy file changes no color')
  rmSync(sandboxThemes, { recursive: true, force: true })

  // Turn boundaries push through the store and land in the next render.
  const session = { id: 'r1' }
  emit(record, 'session/event', session, { type: 'turn/end' })
  const withTurns = renderComponent()
  assert.equal(withTurns.children.at(-1).children[0], '1✦')
  assert.equal(withTurns.children.at(-1).props.color, '#C4B0B9')

  // A /theme switch (the host rewrites the pref) lands at the very next
  // render: pink-day and pink-ansi carry their own embedded colors, and a
  // non-pink theme drops to the terminal default.
  const expected = {
    'pink-day': ['rgb(222,110,150)', '#B3A3AC', '#9E6E82'],
    'pink-ansi': ['ansi:magentaBright', 'ansi:white', 'ansi:whiteBright'],
  }
  for (const [theme, [glyphColor, separatorColor, textColor]] of Object.entries(expected)) {
    setActiveTheme(theme)
    emit(record, 'session/event', session, { type: 'turn/end' })
    const view = renderComponent()
    assert.equal(view.children[0].props.color, glyphColor, `${theme} glyph`)
    assert.equal(view.children[1].props.color, separatorColor, `${theme} separator`)
    assert.equal(view.children.at(-1).props.color, textColor, `${theme} text cell`)
  }
  setActiveTheme('dark')
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.equal(renderComponent(), null, 'a non-pink theme hides the line by default')

  // Toggles fold into the snapshot: all off renders nothing (no scalar
  // fallback either — the rich view just shows nothing).
  setActiveTheme('pink-night')
  for (const watcher of settingsRecord.watchers) {
    watcher({ showGlyph: false, showClock: false, showTurns: false })
  }
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.equal(renderComponent(), null, 'all toggles off render nothing')

  // Master switch off: registered but never visible.
  const quietCalls = []
  const quietViews = []
  const quietCtx = makeStubCtx({ status: fakeRichStatus(quietCalls, quietViews) })
  await applyAndSettle(quietCtx.ctx, { statusEnabled: false })
  assert.equal(quietViews.length, 1, 'the view is still registered')
  assert.equal(
    quietViews[0][0].component({
      React: {
        createElement: (type, props, ...children) => ({ type, props, children: children.length === 1 && Array.isArray(children[0]) ? children[0] : children }),
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      },
      ui: { Box: 'box', Text: 'text' },
    }),
    null,
    'statusEnabled=false renders nothing',
  )
  console.log('✓ rich status view: embedded palette per pink theme, mutual exclusion from set()')
}

// ── 16. refused / hostile rich registration falls back to the scalar path ──
{
  const statusCalls = []
  const viewCalls = []
  const { ctx } = makeStubCtx({ status: fakeRichStatus(statusCalls, viewCalls, { refuse: true }) })
  await applyAndSettle(ctx)
  assert.equal(viewCalls.length, 1, 'the registration was attempted')
  assert.equal(statusCalls.length > 0, true, 'a refused registration (undefined) falls back to set()')

  const hostileCalls = []
  const hostileViews = []
  const { ctx: hostileCtx, record: hostileRecord } = makeStubCtx({
    status: fakeRichStatus(hostileCalls, hostileViews, { throws: true }),
  })
  // applyAndSettle resolving at all is the non-propagation half of the
  // invariant: a synchronous throw escaping the inject callback would land here.
  await applyAndSettle(hostileCtx)
  assert.equal(hostileViews.length, 1, 'the registration was attempted')
  assert.equal(hostileCalls.length > 0, true, 'a throwing registration falls back to set()')
  assert.equal(
    hostileRecord.warnings.some(msg => msg.includes('rich status view registration failed')),
    true,
    'the failure is warned, never propagated',
  )
  assert.equal(
    (hostileRecord.handlers.get('session/event') ?? []).length >= 1,
    true,
    'the session wiring survived the throw',
  )
  console.log('✓ rich registration: refusal and hostile throws both keep the scalar line alive')
}

// ── 17. handover invariants: no themes shipped, none registered, none read ─
{
  // The package only ships what it still uses.
  const packageJson = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.files.includes('themes'), false, 'themes/ must not ship')
  assert.equal(existsSync(join(pluginRoot, 'themes')), false, 'themes/ must not exist')
  for (const module of ['autoTheme', 'themeAssets', 'runtimeThemes', 'shadowCleanup', 'hostContract']) {
    assert.equal(
      existsSync(join(pluginRoot, 'lib', 'types', `${module}.js`)),
      false,
      `lib/types/${module}.js must be gone with the theme half`,
    )
  }

  // A runtime theme service may be present — the plugin must not register,
  // install, or repair anything (the host owns the pink names now).
  const registers = []
  setActiveTheme('pink-night')
  const statusCalls = []
  const full = makeStubCtx({ status: fakeStatus(statusCalls), themes: fakeThemes(registers) })
  await applyAndSettle(full.ctx)
  emit(full.record, 'session/event', { id: 'x1' }, { type: 'turn/end' })
  assert.deepEqual(registers, [], 'the theme seam stays untouched even when it is present')
  assert.deepEqual(readdirSync(sandboxData), ['theme.json'], 'and no theme file appears next to the pref')

  // A planted palette file is not read: the rich path colors from palette.ts
  // alone (single source, no shadowing rules to reason about).
  mkdirSync(sandboxThemes, { recursive: true })
  writeFileSync(join(sandboxThemes, 'pink-night.json'), '{ "name": "pink-night", "colors": {} }')
  const originalRead = builtinFs.readFileSync
  let paletteReads = 0
  try {
    builtinFs.readFileSync = (path, ...rest) => {
      if (String(path).startsWith(sandboxThemes)) paletteReads += 1
      return originalRead(path, ...rest)
    }
    syncBuiltinESMExports()
    const viewCalls = []
    const reader = makeStubCtx({ status: fakeRichStatus([], viewCalls) })
    await applyAndSettle(reader.ctx)
    emit(reader.record, 'session/event', { id: 'x2' }, { type: 'turn/end' })
    assert.equal(paletteReads, 0, 'no theme file is read for colors')
  } finally {
    builtinFs.readFileSync = originalRead
    syncBuiltinESMExports()
    rmSync(sandboxThemes, { recursive: true, force: true })
    rmSync(join(sandboxData, NOTICE_FILE), { force: true })
  }

  // The only write the plugin may ever perform: the notice marker, in an
  // otherwise untouched data directory. Point HOME at a fresh sandbox for the
  // check, so nothing from the earlier scenarios is in the way.
  const isolatedHome = mkdtempSync(join(tmpdir(), 'pink-status-isolated-'))
  const isolatedData = join(isolatedHome, '.dsh-tui')
  mkdirSync(join(isolatedData, 'themes'), { recursive: true })
  writeFileSync(join(isolatedData, 'themes', 'pink-night.json'), '{ "name": "pink-night", "colors": {} }')
  writeFileSync(join(isolatedData, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))
  const previousHome = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  try {
    process.env.USERPROFILE = isolatedHome
    process.env.HOME = isolatedHome
    invalidateThemePrefCacheForTests()
    const deliveries = []
    const isolated = makeStubCtx({ status: fakeStatus([]), toast: fakeToast(deliveries) })
    await applyAndSettle(isolated.ctx)
    emit(isolated.record, 'session/event', { id: 'iso' }, { type: 'turn/end' })
    assert.equal(deliveries.length, 1, 'the notice still fires on a fresh install')
    const written = readdirSync(isolatedData).sort()
    assert.deepEqual(written, ['theme-plugin-notice.json', 'theme.json', 'themes'], 'the marker is the only addition')
    assert.deepEqual(readdirSync(join(isolatedData, 'themes')), ['pink-night.json'], 'the legacy file is left alone')
    assert.equal(readThemePref(isolatedData), 'pink-night', 'the pref is read, never rewritten')
  } finally {
    if (previousHome.USERPROFILE === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousHome.USERPROFILE
    if (previousHome.HOME === undefined) delete process.env.HOME
    else process.env.HOME = previousHome.HOME
    invalidateThemePrefCacheForTests()
    rmSync(isolatedHome, { recursive: true, force: true })
  }
  console.log('✓ handover: no themes shipped or registered, no palette file read, marker is the only write')
}

console.log('\nAll plugin verifications passed.')
console.log(`(sandbox used: ${sandboxHome} — the real home was never touched)`)
