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
  assert.equal(sectionsCalls[0].fields.length, 4)

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
  }
  const emitStdin = data => { listeners.get('data')?.(Buffer.from(data, 'latin1')) }
  const replyLator = () => {
    queueMicrotask(() => emitStdin('\x1b]11;rgb:f6f3/f6f3/f6ed\x1b\\'))
  }

  // No reply → timeout → undefined, nothing written.
  {
    const immediateTimeout = cb => { queueMicrotask(cb); return 0 }
    const light = await refreshDetectedBackground(dataDir, fakeStdout, fakeStdin, immediateTimeout)
    assert.equal(light, undefined)
    assert.equal(readFollowCache(dataDir), undefined)
    assert.equal(readThemePref(dataDir), undefined)
  }
  assert.deepEqual(rawModeCalls, [true, false], 'raw mode restored after the attempt')

  // Light reply → cache + pref written, raw mode restored.
  fakeStdout.write = data => { writes.push(String(data)); queueMicrotask(replyLator); return true }
  const light = await refreshDetectedBackground(dataDir, fakeStdout, fakeStdin, setTimeout)
  assert.equal(light, true)
  assert.equal(readFollowCache(dataDir).light, true)
  assert.equal(readThemePref(dataDir), 'pink-day')
  assert.match(writes.at(-1), /^\x1b\]11;\?\x07$/)
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
  assert.equal(await refreshDetectedBackground(dataDir, { isTTY: false }, fakeStdin, setTimeout), undefined)
  assert.equal(writes.length, 0)
  console.log('✓ follow: OSC 11 detect → cache → pink-day/pink-night pref, safe fallbacks')
}

console.log('\nAll plugin verifications passed.')
console.log(`(sandbox used: ${sandboxHome} — the real home was never touched)`)
