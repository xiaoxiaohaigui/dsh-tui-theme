/**
 * Hermetic verification for dsh-tui-theme (no TTY, no real HOME).
 *
 * Points HOME/USERPROFILE at a throwaway sandbox BEFORE importing anything
 * (the same technique the host's scripts/verify-themes.mjs uses), then:
 *
 *  1. Applies the plugin against a stub context with every seam absent —
 *     must be a silent no-op (the #183 discipline).
 *  2. Applies it with all seams faked — asserts themes land in the SANDBOX
 *     ~/.dsh-tui/themes/, the status line renders (glyph · clock · turns),
 *     settings edits land live, and the /settings section is declared.
 *  3. Re-runs installation — must skip, never overwrite, existing files
 *     (including a user-edited same-named file).
 *  4. Applies with autoInstallThemes: false on a clean sandbox — must not
 *     create the themes directory.
 *
 * Run with: npm run verify   (after npm run build)
 */
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import assert from 'node:assert/strict'
import { assertSettingsContract } from './expected-settings-contract.mjs'

const sandboxHome = mkdtempSync(join(tmpdir(), 'pink-theme-verify-'))
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
const sandboxThemes = join(sandboxHome, '.dsh-tui', 'themes')

const { name, apply } = await import('../lib/types/index.js')
const { installBundledThemes, readBundledThemes, findShadowedBundledThemes } = await import('../lib/types/themeAssets.js')
const { startStatusLine, invalidateThemePrefCacheForTests } = await import('../lib/types/statusLine.js')
const { setToastRetryDelaysForTests } = await import('../lib/types/toast.js')
const {
  themeForBackground,
  readThemePref,
  writeThemePref,
  readFollowCache,
  applyCachedFollow,
  runFollowSystem,
} = await import('../lib/types/autoTheme.js')

assert.equal(name, 'dsh-tui-theme')
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const applyAndSettle = async (ctx, config) => {
  apply(ctx, config)
  await settle()
}

/** A stub Cordis-like context; every seam optional and recorded. */
function makeStubCtx({ status, sections, settingsService, themes, toast, deferThemes = false, deferToast = false } = {}) {
  const record = { handlers: new Map(), disposers: [], statusCalls: [], sectionsCalls: [], registerCalls: [], watchers: [], themeRegisters: [], warnings: [], infos: [] }
  let availableThemes = themes
  let availableToast = toast
  const deferredThemeCallbacks = []
  const deferredToastCallbacks = []
  const logger = { info: msg => record.infos.push(String(msg)), warn: msg => record.warnings.push(String(msg)), error: () => {} }
  const base = {
    logger,
    get(serviceName) {
      if (serviceName === 'tuiStatus') return status
      if (serviceName === 'tuiSettingsSections') return sections
      if (serviceName === 'tuiThemes') return availableThemes
      if (serviceName === 'tuiToast') return availableToast
      return undefined
    },
    on(event, handler) {
      const list = record.handlers.get(event) ?? []
      list.push(handler)
      record.handlers.set(event, list)
      return () => {}
    },
    effect(factory) {
      const dispose = factory()
      if (typeof dispose === 'function') record.disposers.push(dispose)
    },
    inject(deps, callback) {
      // Simulate cordis: the callback runs once every requested service
      // exists (immediately here), and property access works inside it.
      const services = {
        settings: settingsService,
        tuiStatus: status,
        tuiSettingsSections: sections,
        tuiThemes: availableThemes,
        tuiToast: availableToast,
      }
      if (deferThemes && availableThemes === undefined && deps.includes('tuiThemes')) {
        deferredThemeCallbacks.push(callback)
        return
      }
      if (deferToast && availableToast === undefined && deps.includes('tuiToast')) {
        deferredToastCallbacks.push(callback)
        return
      }
      if (deps.every(dep => services[dep] !== undefined)) {
        const props = Object.fromEntries(deps.map(dep => [dep, services[dep]]))
        callback({ ...base, ...props })
      }
    },
  }
  record.activateThemes = service => {
    availableThemes = service
    for (const callback of deferredThemeCallbacks.splice(0)) callback({ ...base, tuiThemes: service })
  }
  record.activateToast = service => {
    availableToast = service
    for (const callback of deferredToastCallbacks.splice(0)) callback({ ...base, tuiToast: service })
  }
  return { ctx: base, record }
}

