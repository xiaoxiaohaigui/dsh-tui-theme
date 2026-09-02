/**
 * Dev-only integration check for dsh-TUI 0.10 runtime theme registration.
 * Uses the installed host adapter and the real admission path; no user HOME
 * or static theme files are touched.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const req = createRequire(import.meta.url)
const hostPackagePath = req.resolve('@deepseek-harness-tui/dsh-tui/package.json')
const hostRoot = dirname(hostPackagePath)
const adapter = process.env.DSH_TUI_ADAPTER_DIR || join(hostRoot, 'lib', 'types', 'dsh-adapter')
if (!existsSync(join(adapter, 'extensions.js'))) {
  throw new Error(`dsh-TUI runtime adapter not found at ${adapter}`)
}
if (!existsSync(join(adapter, 'themes.js'))) {
  console.log('* runtime theme seam unavailable on this host; skipping 0.10 headless check')
  process.exit(0)
}

const sandbox = mkdtempSync(join(tmpdir(), 'pink-runtime-themes-'))
process.env.USERPROFILE = sandbox
process.env.HOME = sandbox
const dataDir = join(sandbox, '.dsh-tui')
const staticThemes = join(dataDir, 'themes')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))

const hostRequire = createRequire(join(adapter, 'extensions.js'))
const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
const pluginHost = await import(pathToFileURL(join(adapter, 'plugin-host.js')).href)
const extensions = await import(pathToFileURL(join(adapter, 'extensions.js')).href)
const themesModule = await import(pathToFileURL(join(adapter, 'themes.js')).href)
const themeModule = await import(pathToFileURL(join(adapter, '..', 'theme.js')).href)
const testUtils = await import(pathToFileURL(join(adapter, '..', 'test-utils.js')).href)
const pink = await import(pathToFileURL(join(pluginRoot, 'lib', 'types', 'index.js')).href)
const { SETTINGS_NAMESPACE } = await import(pathToFileURL(join(pluginRoot, 'scripts', 'expected-settings-contract.mjs')).href)

const app = new Context()
await app.plugin(pluginHost.default ?? pluginHost)
const manifest = testUtils.testManifest({ id: SETTINGS_NAMESPACE })
const admitted = await testUtils.mountAdmitted(app, SETTINGS_NAMESPACE, manifest)
await admitted.context.plugin(pink)
await app.plugin(extensions.default ?? extensions)

const host = themesModule.getHostThemes(app.get('tuiThemes'))
assert.ok(host, 'runtime theme host must be mounted')
const deadline = Date.now() + 5_000
while (host.getSnapshot().length !== 3 && Date.now() < deadline) {
  await testUtils.sleep(25)
}
const snapshot = host.getSnapshot()
assert.deepEqual(snapshot.map(entry => entry.name).sort(), ['pink-ansi', 'pink-day', 'pink-night'])

for (const entry of snapshot) {
  const expected = JSON.parse(readFileSync(join(pluginRoot, 'themes', `${entry.name}.json`), 'utf8'))
  assert.equal(entry.displayName, expected.displayName)
  assert.equal(entry.base, expected.base)
  assert.deepEqual(entry.colors, expected.colors)
  assert.deepEqual(host.resolve(entry.name), { ...themeModule.getTheme(entry.base), ...expected.colors })
  assert.equal(themeModule.getTheme(entry.name).claude, expected.colors.claude)
}
assert.equal(existsSync(staticThemes), false, 'runtime registration must not create static theme files')
await testUtils.sleep(1_700)
assert.equal(existsSync(staticThemes), false, 'runtime confirmation must leave no static fallback files')

const ledgerPath = join(dataDir, 'effect-ledger.jsonl')
const readLedger = () => (existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [])
const themeCreates = readLedger().filter(entry => entry.resource?.kind === 'theme' && entry.operation === 'create')
assert.deepEqual(themeCreates.map(entry => entry.resource.id).sort(), ['pink-ansi', 'pink-day', 'pink-night'])

await admitted.fiber.dispose()
await testUtils.sleep(50)
assert.deepEqual(host.getSnapshot(), [], 'disposing the admitted plugin must release runtime themes')
const themeReleases = readLedger().filter(entry => entry.resource?.kind === 'theme' && entry.operation === 'release')
assert.deepEqual(themeReleases.map(entry => entry.resource.id).sort(), ['pink-ansi', 'pink-day', 'pink-night'])
assert.deepEqual(themeModule.getTheme('pink-night'), themeModule.getTheme('dark'), 'disposed runtime theme no longer resolves')
console.log('OK runtime themes: 3 registered, no static files, ledger create/release, disposal clean')
