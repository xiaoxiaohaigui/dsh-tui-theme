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

// ── Phase 2: real-host toast delivery (0.10 tuiToast seam) ──────────────────
// A pre-0.10 user's byte-identical static files shadow the runtime registry;
// the plugin must surface that through the real toast service. The sink is
// attached after the extensions row applies, so a toast fired earlier is
// dropped and must arrive through the relay's bounded retry instead — this
// exercises both the show() caller binding outside the inject callback and
// the drop-retry path against the real host.
const toastModule = await import(pathToFileURL(join(adapter, 'toast.js')).href)
const sandbox2 = mkdtempSync(join(tmpdir(), 'pink-toast-'))
process.env.USERPROFILE = sandbox2
process.env.HOME = sandbox2
const dataDir2 = join(sandbox2, '.dsh-tui')
mkdirSync(join(dataDir2, 'themes'), { recursive: true })
writeFileSync(join(dataDir2, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))
for (const theme of ['pink-night', 'pink-day', 'pink-ansi']) {
  writeFileSync(
    join(dataDir2, 'themes', `${theme}.json`),
    readFileSync(join(pluginRoot, 'themes', `${theme}.json`), 'utf8'),
  )
}

const deliveries = []
const app2 = new Context()
await app2.plugin(pluginHost.default ?? pluginHost)
const admitted2 = await testUtils.mountAdmitted(app2, SETTINGS_NAMESPACE, manifest)
await admitted2.context.plugin(pink)
await app2.plugin(extensions.default ?? extensions)
toastModule.getHostToastStore(app2.get('tuiToast'))?.setSink(delivery => deliveries.push(delivery))

const toastDeadline = Date.now() + 8_000
while (deliveries.length === 0 && Date.now() < toastDeadline) {
  await testUtils.sleep(25)
}
assert.ok(deliveries.length >= 1, 'the shadow-hint toast must reach the host sink (retry included)')
assert.equal(deliveries[0].color, undefined, 'the shadow hint is neutral')
for (const file of ['pink-night.json', 'pink-day.json', 'pink-ansi.json']) {
  assert.ok(deliveries[0].text.includes(file), `hint must name ${file}`)
}
await admitted2.fiber.dispose()
await testUtils.sleep(50)
console.log('OK toast: shadow hint delivered through the real tuiToast seam')

// ── Phase 3: apply-time toasts reach the sink through the seam-late retry ───
// On a real 0.10 host the tuiToast service arrives with the extensions row,
// after this plugin's apply, so toasts fired during apply (the self-heal
// warning, the boot-follow result) can only survive through the relay's
// bounded retry. A settings service present at apply time (the dsh CLI core
// service) drives the boot-follow path with a disagreeing cache.
const sandbox3 = mkdtempSync(join(tmpdir(), 'pink-apply-toast-'))
process.env.USERPROFILE = sandbox3
process.env.HOME = sandbox3
const dataDir3 = join(sandbox3, '.dsh-tui')
mkdirSync(join(dataDir3, 'themes'), { recursive: true })
// Corrupt self-heal target; boot-follow cache disagrees with the persisted pref.
writeFileSync(join(dataDir3, 'themes', 'pink-night.json'), '{ this is not json')
writeFileSync(join(dataDir3, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))
writeFileSync(join(dataDir3, 'theme-follow.json'), JSON.stringify({ light: true, at: 1 }, null, 2))

// Minimal settings service standing in for the dsh CLI core service: present
// at plugin apply time with followSystem already enabled, mirrors scope.watch.
const fakeSettings = {
  register() {
    return {
      get: () => ({ followSystem: true }),
      watch(listener) {
        listener({ followSystem: true })
        return () => {}
      },
    }
  },
}

const deliveries3 = []
const app3 = new Context()
await app3.plugin(pluginHost.default ?? pluginHost)
const admitted3 = await testUtils.mountAdmitted(app3, SETTINGS_NAMESPACE, manifest)
app3.provide('settings', fakeSettings)
await admitted3.context.plugin(pink)
await app3.plugin(extensions.default ?? extensions)
toastModule.getHostToastStore(app3.get('tuiToast'))?.setSink(delivery => deliveries3.push(delivery))

const applyToastDeadline = Date.now() + 8_000
while (deliveries3.length < 2 && Date.now() < applyToastDeadline) {
  await testUtils.sleep(25)
}
const healToast = deliveries3.find(delivery => delivery.text.includes('已修复'))
assert.ok(healToast, 'the self-heal warning fired during apply must reach the host sink')
assert.equal(healToast.color, 'warning', 'the self-heal toast is a warning')
assert.ok(healToast.text.includes('pink-night.json'), 'the heal toast names the repaired file')
const followToast = deliveries3.find(delivery => delivery.text.includes('已按保存的终端背景'))
assert.ok(followToast, 'the boot-follow result fired at settings time must reach the host sink')
assert.equal(followToast.color, 'success', 'the boot-follow toast is a success')
assert.ok(followToast.text.includes('pink-day') && followToast.text.includes('reload'), 'the follow toast names the new theme and the reload hint')
assert.equal(JSON.parse(readFileSync(join(dataDir3, 'theme.json'), 'utf8')).theme, 'pink-day', 'the follow pref write still happened')
await admitted3.fiber.dispose()
console.log('OK toast phase 3: apply-time self-heal and boot-follow toasts delivered on the real host')