const fakeStatus = calls => ({ set(key, text) { calls.push([key, text]); return () => {} } })
const fakeSections = calls => ({ register(section) { calls.push(section); return () => {} } })
const fakeThemes = (record, { throws = false } = {}) => ({
  register(descriptor, identity) {
    record.themeRegisters.push([descriptor, identity])
    if (throws) throw new Error('runtime registry unavailable')
    return () => {}
  },
})
const fakeSettingsService = (record, doc) => ({
  register(namespace, schema) {
    record.registerCalls.push([namespace, schema])
    return {
      get: () => doc,
      watch(listener) { record.watchers.push(listener); return () => {} },
    }
  },
})
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

// ── 1. bare host: no seam present → theme assets still install (pure fs),
//        but nothing UI-facing happens ────────────────────────────────────────
{
  const { ctx, record } = makeStubCtx()
  apply(ctx)
  assert.deepEqual(record.warnings, [])
  assert.equal(record.handlers.size, 0, 'no event handlers without the status seam')
  for (const theme of ['pink-night', 'pink-day', 'pink-ansi']) {
    assert.equal(existsSync(join(sandboxThemes, `${theme}.json`)), true, `${theme}.json installed`)
  }
  console.log('✓ bare host (no seams): themes installed, nothing UI-facing')
}

// ── 2. full host: everything wired ──────────────────────────────────────────
{
  rmSync(sandboxThemes, { recursive: true, force: true })
  // A pink theme is active — the default policy hides the line otherwise.
  mkdirSync(join(sandboxHome, '.dsh-tui'), { recursive: true })
  writeFileSync(join(sandboxHome, '.dsh-tui', 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))
  const statusCalls = []
  const sectionsCalls = []
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({
    status: fakeStatus(statusCalls),
    sections: fakeSections(sectionsCalls),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx)

  // Themes installed into the SANDBOX, never the real home.
  for (const theme of ['pink-night', 'pink-day', 'pink-ansi']) {
    assert.equal(existsSync(join(sandboxThemes, `${theme}.json`)), true, `${theme}.json installed`)
  }

  // Status line: one keyed contribution with glyph · clock.
  assert.equal(statusCalls.length > 0, true)
  const [key, first] = statusCalls[0]
  assert.equal(key, 'dsh-tui-theme')
  assert.match(first, /^✿ · \d{2}:\d{2}$/)

  // Turns counted from session events (live, no log appends).
  const session = { id: 's1' }
  emit(record, 'session/event', session, { type: 'turn/end' })
  emit(record, 'session/event', session, { type: 'turn/end' })
  const latest = statusCalls.at(-1)[1]
  assert.match(latest, /^✿ · \d{2}:\d{2} · 2✦$/)

  // Settings namespace registered and the section declaration remains within
  // the shared host form contract.
  assert.equal(settingsRecord.registerCalls.length, 1)
  assert.equal(sectionsCalls.length, 1)
  assertSettingsContract(assert, sectionsCalls[0])

  // A committed /settings edit lands live on the next render.
  for (const watcher of settingsRecord.watchers) {
    watcher({ showGlyph: false, showClock: false })
  }
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^3✦$/)

  // Disposal never throws.
  for (const dispose of record.disposers) dispose()
  console.log('✓ full host: themes installed, status line live, settings wired')
}

// ── 2a. runtime themes: service owns palettes and static files stay absent ───
{
  rmSync(sandboxThemes, { recursive: true, force: true })
  const registrations = []
  const themes = { register(descriptor, identity) { registrations.push([descriptor, identity]); return () => {} } }
  const { ctx } = makeStubCtx({ themes })
  await applyAndSettle(ctx)
  assert.equal(existsSync(sandboxThemes), false, 'runtime registration must not create static files')
  const expected = readBundledThemes().map(({ file, ...theme }) => theme)
  assert.deepEqual(registrations.map(([descriptor]) => descriptor), expected)
  assert.equal(
    registrations.every(([, identity]) => identity?.tuiThemes !== undefined),
    true,
    'runtime registrations use the inject-scoped identity',
  )
  console.log('✓ runtime themes: three descriptors registered without static files')
}

