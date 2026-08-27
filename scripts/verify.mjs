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
const { installBundledThemes } = await import('../lib/types/themeAssets.js')
const { startStatusLine } = await import('../lib/types/statusLine.js')
const {
  themeForBackground,
  readThemePref,
  writeThemePref,
  readFollowCache,
  applyCachedFollow,
  runFollowSystem,
} = await import('../lib/types/autoTheme.js')

assert.equal(name, 'dsh-tui-theme')

/** A stub Cordis-like context; every seam optional and recorded. */
function makeStubCtx({ status, sections, settingsService } = {}) {
  const record = { handlers: new Map(), disposers: [], statusCalls: [], sectionsCalls: [], registerCalls: [], watchers: [], warnings: [], infos: [] }
  const logger = { info: msg => record.infos.push(String(msg)), warn: msg => record.warnings.push(String(msg)), error: () => {} }
  const base = {
    logger,
    get(serviceName) {
      if (serviceName === 'tuiStatus') return status
      if (serviceName === 'tuiSettingsSections') return sections
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
      }
      if (deps.every(dep => services[dep] !== undefined)) {
        const props = Object.fromEntries(deps.map(dep => [dep, services[dep]]))
        callback({ ...base, ...props })
      }
    },
  }
  return { ctx: base, record }
}

const fakeStatus = calls => ({ set(key, text) { calls.push([key, text]); return () => {} } })
const fakeSections = calls => ({ register(section) { calls.push(section); return () => {} } })
const fakeSettingsService = (record, doc) => ({
  register(namespace, schema) {
    record.registerCalls.push([namespace, schema])
    return {
      get: () => doc,
      watch(listener) { record.watchers.push(listener); return () => {} },
    }
  },
})

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
  apply(ctx)

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

// ── 3. idempotence + user-file protection ───────────────────────────────────
{
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
  apply(ctx, { autoInstallThemes: false })
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

  // The follow runner only applies cache and reports its result. It accepts no
  // stdin/stdout handles and cannot create a raw-mode lease or input listener.
  const logs = []
  runFollowSystem(dataDir, () => true, message => logs.push(message))
  assert.deepEqual(logs, ['follow: applied cached background (pink-day)'])

  writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'dark' }, null, 2))
  runFollowSystem(dataDir, () => false, message => logs.push(message))
  assert.equal(readThemePref(dataDir), 'dark', 'inactive follow preserves manual choice')
  console.log('✓ follow: cached background applies without terminal I/O')
}

// ── 6. statusEnabled: false silences the whole line ─────────────────────────
{
  const statusCalls = []
  const { ctx } = makeStubCtx({ status: fakeStatus(statusCalls) })
  apply(ctx, { statusEnabled: false })
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
  apply(ctx, { followSystem: true })
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
  apply(ctx)
  const session = { id: 'g1' }

  // Pink active → renders.
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 1✦$/)

  // Non-pink theme active → hidden by default.
  writeFileSync(themePrefPath, JSON.stringify({ theme: 'dark' }, null, 2))
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
  apply(ctx) // must not throw
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
  apply(ctx, { followSystem: true })
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
  console.log('✓ torn installation: corrupt target backed up and reinstalled; user files and unreadable targets untouched')
}

// ── 12b. follow logging: the first settings doc is a baseline, not a flip ──
{
  // Default user layer (empty doc): no spurious "follow: disabled" line.
  const settingsRecord = { registerCalls: [], watchers: [] }
  const { ctx, record } = makeStubCtx({ settingsService: fakeSettingsService(settingsRecord, {}) })
  apply(ctx)
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
  apply(enabledCtx)
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

console.log('\nAll plugin verifications passed.')
console.log(`(sandbox used: ${sandboxHome} — the real home was never touched)`)
