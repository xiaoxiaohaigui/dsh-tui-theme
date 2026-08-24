/**
 * Hermetic verification for dsh-tui-pink-theme (no TTY, no real HOME).
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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const sandboxHome = mkdtempSync(join(tmpdir(), 'pink-theme-verify-'))
process.env.USERPROFILE = sandboxHome
process.env.HOME = sandboxHome

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const sandboxThemes = join(sandboxHome, '.dsh-tui', 'themes')

const { name, apply } = await import('../lib/types/index.js')
const { installBundledThemes } = await import('../lib/types/themeAssets.js')
const {
  themeForBackground,
  readThemePref,
  writeThemePref,
  readFollowCache,
  applyCachedFollow,
  refreshDetectedBackground,
} = await import('../lib/types/autoTheme.js')

assert.equal(name, 'dsh-tui-theme')

/** A stub Cordis-like context; every seam optional and recorded. */
function makeStubCtx({ status, sections, settingsService } = {}) {
  const record = { handlers: new Map(), disposers: [], statusCalls: [], sectionsCalls: [], registerCalls: [], watchers: [], warnings: [] }
  const logger = { info: () => {}, warn: msg => record.warnings.push(String(msg)), error: () => {} }
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

  // Settings namespace registered and the section declared.
  assert.equal(settingsRecord.registerCalls.length, 1)
  assert.equal(sectionsCalls.length, 1)
  assert.equal(sectionsCalls[0].ns, 'dsh-tui-theme')
  assert.equal(sectionsCalls[0].fields.length, 5)

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

// ── 5. background follow: detection, cache, pref rewriting ─────────────────
{
  const dataDir = join(sandboxHome, '.dsh-tui')
  assert.equal(themeForBackground(true), 'pink-day')
  assert.equal(themeForBackground(false), 'pink-night')

  // Fake TTY streams: the "terminal" answers OSC 11 with a light background.
  const writes = []
  const unshifted = []
  const listeners = new Map()
  const rawModeCalls = []
  const fakeStdout = { isTTY: true, write: data => { writes.push(String(data)); return true } }
  const fakeStdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(on) { rawModeCalls.push(on); this.isRaw = on },
    isPaused: () => true,
    resume() {},
    on(event, fn) { listeners.set(event, fn) },
    removeListener(event, fn) { listeners.delete(event) },
    unshift(buf) { unshifted.push(buf.toString('latin1')) },
    emit() { return true },
  }
  const emitStdin = data => { listeners.get('data')?.(Buffer.from(data, 'latin1')) }
  const replyLator = () => {
    queueMicrotask(() => emitStdin('\x1b]11;rgb:f6f3/f6f3/f6ed\x1b\\'))
  }

  // No reply → timeout → undefined, nothing written.
  {
    const immediateTimeout = cb => { queueMicrotask(cb); return 0 }
    const light = await refreshDetectedBackground(dataDir, () => true, fakeStdout, fakeStdin, immediateTimeout)
    assert.equal(light, undefined)
    assert.equal(readFollowCache(dataDir), undefined)
    assert.equal(readThemePref(dataDir), undefined)
  }
  assert.deepEqual(rawModeCalls, [true, false], 'raw mode restored after the attempt')

  // Light reply → cache + pref written, raw mode restored.
  fakeStdout.write = data => { writes.push(String(data)); queueMicrotask(replyLator); return true }
  const light = await refreshDetectedBackground(dataDir, () => true, fakeStdout, fakeStdin, setTimeout)
  assert.equal(light, true)
  assert.equal(readFollowCache(dataDir).light, true)
  assert.equal(readThemePref(dataDir), 'pink-day')
  assert.match(writes.at(-1), /^\x1b\]11;\?\x07\x1b\[c$/, 'OSC 11 query + DA1 sentinel')
  assert.deepEqual(rawModeCalls, [true, false, true, false])

  // Cached dark flip rewrites the pref synchronously (pre-mount path).
  writeFileSync(join(dataDir, 'theme-follow.json'), JSON.stringify({ light: false, at: 1 }))
  const applied = applyCachedFollow(dataDir)
  assert.equal(applied, 'pink-night')
  assert.equal(readThemePref(dataDir), 'pink-night')

  // Same value → no rewrite churn (mtime-agnostic: pref already matches).
  assert.equal(applyCachedFollow(dataDir), 'pink-night')

  // Non-TTY → undefined immediately, no writes.
  writes.length = 0
  assert.equal(await refreshDetectedBackground(dataDir, () => true, { isTTY: false }, fakeStdin, setTimeout), undefined)
  assert.equal(writes.length, 0)

  // Keystrokes arriving inside the window (before/after the reply) are
  // replayed via unshift instead of being swallowed.
  unshifted.length = 0
  fakeStdout.write = data => {
    writes.push(String(data))
    queueMicrotask(() => emitStdin('hi\x1b]11;rgb:1111/2222/3333\x07there'))
    return true
  }
  const light2 = await refreshDetectedBackground(dataDir, () => true, fakeStdout, fakeStdin, setTimeout)
  assert.equal(light2, false)
  assert.equal(unshifted.join(''), 'hithere', 'non-reply bytes replayed for the host parser')

  // DA1 before any OSC 11 reply → early exit, nothing written.
  unshifted.length = 0
  fakeStdout.write = data => {
    writes.push(String(data))
    queueMicrotask(() => emitStdin('\x1b[?62;22c'))
    return true
  }
  const light3 = await refreshDetectedBackground(dataDir, () => true, fakeStdout, fakeStdin, setTimeout)
  assert.equal(light3, undefined)

  // Follow turned off mid-window → detection still resolves but the pref
  // write is skipped (off = manual choice preserved).
  rmSync(join(dataDir, 'theme-follow.json'), { force: true })
  rmSync(join(dataDir, 'theme.json'), { force: true })
  let active = true
  fakeStdout.write = data => {
    writes.push(String(data))
    queueMicrotask(() => {
      active = false
      emitStdin('\x1b]11;rgb:ffff/ffff/ffff\x1b\\')
    })
    return true
  }
  const light4 = await refreshDetectedBackground(dataDir, () => active, fakeStdout, fakeStdin, setTimeout)
  assert.equal(light4, true)
  assert.equal(existsSync(join(dataDir, 'theme.json')), false, 'in-flight reply must not write after off')
  assert.equal(existsSync(join(dataDir, 'theme-follow.json')), false)
  // Same window with follow still on → the write lands.
  active = true
  fakeStdout.write = data => {
    writes.push(String(data))
    queueMicrotask(() => emitStdin('\x1b]11;rgb:ffff/ffff/ffff\x1b\\'))
    return true
  }
  await refreshDetectedBackground(dataDir, () => active, fakeStdout, fakeStdin, setTimeout)
  assert.equal(readThemePref(dataDir), 'pink-day')
  console.log('✓ follow: OSC 11 detect → cache → pref, keystroke replay, mid-window off')
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

// ── 7. followSystem honors the /settings user layer live ────────────────────
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
  // Cordis layer on, empty user layer, no cache yet → no pref churn.
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
  process.env.DSH_TUI_THEME = 'pink-day'
  for (const w of settingsRecord.watchers) w({})
  emit(record, 'session/event', session, { type: 'turn/end' })
  assert.match(statusCalls.at(-1)[1], /^✿ · \d{2}:\d{2} · 4✦$/)
  delete process.env.DSH_TUI_THEME
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

// ── 10. follow fallback timer: lifecycle-managed (M5) ──────────────────────
{
  const infos = []
  const { ctx, record } = makeStubCtx() // no settings service → backstop path
  ctx.logger.info = msg => infos.push(String(msg))
  apply(ctx, { followSystem: true })
  // Dispose before the 150ms backstop can fire.
  for (const dispose of record.disposers) dispose()
  await new Promise(r => setTimeout(r, 250))
  assert.equal(
    infos.some(m => m.includes('follow:')),
    false,
    'disposed plugin must not start follow from the backstop timer',
  )
  console.log('✓ follow fallback timer: cleared on dispose, never fires post-teardown')
}

console.log('\nAll plugin verifications passed.')
console.log(`(sandbox used: ${sandboxHome} — the real home was never touched)`)