// ── 2b. late runtime service: confirmation removes this activation's files ──
{
  rmSync(sandboxThemes, { recursive: true, force: true })
  const { ctx, record } = makeStubCtx({ deferThemes: true })
  apply(ctx)
  assert.equal(existsSync(sandboxThemes), true, 'legacy fallback must install synchronously before service arrival')
  record.activateThemes(fakeThemes(record))
  await settle()
  assert.equal(existsSync(sandboxThemes), false, 'late runtime service must remove all fallback files and the empty directory')

  rmSync(sandboxThemes, { recursive: true, force: true })
  const protectedContext = makeStubCtx({ deferThemes: true })
  apply(protectedContext.ctx)
  assert.equal(existsSync(sandboxThemes), true, 'legacy fallback must install before protecting a user edit')
  const protectedTheme = join(sandboxThemes, 'pink-night.json')
  writeFileSync(protectedTheme, '{ "name": "pink-night", "colors": { "text": "#123456" } }')
  protectedContext.record.activateThemes(fakeThemes(protectedContext.record))
  await settle()
  assert.equal(existsSync(join(sandboxThemes, 'pink-day.json')), false, 'late runtime service must remove plugin-owned files')
  assert.equal(existsSync(join(sandboxThemes, 'pink-ansi.json')), false, 'late runtime service must remove plugin-owned files')
  assert.equal(readFileSync(protectedTheme, 'utf8'), '{ "name": "pink-night", "colors": { "text": "#123456" } }')
  rmSync(sandboxThemes, { recursive: true, force: true })
  console.log('✓ runtime race: late service wins and removes static fallback files')
}

// ── 2c. hostile runtime service: registration failures degrade to warnings ───
{
  const themeRecord = { themeRegisters: [] }
  const { ctx, record } = makeStubCtx({ themes: fakeThemes(themeRecord, { throws: true }) })
  await applyAndSettle(ctx)
  assert.equal(record.warnings.length, 3, 'each hostile registration is contained and warned')
  console.log('✓ hostile runtime service: registration failures warn, never propagate')
}

// ── 3. idempotence + user-file protection ───────────────────────────────────
{
  const seeded = installBundledThemes()
  assert.equal(seeded.installed.length, 3)
  const again = installBundledThemes()
  assert.deepEqual(again.installed, [])
  assert.deepEqual(again.repaired, [])
  assert.equal(again.skipped.length, 3)

  // A user-edited same-named file must survive reinstallation.
  const userFile = join(sandboxThemes, 'pink-night.json')
  writeFileSync(userFile, '{ "name": "pink-night", "base": "dark", "colors": { "text": "#123456" } }')
  const third = installBundledThemes()
  assert.deepEqual(third.installed, [])
  assert.equal(JSON.parse(readFileSync(userFile, 'utf8')).colors.text, '#123456')
  console.log('✓ reinstall: skips existing files, never overwrites user edits')
}

// ── 4. autoInstallThemes: false on a clean sandbox ──────────────────────────
{
  rmSync(sandboxHome, { recursive: true, force: true })
  mkdirSync(sandboxHome, { recursive: true })
  const { ctx } = makeStubCtx()
  await applyAndSettle(ctx, { autoInstallThemes: false })
  assert.equal(existsSync(join(sandboxHome, '.dsh-tui')), false, 'must not create the dir when disabled')
  console.log('✓ autoInstallThemes=false: leaves the themes dir untouched')
}

