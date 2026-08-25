/**
 * End-to-end order test with the installed dsh-TUI services. Composes this
 * plugin before the extension services to exercise late service injection.
 *
 * DSH_TUI_ADAPTER_DIR must point at dsh-TUI's lib/types/dsh-adapter directory.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const adapter = process.env.DSH_TUI_ADAPTER_DIR
if (adapter === undefined || adapter === '') {
  throw new Error('DSH_TUI_ADAPTER_DIR must point at dsh-TUI lib/types/dsh-adapter for this host integration test.')
}

if (!existsSync(join(adapter, 'extensions.js'))) {
  throw new Error(`dsh-TUI adapter not found at ${adapter}`)
}

const hostPackagePath = join(adapter, '..', '..', '..', 'package.json')
if (!existsSync(hostPackagePath)) {
  throw new Error(`dsh-TUI package metadata not found above adapter at ${adapter}`)
}
const hostPackage = JSON.parse(readFileSync(hostPackagePath, 'utf8'))
assert.equal(hostPackage.version, '0.9.2', `expected dsh-TUI adapter 0.9.2, received ${hostPackage.version}`)

const sandbox = mkdtempSync(join(tmpdir(), 'pink-order-'))
process.env.USERPROFILE = sandbox
process.env.HOME = sandbox

const dataDir = join(sandbox, '.dsh-tui')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'theme.json'), JSON.stringify({ theme: 'pink-night' }, null, 2))

const req = createRequire(join(adapter, 'extensions.js'))
const { Context } = await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')).href)
const extensions = await import(pathToFileURL(join(adapter, 'extensions.js')).href)
const ledgerModule = await import(pathToFileURL(join(adapter, 'effect-ledger.js')).href)
const statusModule = await import(pathToFileURL(join(adapter, 'status.js')).href)
const pink = await import(pathToFileURL(join(pluginRoot, 'lib', 'types', 'index.js')).href)

const app = new Context()
await app.plugin(ledgerModule.default)
await app.plugin(pink)
await app.plugin(extensions.default ?? extensions)
await new Promise(resolve => setTimeout(resolve, 300))

const ledger = join(dataDir, 'effect-ledger.jsonl')
const pinkBinds = existsSync(ledger)
  ? readFileSync(ledger, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(entry => entry.resource?.id === 'dsh-tui-theme')
  : []
const runtime = app.get('tuiStatus')
const snapshot = statusModule.getHostStatusStore(runtime)?.getSnapshot()

assert.ok(pinkBinds.length > 0, 'plugin must bind through the late status service')
assert.ok(
  snapshot?.some?.(entry => entry.key === 'dsh-tui-theme'),
  'status store must contain the plugin contribution',
)
console.log(`✓ headless order: ${pinkBinds.length} ledger bind(s), visible status contribution`)
