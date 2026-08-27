/**
 * Release artifact contract: inspect npm's dry-run manifest without creating
 * a tarball, then ensure consumers receive every advertised runtime asset.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
const packCommand = process.platform === 'win32'
  ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'npm pack --dry-run --json --ignore-scripts'] }
  : { file: 'npm', args: ['pack', '--dry-run', '--json', '--ignore-scripts'] }
const manifest = JSON.parse(execFileSync(packCommand.file, packCommand.args, {
  cwd: pluginRoot,
  encoding: 'utf8',
}))
const packed = manifest[0]
assert.ok(packed, 'npm pack must report one package')
assert.equal(packed.name, 'dsh-tui-theme')
assert.equal(packed.version, packageJson.version)

const files = new Set(packed.files.map(entry => entry.path))
for (const required of [
  'package.json',
  'README.md',
  'LICENSE',
  'cordis.patch.yml',
  'lib/types/index.js',
  'lib/types/index.d.ts',
  'lib/types/autoTheme.js',
  'lib/types/autoTheme.d.ts',
  'lib/types/pluginId.js',
  'lib/types/pluginId.d.ts',
  'lib/types/settingsSection.js',
  'lib/types/settingsSection.d.ts',
  'lib/types/statusLine.js',
  'lib/types/statusLine.d.ts',
  'lib/types/themeAssets.js',
  'lib/types/themeAssets.d.ts',
  'themes/pink-night.json',
  'themes/pink-day.json',
  'themes/pink-ansi.json',
  'docs/screenshots/pink-day.png',
  'docs/screenshots/pink-night.png',
  'docs/screenshots/settings.png',
  'scripts/verify.mjs',
  'scripts/verify-package.mjs',
  'scripts/headless-order-test.mjs',
  'scripts/validate-themes-against-host.mjs',
  'scripts/expected-settings-contract.mjs',
]) {
  assert.ok(files.has(required), `published package must include ${required}`)
}

const exportedPaths = [packageJson.main, packageJson.types, packageJson.dsh.bundle.patch]
for (const entry of Object.values(packageJson.exports)) {
  if (typeof entry === 'string') exportedPaths.push(entry)
  else if (entry !== null && typeof entry === 'object') exportedPaths.push(...Object.values(entry))
}
for (const entry of exportedPaths) {
  assert.equal(typeof entry, 'string')
  assert.ok(files.has(entry.replace(/^\.\//, '')), `published package must include declared entry ${entry}`)
}

for (const name of Object.keys(packageJson.peerDependencies)) {
  if (!name.startsWith('@deepseek-ai/')) continue
  assert.equal(packageJson.dependencies?.[name], undefined, `${name} must not be a runtime dependency`)
  assert.equal(packageJson.devDependencies?.[name], packageJson.peerDependencies[name], `${name} peer and dev ranges must match`)
}
assert.equal(packageJson.dependencies?.['@deepseek-ai/schemastery'], undefined)
const rootLock = lockfile.packages?.['']
assert.ok(rootLock, 'lockfile must have root metadata')
assert.equal(lockfile.version, packageJson.version)
assert.deepEqual(rootLock.devDependencies, packageJson.devDependencies)
assert.deepEqual(rootLock.peerDependencies, packageJson.peerDependencies)
assert.equal(rootLock.dependencies, undefined)
assert.equal(existsSync(new URL('../lib/types/index.js', import.meta.url)), true)

console.log(`✓ package manifest: ${packed.name}@${packed.version}, ${files.size} files`)