// ── 5. cached background follow: no terminal I/O ───────────────────────────
{
  const dataDir = join(sandboxHome, '.dsh-tui')
  mkdirSync(dataDir, { recursive: true })
  assert.equal(themeForBackground(true), 'pink-day')
  assert.equal(themeForBackground(false), 'pink-night')
  assert.equal(applyCachedFollow(dataDir), undefined, 'no cache preserves the existing choice')

  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  assert.equal(applyCachedFollow(dataDir), 'pink-day')
  assert.equal(readFollowCache(dataDir).light, true)
  assert.equal(readThemePref(dataDir), 'pink-day')

  // Same value -> no rewrite churn (mtime-agnostic: pref already matches).
  assert.equal(applyCachedFollow(dataDir), 'pink-day')

  // The follow runner only applies cache and reports its structured outcome.
  // It accepts no stdin/stdout handles and cannot create a raw-mode lease or
  // input listener.
  const reports = []
  runFollowSystem(dataDir, () => true, outcome => reports.push(outcome))
  assert.deepEqual(reports, [{ kind: 'applied', theme: 'pink-day', changed: false }])

  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  runFollowSystem(dataDir, () => false, outcome => reports.push(outcome))
  assert.equal(readThemePref(dataDir), 'dark', 'inactive follow preserves manual choice')

  runFollowSystem(dataDir, () => true, outcome => reports.push(outcome))
  assert.deepEqual(
    reports.at(-1),
    { kind: 'applied', theme: 'pink-day', changed: true },
    'a real pref flip is reported as changed',
  )

  rmSync(join(dataDir, 'theme-follow.json'), { force: true })
  runFollowSystem(dataDir, () => true, outcome => reports.push(outcome))
  assert.deepEqual(reports.at(-1), { kind: 'unavailable' })
  console.log('✓ follow: cached background applies without terminal I/O')
}

// ── 6. statusEnabled: false silences the whole line ─────────────────────────
{
  const statusCalls = []
  const { ctx } = makeStubCtx({ status: fakeStatus(statusCalls) })
  await applyAndSettle(ctx, { statusEnabled: false })
  assert.equal(statusCalls.length > 0, true, 'render still ran once')
  // Every contribution is cleared (undefined), not rendered.
  for (const [, text] of statusCalls) assert.equal(text, undefined)
  console.log('✓ statusEnabled=false: the line contributes nothing')
}

// ── 7. followSystem honors the /settings user layer with cached state ───────
{
  const dataDir = join(sandboxHome, '.dsh-tui')
  rmSync(join(dataDir, 'theme-follow.json'), { force: true })
  rmSync(join(dataDir, 'theme.json'), { force: true })
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx } = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(settingsRecord, {}),
  })
  await applyAndSettle(ctx, { followSystem: true })
  // Cordis layer on, empty user layer, no cache yet -> no pref churn.
  assert.equal(existsSync(join(dataDir, 'theme.json')), false)

  // User disables follow via /settings; a stale cached flip must not write.
  for (const w of settingsRecord.watchers) w({ followSystem: false })
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  assert.equal(existsSync(join(dataDir, 'theme.json')), false, 'disabled follow must not rewrite the pref')

  // Re-enable → the cached background applies immediately.
  for (const w of settingsRecord.watchers) w({ followSystem: true })
  assert.equal(readThemePref(dataDir), 'pink-day')
  console.log('✓ followSystem: /settings toggle decides live (off = pref preserved)')
}

