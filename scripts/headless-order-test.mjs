/**
 * End-to-end order test with the installed dsh-TUI services. Composes this
 * plugin before the extension services to exercise late service injection.
 *
 * DSH_TUI_ADAPTER_DIR may point at dsh-TUI's lib/types/dsh-adapter directory.
 * When omitted, the installed devDependency is used.
 * Script-side floor: the adapter must be a built dsh-TUI >= 0.9.0 — the
 * settings-sections module and its getHostSettingsSections probe landed there.
 * Set DSH_TUI_EXPECTED_VERSION only when an explicit release baseline needs
 * to be pinned; ordinary development verifies the supplied host as-is.
 *
 * Besides the assembly assertions this gates the embedded palette: when the
 * supplied host carries the built-in pink family, its accent /
 * inactiveShimmer / subtle for all three themes must match src/palette.ts by
 * value. A host without the family (every released dsh-TUI so far) prints a
 * one-line skip note instead.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { assertSettingsContract, SETTINGS_NAMESPACE } from './expected-settings-contract.mjs'

// The tuiStatus contribution key and the effect-ledger resource id. Deliberately
// a separate constant from SETTINGS_NAMESPACE: they hold the same value today
// (see src/pluginId.ts), but this assertion pins that equality while the status
// snapshot / ledger filters below must never silently track the namespace.
const STATUS_CONTRIBUTION_KEY = SETTINGS_NAMESPACE

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const req = createRequire(import.meta.url)
const packageJson = req.resolve('@deepseek-harness-tui/dsh-tui/package.json')
const devHostRoot = dirname(packageJson)
const adapter = process.env.DSH_TUI_ADAPTER_DIR || join(devHostRoot, 'lib', 'types', 'dsh-adapter')

if (!existsSync(join(adapter, 'extensions.js'))) {
  throw new Error(`dsh-TUI adapter not found at ${adapter}`)
}

const hostPackagePath = join(adapter, '..', '..', '..', 'package.json')
if (!existsSync(hostPackagePath)) {
  throw new Error(`dsh-TUI package metadata not found above adapter at ${adapter}`)
}
const hostPackage = JSON.parse(readFileSync(hostPackagePath, 'utf8'))
assert.match(hostPackage.version, /^\d+\.\d+\.\d+(?:[-+].+)?$/u, 'host adapter must declare a version')
const expectedVersion = process.env.DSH_TUI_EXPECTED_VERSION
if (expectedVersion !== undefined && expectedVersion !== '') {
  assert.equal(hostPackage.version, expectedVersion, `expected dsh-TUI adapter ${expectedVersion}, received ${hostPackage.version}`)
} else {
  console.log(`* host adapter ${hostPackage.version} (no explicit version pin)`)
}

// ── Palette drift gate ─────────────────────────────────────────────────────
// The garnish colours (the family's accent / inactiveShimmer / subtle) are
// embedded in src/palette.ts: dsh-TUI exposes no palette-query seam, so the
// plugin cannot read what the host renders with. A host build that carries the
// built-in family is the only authority on those values, so compare the nine
// cells against it whenever it is there — an upstream recolour would otherwise
// leave the garnish silently on the old palette. (The workspace-level probe
// probes/compare-preset-palettes.mjs checks the whole 73-key palettes; this
// gate covers the three keys the plugin actually ships.)
const hostThemePath = join(dirname(adapter), 'theme.js')
const hostTheme = existsSync(hostThemePath) ? await import(pathToFileURL(hostThemePath).href) : undefined
const hostThemeNames = Array.isArray(hostTheme?.THEME_NAMES) ? hostTheme.THEME_NAMES : []
const hostPinkNames = hostThemeNames.filter(name => name.startsWith('pink-'))
if (typeof hostTheme?.getTheme !== 'function' || hostPinkNames.length === 0) {
  console.log(
    `* host carries no built-in pink family (${hostThemePath}); palette equivalence not checked — ` +
      'point DSH_TUI_ADAPTER_DIR at a build that has it to run this gate',
  )
} else {
  const { PINK_THEMES } = await import(pathToFileURL(join(pluginRoot, 'lib', 'types', 'themePref.js')).href)
  const { statusColorsFor } = await import(pathToFileURL(join(pluginRoot, 'lib', 'types', 'palette.js')).href)
  // #rrggbb → the rgb(r,g,b) spelling the host stores palettes in; ansi:* is
  // already the host's own vocabulary. Both sides normalize, so the comparison
  // is value-level, not spelling-level.
  const normalizeColor = value => {
    if (typeof value !== 'string') return value
    const hex = /^#([0-9a-fA-F]{6})$/u.exec(value)
    if (hex !== null) {
      const packed = Number.parseInt(hex[1], 16)
      return `rgb(${(packed >> 16) & 255},${(packed >> 8) & 255},${packed & 255})`
    }
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/u.exec(value)
    return rgb === null ? value : `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`
  }
  // Names drift before values do: a new or renamed pink built-in means
  // src/themePref.ts PINK_THEMES and src/palette.ts are stale.
  const unknown = hostPinkNames.filter(name => !PINK_THEMES.has(name)).sort()
  assert.deepEqual(
    unknown,
    [],
    `host carries pink built-ins this plugin does not know: ${unknown.join(', ')} — add them to src/themePref.ts PINK_THEMES and src/palette.ts`,
  )
  const missing = [...PINK_THEMES].filter(name => !hostThemeNames.includes(name)).sort()
  assert.deepEqual(
    missing,
    [],
    `this plugin ships pink names this host does not carry: ${missing.join(', ')} — sync src/themePref.ts PINK_THEMES and src/palette.ts with the host`,
  )
  // glyph ← accent, clock/turns ← inactiveShimmer, separator ← subtle — the
  // mapping src/palette.ts documents. Nine cells, host value first.
  const CELLS = [
    ['accent', 'glyph'],
    ['inactiveShimmer', 'text'],
    ['subtle', 'separator'],
  ]
  let compared = 0
  for (const name of [...PINK_THEMES].sort()) {
    const palette = hostTheme.getTheme(name)
    const colors = statusColorsFor(name)
    for (const [hostKey, pluginKey] of CELLS) {
      compared += 1
      assert.equal(
        normalizeColor(colors[pluginKey]),
        normalizeColor(palette?.[hostKey]),
        `${name}.${hostKey}: host ${JSON.stringify(palette?.[hostKey])} vs src/palette.ts ${JSON.stringify(colors[pluginKey])} — sync the embedded table`,
      )
    }
  }
  assert.equal(compared, 9, 'the family comparison must cover exactly nine cells')
  console.log('OK palette: 9/9 garnish cells match the host built-in pink family')
}

const sandbox = mkdtempSync(join(tmpdir(), 'pink-order-'))
process.env.USERPROFILE = sandbox
process.env.HOME = sandbox

const dataDir = join(sandbox, '.dsh-tui')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))

// Guard the script-side floor explicitly: settings-sections.js first shipped
// in dsh-TUI 0.9.0, so a bare ERR_MODULE_NOT_FOUND from a dynamic import
// would hide the real reason a host tree is too old for this test.
const settingsSectionsPath = join(adapter, 'settings-sections.js')
if (!existsSync(settingsSectionsPath)) {
  throw new Error(
    `dsh-TUI adapter at ${adapter} has no settings-sections.js; this integration test needs a host >= 0.9.0`,
  )
}

const hostRequire = createRequire(join(adapter, 'extensions.js'))
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const extensions = await import(pathToFileURL(join(adapter, 'extensions.js')).href)
const statusModule = await import(pathToFileURL(join(adapter, 'status.js')).href)
const settingsSectionsModule = await import(pathToFileURL(settingsSectionsPath).href)
const pluginHostModule = await import(pathToFileURL(join(adapter, 'plugin-host.js')).href)
const pink = await import(pathToFileURL(join(pluginRoot, 'lib', 'types', 'index.js')).href)

const app = new Context()
await app.plugin(pluginHostModule.default ?? pluginHostModule)
const testUtilsPath = join(adapter, '..', 'test-utils.js')
if (existsSync(testUtilsPath)) {
  const testUtils = await import(pathToFileURL(testUtilsPath).href)
  const manifest = testUtils.testManifest({ id: SETTINGS_NAMESPACE })
  const admitted = await testUtils.mountAdmitted(app, SETTINGS_NAMESPACE, manifest)
  await admitted.context.plugin(pink)
} else {
  // dsh-TUI < 0.10 has no public admission test helpers; keep the historical
  // manual mount and report the structural limitation instead of hiding it.
  console.log('* mountAdmitted unavailable on this host; using manual plugin mount')
  await app.plugin(pink)
}
await app.plugin(extensions.default ?? extensions)
await app.plugin(settingsSectionsModule.default ?? settingsSectionsModule)

// The late injections resolve asynchronously; poll for every observable
// outcome instead of sleeping a fixed wall-clock delay.
const READY_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 25
const collectBinds = () => {
  const ledger = join(dataDir, 'effect-ledger.jsonl')
  return existsSync(ledger)
    ? readFileSync(ledger, 'utf8').trim().split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(entry => entry.resource?.id === STATUS_CONTRIBUTION_KEY)
    : []
}
// The plugin renders its contribution through the rich view path on hosts
// with tuiStatus.registerView (0.10.1+) and through the scalar set() path on
// older ones — the key is the same, only the store half differs.
const readState = () => {
  const runtime = app.get('tuiStatus')
  const settingsRuntime = app.get('tuiSettingsSections')
  const settingsHost = settingsSectionsModule.getHostSettingsSections(settingsRuntime)
  const store = statusModule.getHostStatusStore(runtime)
  return {
    pinkBinds: collectBinds(),
    snapshot: store?.getSnapshot(),
    viewSnapshot: typeof store?.getViewSnapshot === 'function' ? store.getViewSnapshot() : [],
    settingsSection: settingsHost?.list().find(section => section.ns === SETTINGS_NAMESPACE),
  }
}

let state = readState()
const deadline = Date.now() + READY_TIMEOUT_MS
const contributionVisible = s =>
  s.pinkBinds.length > 0 &&
  (s.snapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY) === true ||
    s.viewSnapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY) === true) &&
  s.settingsSection !== undefined
while (!contributionVisible(state) && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  state = readState()
}

const { pinkBinds, snapshot, viewSnapshot, settingsSection } = state
assert.equal(
  STATUS_CONTRIBUTION_KEY,
  SETTINGS_NAMESPACE,
  'the status contribution key must stay equal to the settings namespace (src/pluginId.ts)',
)
assert.ok(pinkBinds.length > 0, `plugin must bind through the late status service within ${READY_TIMEOUT_MS}ms`)
assert.ok(
  snapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY) ||
    viewSnapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY),
  `status store must contain the plugin contribution within ${READY_TIMEOUT_MS}ms`,
)
assert.ok(
  settingsSection,
  `plugin must register its /settings section through the late settings service within ${READY_TIMEOUT_MS}ms`,
)
assertSettingsContract(assert, settingsSection)
if (typeof statusModule.getHostStatusStore(app.get('tuiStatus'))?.getViewSnapshot === 'function') {
  const view = viewSnapshot.find(entry => entry.key === STATUS_CONTRIBUTION_KEY)
  assert.ok(view, 'a registerView-capable host must carry the contribution as a rich view')
  assert.equal(view.maxRows, 1, 'the rich status view requests exactly one row')
  assert.equal(typeof view.component, 'function', 'the rich status view carries a component')
  assert.equal(
    snapshot.some(entry => entry.key === STATUS_CONTRIBUTION_KEY),
    false,
    'the two render paths are mutually exclusive: the rich path contributes no scalar text',
  )
  console.log('OK headless order: rich view registered (maxRows 1), ledger bind, settings section')
} else {
  assert.ok(
    snapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY),
    'a set()-only host must carry the contribution as scalar text',
  )
  console.log(`OK headless order: ${pinkBinds.length} ledger bind(s), status contribution, settings section`)
}
