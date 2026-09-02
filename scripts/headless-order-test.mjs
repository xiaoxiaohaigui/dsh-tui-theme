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
const readState = () => {
  const runtime = app.get('tuiStatus')
  const settingsRuntime = app.get('tuiSettingsSections')
  const settingsHost = settingsSectionsModule.getHostSettingsSections(settingsRuntime)
  return {
    pinkBinds: collectBinds(),
    snapshot: statusModule.getHostStatusStore(runtime)?.getSnapshot(),
    settingsSection: settingsHost?.list().find(section => section.ns === SETTINGS_NAMESPACE),
  }
}

let state = readState()
const deadline = Date.now() + READY_TIMEOUT_MS
while (
  (state.pinkBinds.length === 0 ||
    !state.snapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY) ||
    state.settingsSection === undefined) &&
  Date.now() < deadline
) {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  state = readState()
}

const { pinkBinds, snapshot, settingsSection } = state
assert.equal(
  STATUS_CONTRIBUTION_KEY,
  SETTINGS_NAMESPACE,
  'the status contribution key must stay equal to the settings namespace (src/pluginId.ts)',
)
assert.ok(pinkBinds.length > 0, `plugin must bind through the late status service within ${READY_TIMEOUT_MS}ms`)
assert.ok(
  snapshot?.some?.(entry => entry.key === STATUS_CONTRIBUTION_KEY),
  `status store must contain the plugin contribution within ${READY_TIMEOUT_MS}ms`,
)
assert.ok(
  settingsSection,
  `plugin must register its /settings section through the late settings service within ${READY_TIMEOUT_MS}ms`,
)
assertSettingsContract(assert, settingsSection)
console.log(`OK headless order: ${pinkBinds.length} ledger bind(s), status contribution, settings section`)