// ── 8. theme gating: the line belongs to the pink palettes ──────────────────
{
  const themePrefPath = join(sandboxHome, '.dsh-tui', 'theme.json')
  writeFileSync(themePrefPath, JSON.stringify({ theme: 'pink-night' }, null, 2))
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
  writeFileSync(themePrefPath, JSON.stringify({ theme: 'dark' }, null, 2))
  invalidateThemePrefCacheForTests()
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
  console.log('✓ theme gating: pink-only by default, opt-in shows everywhere')
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

// ── 10. missing settings: never override a manual theme choice ─────────────
{
  const dataDir = join(sandboxHome, '.dsh-tui')
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  const { ctx } = makeStubCtx()
  await applyAndSettle(ctx, { followSystem: true })
  assert.equal(readThemePref(dataDir), 'dark', 'without settings, cached follow must not override manual choice')
  console.log('✓ missing settings: cached follow leaves the manual choice intact')
}

// ── 11. filesystem commits: atomic replacement and exclusive creation ───────
{
  const dataDir = join(sandboxHome, '.dsh-tui')
  mkdirSync(dataDir, { recursive: true })
  const pref = join(dataDir, 'theme.json')
  writeFileSync(pref, JSON.stringify({ theme: 'dark' }, null, 2))
  const originalRename = builtinFs.renameSync
  try {
    builtinFs.renameSync = () => { throw new Error('rename blocked') }
    syncBuiltinESMExports()
    assert.equal(writeThemePref('pink-day', dataDir), false)
    assert.equal(readThemePref(dataDir), 'dark', 'failed commit leaves the prior JSON readable')
    assert.equal(
      readdirSync(dataDir).some(file => file.startsWith('.theme.json.') && file.endsWith('.tmp')),
      false,
      'failed commit removes its temporary file',
    )
  } finally {
    builtinFs.renameSync = originalRename
    syncBuiltinESMExports()
  }

  const targetDir = join(sandboxHome, 'race-target')
  const originalWrite = builtinFs.writeFileSync
  let racedFile
  try {
    builtinFs.writeFileSync = (path, data, options) => {
      const target = String(path)
      if (racedFile === undefined && target.startsWith(targetDir) && options?.flag === 'wx') {
        racedFile = target.split(/[\\/]/).at(-1)
        originalWrite(path, '{ "user": true }', { flag: 'wx' })
      }
      return originalWrite(path, data, options)
    }
    syncBuiltinESMExports()
    const result = installBundledThemes(targetDir, join(pluginRoot, 'themes'))
    assert.equal(typeof racedFile, 'string', 'the test injected a competing creator')
    assert.equal(result.skipped.includes(racedFile), true, 'EEXIST is a protected user-file skip')
    assert.deepEqual(JSON.parse(readFileSync(join(targetDir, racedFile), 'utf8')), { user: true })
  } finally {
    builtinFs.writeFileSync = originalWrite
    syncBuiltinESMExports()
  }
  console.log('✓ filesystem commits: failed atomic writes preserve JSON; competing theme creation skips')
}

// ── 12a. torn installation: a corrupt target is backed up and reinstalled ───
{
  const targetDir = join(sandboxHome, 'heal-target')
  const sourceDir = join(pluginRoot, 'themes')
  mkdirSync(targetDir, { recursive: true })

  // A valid user file stays untouched — the never-overwrite rule wins.
  writeFileSync(join(targetDir, 'pink-night.json'), '{ "user": true }')
  // A torn write (crash mid-install) leaves invalid JSON behind.
  writeFileSync(join(targetDir, 'pink-day.json'), '{ "name": "pink-day", "colors": {')
  const heal = installBundledThemes(targetDir, sourceDir)
  assert.deepEqual(heal.repaired, ['pink-day.json'], 'the corrupt target is reported as repaired')
  assert.equal(heal.skipped.includes('pink-night.json'), true)
  assert.equal(heal.failed.length, 0)
  assert.equal(
    JSON.parse(readFileSync(join(targetDir, 'pink-night.json'), 'utf8')).user,
    true,
    'valid user file untouched',
  )
  const reinstalled = JSON.parse(readFileSync(join(targetDir, 'pink-day.json'), 'utf8'))
  assert.equal(reinstalled.name, 'pink-day')
  const backups = readdirSync(targetDir).filter(entry =>
    entry.startsWith('pink-day.json.corrupt-'),
  )
  assert.equal(backups.length, 1, 'the damaged file is preserved as a timestamped backup')
  assert.equal(readFileSync(join(targetDir, backups[0]), 'utf8'), '{ "name": "pink-day", "colors": {')

  // Next boot: everything parses, so no churn.
  const steady = installBundledThemes(targetDir, sourceDir)
  assert.deepEqual(steady.repaired, [])
  assert.deepEqual(steady.installed, [])
  assert.equal(steady.skipped.length, 3)

  // A target the process cannot even read is not proven corrupt — keep skipping.
  const unreadable = join(targetDir, 'pink-ansi.json')
  const originalRead = builtinFs.readFileSync
  try {
    builtinFs.readFileSync = (path, ...rest) => {
      if (String(path) === unreadable) throw new Error('EBUSY: locked')
      return originalRead(path, ...rest)
    }
    syncBuiltinESMExports()
    const blocked = installBundledThemes(targetDir, sourceDir)
    assert.deepEqual(blocked.repaired, [])
    assert.equal(blocked.skipped.includes('pink-ansi.json'), true)
  } finally {
    builtinFs.readFileSync = originalRead
    syncBuiltinESMExports()
  }

  // A successful backup followed by a failed replacement is a failure, not a
  // protected skip: the target is absent until the next boot can retry.
  const failedHeal = join(targetDir, 'pink-ansi.json')
  writeFileSync(failedHeal, '{ broken')
  const originalWrite = builtinFs.writeFileSync
  try {
    builtinFs.writeFileSync = (path, data, options) => {
      if (String(path) === failedHeal && options?.flag === 'wx' && !existsSync(failedHeal)) {
        throw new Error('ENOSPC: replacement blocked')
      }
      return originalWrite(path, data, options)
    }
    syncBuiltinESMExports()
    const failed = installBundledThemes(targetDir, sourceDir)
    assert.equal(failed.failed.includes('pink-ansi.json'), true)
    assert.equal(failed.skipped.includes('pink-ansi.json'), false)
  } finally {
    builtinFs.writeFileSync = originalWrite
    syncBuiltinESMExports()
  }
  console.log('✓ torn installation: corrupt target backed up and reinstalled; user files and unreadable targets untouched')
}

// ── 12b. follow logging: the first settings doc is a baseline, not a flip ──
{
  // Default user layer (empty doc): no spurious "follow: disabled" line.
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({ settingsService: fakeSettingsService(settingsRecord, {}) })
  await applyAndSettle(ctx)
  assert.equal(
    record.infos.some(message => message.includes('follow: disabled')),
    false,
    'a baseline doc matching the default must not log a disabled flip',
  )

  // User layer that starts enabled: the cache applies during the baseline.
  const dataDir = join(sandboxHome, '.dsh-tui')
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  const enabledRecord = { registerCalls: [], watchers: [] }
  const { ctx: enabledCtx, record: enabledInfo } = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(enabledRecord, { followSystem: true }),
  })
  await applyAndSettle(enabledCtx)
  assert.equal(readThemePref(dataDir), 'pink-day', 'an enabled baseline applies the cached background')
  assert.equal(
    enabledInfo.infos.some(message => message.includes('follow: disabled')),
    false,
  )

  // A real toggle keeps its log.
  for (const watcher of enabledRecord.watchers) watcher({ followSystem: false })
  assert.equal(
    enabledInfo.infos.filter(message => message.includes('follow: disabled')).length,
    1,
    'disabling follow after the baseline logs exactly once',
  )
  assert.equal(readThemePref(dataDir), 'pink-day', 'the manual choice stays intact')
  console.log('✓ follow logging: baseline docs stay quiet, real toggles still log')
}

// ── 12. status injection: session handlers die with tuiStatus activation ────
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
    showGlyph: false,
    showClock: false,
    showTurns: true,
    statusScope: 'all-themes',
  }
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

// ── 13. toast feedback: the 0.10 seam surfaces what the logger cannot ───────
{
  setToastRetryDelaysForTests([5, 5])
  const dataDir = join(sandboxHome, '.dsh-tui')
  mkdirSync(dataDir, { recursive: true })

  // 13a. Startup baseline with a disagreeing cache: one success toast that
  // points at /reload (the live TUI still shows the previous palette). The
  // tuiToast seam trails apply on a real host (extensions row), so the send
  // must survive on the bounded retry until the seam shows up.
  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  const baselineDeliveries = []
  const baselineRecord = { registerCalls: [], watchers: [] }
  const baselineContext = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(baselineRecord, { followSystem: true }),
    deferToast: true,
  })
  await applyAndSettle(baselineContext.ctx)
  assert.equal(readThemePref(dataDir), 'pink-day', 'the pref write is synchronous, independent of the toast seam')
  baselineContext.record.activateToast(fakeToast(baselineDeliveries))
  const baselineDeadline = Date.now() + 2_000
  while (baselineDeliveries.length === 0 && Date.now() < baselineDeadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(baselineDeliveries.length, 1, 'a real baseline pref write toasts exactly once')
  assert.equal(baselineDeliveries[0][1], 'success')
  assert.match(baselineDeliveries[0][0], /pink-day/)
  assert.match(baselineDeliveries[0][0], /reload/)

  // 13b. Stable baseline (pref already matches the cache): quiet.
  const quietDeliveries = []
  const quietRecord = { registerCalls: [], watchers: [] }
  const { ctx: quietCtx } = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(quietRecord, { followSystem: true }),
    toast: fakeToast(quietDeliveries),
  })
  await applyAndSettle(quietCtx)
  assert.equal(quietDeliveries.length, 0, 'a baseline that changes nothing stays silent')

  // 13c. Toggle confirmations: an explicit enable always answers — with the
  // matching-cache confirmation, or the honest warning when nothing applies.
  const toggleDeliveries = []
  const toggleRecord = { registerCalls: [], watchers: [] }
  const { ctx: toggleCtx } = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(toggleRecord, {}),
    toast: fakeToast(toggleDeliveries),
  })
  await applyAndSettle(toggleCtx)
  for (const w of toggleRecord.watchers) w({ followSystem: true })
  assert.equal(toggleDeliveries.length, 1, 'toggle-on with a matching cache confirms')
  assert.equal(toggleDeliveries[0][1], 'success')
  assert.equal(/reload/.test(toggleDeliveries[0][0]), false, 'no reload hint when nothing changed')
  for (const w of toggleRecord.watchers) w({ followSystem: false })
  rmSync(join(dataDir, 'theme-follow.json'), { force: true })
  for (const w of toggleRecord.watchers) w({ followSystem: true })
  assert.equal(toggleDeliveries.length, 2, 'toggle-on without a cache answers too')
  assert.equal(toggleDeliveries[1][1], 'warning')

  // 13d. A toast dropped before the host sink exists is retried until delivered.
  const retryDeliveries = []
  const retryRecord = { registerCalls: [], watchers: [] }
  const { ctx: retryCtx } = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(retryRecord, {}),
    toast: fakeToast(retryDeliveries, { dropFirst: 1 }),
  })
  await applyAndSettle(retryCtx)
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: false, at: 1 }))
  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'pink-day' }, null, 2))
  for (const w of retryRecord.watchers) w({ followSystem: true })
  const retryDeadline = Date.now() + 2_000
  while (retryDeliveries.length === 0 && Date.now() < retryDeadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(retryDeliveries.length, 1, 'a dropped toast is retried and delivered')
  assert.match(retryDeliveries[0][0], /pink-night/)

  // 13e. Toast-seam-less host (dsh-TUI < 0.10): sends are silent no-ops and
  // the follow feature itself is unchanged. The retry chain stays bounded:
  // once it gives up, a seam arriving later must not resurrect the abandoned
  // toast.
  const legacyRecord = { registerCalls: [], watchers: [] }
  const legacyContext = makeStubCtx({
    status: fakeStatus([]),
    sections: fakeSections([]),
    settingsService: fakeSettingsService(legacyRecord, {}),
    deferToast: true,
  })
  await applyAndSettle(legacyContext.ctx)
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }))
  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  for (const w of legacyRecord.watchers) w({ followSystem: true })
  assert.equal(readThemePref(dataDir), 'pink-day', 'follow works unchanged without the toast seam')
  await new Promise(resolve => setTimeout(resolve, 50)) // the [5, 5] chain is long exhausted
  const lateDeliveries = []
  legacyContext.record.activateToast(fakeToast(lateDeliveries))
  await settle()
  assert.equal(lateDeliveries.length, 0, 'an abandoned toast is not resurrected by a late seam')

  // 13f. Shadow hint: legacy same-named files that are byte-identical to the
  // bundled copy are pointed out once on runtime confirmation; user edits
  // stay unmentioned. Files this activation installed itself are excluded
  // (they were already removed before the check).
  rmSync(sandboxThemes, { recursive: true, force: true })
  mkdirSync(sandboxThemes, { recursive: true })
  for (const theme of ['pink-night', 'pink-day', 'pink-ansi']) {
    writeFileSync(join(sandboxThemes, `${theme}.json`), readFileSync(join(pluginRoot, 'themes', `${theme}.json`), 'utf8'))
  }
  assert.deepEqual(findShadowedBundledThemes().sort(), ['pink-ansi.json', 'pink-day.json', 'pink-night.json'])
  const shadowDeliveries = []
  const shadowContext = makeStubCtx({ deferThemes: true, toast: fakeToast(shadowDeliveries) })
  apply(shadowContext.ctx)
  shadowContext.record.activateThemes(fakeThemes(shadowContext.record))
  await settle()
  assert.equal(shadowDeliveries.length, 1, 'identical legacy files are pointed out once')
  assert.equal(shadowDeliveries[0][1], undefined, 'the shadow hint is neutral, not an error')
  assert.match(shadowDeliveries[0][0], /pink-day\.json/)

  rmSync(sandboxThemes, { recursive: true, force: true })
  installBundledThemes()
  writeFileSync(join(sandboxThemes, 'pink-night.json'), '{ "name": "pink-night", "colors": { "text": "#123456" } }')
  const editDeliveries = []
  const editContext = makeStubCtx({ deferThemes: true, toast: fakeToast(editDeliveries) })
  apply(editContext.ctx)
  editContext.record.activateThemes(fakeThemes(editContext.record))
  await settle()
  assert.equal(editDeliveries.length, 1)
  assert.equal(/pink-night\.json/.test(editDeliveries[0][0]), false, 'a user-edited file is never nagged')
  assert.equal(/pink-day\.json/.test(editDeliveries[0][0]), true)

  // 13g. Corrupt-file self-heal is surfaced as a warning toast. The toast
  // seam trails apply on a real host, so the send waits on the retry chain.
  rmSync(sandboxThemes, { recursive: true, force: true })
  mkdirSync(sandboxThemes, { recursive: true })
  writeFileSync(join(sandboxThemes, 'pink-day.json'), '{ broken')
  const healDeliveries = []
  const healContext = makeStubCtx({ deferThemes: true, deferToast: true })
  apply(healContext.ctx)
  healContext.record.activateToast(fakeToast(healDeliveries))
  const healDeadline = Date.now() + 2_000
  while (healDeliveries.length === 0 && Date.now() < healDeadline) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal(healDeliveries.length, 1, 'a repaired theme file is surfaced')
  assert.equal(healDeliveries[0][1], 'warning')
  assert.match(healDeliveries[0][0], /pink-day\.json/)

  rmSync(sandboxThemes, { recursive: true, force: true })
  setToastRetryDelaysForTests([2_000, 4_000])
  console.log('✓ toast feedback: follow/self-heal/shadow hints delivered, dropped and seam-less sends retried, legacy hosts silent and bounded')
}

// ── 14. hot path: the token firehose must not reach render or the disk ──────
{
  const themePrefPath = join(sandboxHome, '.dsh-tui', 'theme.json')
  writeFileSync(themePrefPath, JSON.stringify({ theme: 'pink-night' }, null, 2))
  // Earlier scenarios ran status activations against a different pref; drop
  // their cached answer so this scenario starts from the fresh sandbox state.
  invalidateThemePrefCacheForTests()
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

    // A turn boundary renders — served by the warm pref cache (no disk hit
    // within the TTL), so even boundary renders stay off the filesystem.
    emit(record, 'session/event', session, { type: 'turn/end' })
    assert.equal(statusCalls.length, baselineCalls + 1, 'a turn boundary renders')
    assert.equal(prefReads, 0, 'the warm cache serves the boundary render')

    // A session switch repaints at its first turn/start with a fresh count.
    const nextSession = { id: 'h2' }
    emit(record, 'session/event', nextSession, { type: 'turn/start' })
    assert.equal(statusCalls.length, baselineCalls + 2)
    assert.match(statusCalls.at(-1)[1], /0✦$/)
    assert.equal(prefReads, 0)

    // Inside the TTL a pref rewrite is not yet visible and costs no read…
    writeFileSync(themePrefPath, JSON.stringify({ theme: 'dark' }, null, 2))
    emit(record, 'session/event', nextSession, { type: 'turn/end' })
    assert.equal(statusCalls.length, baselineCalls + 3)
    assert.match(statusCalls.at(-1)[1], /1✦$/, 'the cached pink pref keeps the line visible')
    assert.equal(prefReads, 0, 'the TTL serves the stale-but-pink answer without I/O')

    // …after invalidation (TTL expiry in production) the next render re-reads.
    invalidateThemePrefCacheForTests()
    emit(record, 'session/event', nextSession, { type: 'turn/end' })
    assert.equal(prefReads, 1, 'invalidation re-reads the pref exactly once')
    assert.equal(statusCalls.at(-1)[1], undefined, 'the non-pink pref hides the line')
  } finally {
    builtinFs.readFileSync = originalRead
    syncBuiltinESMExports()
    invalidateThemePrefCacheForTests()
  }
  console.log('✓ hot path: firehose events render nothing and never read the pref; boundaries use the cache')
}

console.log('\nAll plugin verifications passed.')
console.log(`(sandbox used: ${sandboxHome} — the real home was never touched)`)
