/**
 * Validate bundled themes against matching dsh-TUI source and runtime modules.
 * DSH_TUI_SOURCE_ROOT and DSH_TUI_ADAPTER_DIR may point at a matching source
 * checkout and adapter directory. When omitted, the installed dsh-TUI
 * devDependency is used as a zero-configuration baseline.
 * Set DSH_TUI_EXPECTED_VERSION only when an explicit release baseline needs
 * to be pinned; ordinary development verifies the supplied host as-is.
 *
 * Run with: node --import tsx/esm scripts/validate-themes-against-host.mjs
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { createRequire } from 'node:module'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = process.env.DSH_TUI_SOURCE_ROOT
const hostRequire = createRequire(import.meta.url)
const devPackageJson = hostRequire.resolve('@deepseek-harness-tui/dsh-tui/package.json')
const hostRoot = sourceRoot === undefined || sourceRoot === ''
  ? dirname(devPackageJson)
  : resolve(sourceRoot)
const sourceMode = sourceRoot !== undefined && sourceRoot !== ''
const customThemePath = sourceMode
  ? join(hostRoot, 'src', 'customTheme.ts')
  : join(hostRoot, 'lib', 'types', 'customTheme.js')
const themePath = sourceMode
  ? join(hostRoot, 'src', 'theme.ts')
  : join(hostRoot, 'lib', 'types', 'theme.d.ts')

if (!existsSync(customThemePath) || !existsSync(themePath)) {
  throw new Error(`dsh-TUI ${sourceMode ? 'sources' : 'devDependency build'} not found at ${hostRoot}`)
}

const hostPackagePath = sourceMode ? join(hostRoot, 'package.json') : devPackageJson
if (!existsSync(hostPackagePath)) {
  throw new Error(`dsh-TUI package metadata not found at ${hostPackagePath}`)
}
const hostPackage = JSON.parse(readFileSync(hostPackagePath, 'utf8'))
assert.match(hostPackage.version, /^\d+\.\d+\.\d+(?:[-+].+)?$/u, 'host source must declare a version')

const adapter = process.env.DSH_TUI_ADAPTER_DIR
if (sourceMode && (adapter === undefined || adapter === '')) {
  throw new Error('DSH_TUI_ADAPTER_DIR must point at dsh-TUI lib/types/dsh-adapter for this host theme validation.')
}
const adapterRoot = resolve(adapter || join(hostRoot, 'lib', 'types', 'dsh-adapter'))
const runtimeThemePath = join(adapterRoot, '..', 'theme.js')
const runtimeCustomThemePath = join(adapterRoot, '..', 'customTheme.js')
if (!existsSync(runtimeThemePath) || !existsSync(runtimeCustomThemePath)) {
  throw new Error(`dsh-TUI compiled theme modules not found above adapter at ${adapterRoot}`)
}
const adapterPackagePath = join(adapterRoot, '..', '..', '..', 'package.json')
if (!existsSync(adapterPackagePath)) {
  throw new Error(`dsh-TUI package metadata not found above adapter at ${adapterRoot}`)
}
const adapterPackage = JSON.parse(readFileSync(adapterPackagePath, 'utf8'))
assert.equal(
  adapterPackage.version,
  hostPackage.version,
  `source ${hostPackage.version} and adapter ${adapterPackage.version} must be the same dsh-TUI version`,
)
const expectedVersion = process.env.DSH_TUI_EXPECTED_VERSION
if (expectedVersion !== undefined && expectedVersion !== '') {
  assert.equal(hostPackage.version, expectedVersion, `expected dsh-TUI ${expectedVersion}, received ${hostPackage.version}`)
} else {
  console.log(`* host source and adapter ${hostPackage.version} (no explicit version pin)`)
}

const sandboxHome = mkdtempSync(join(tmpdir(), 'pink-theme-host-validate-'))
process.env.USERPROFILE = sandboxHome
process.env.HOME = sandboxHome

const themesDir = join(pluginRoot, 'themes')
const { parseCustomTheme, buildTheme } = await import(pathToFileURL(runtimeCustomThemePath).href)
const { getTheme, isLightThemeActive, registerCustomThemeResolver } = await import(
  pathToFileURL(runtimeThemePath).href,
)

function readThemeKeysFromSource(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(
    statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'Theme',
  )
  assert.ok(declaration && ts.isTypeLiteralNode(declaration.type), 'host Theme must remain a type literal')
  const keys = declaration.type.members.flatMap(member => {
    if (!ts.isPropertySignature(member) || member.name === undefined) return []
    if (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) return [member.name.text]
    return []
  })
  assert.ok(keys.length > 0, 'host Theme must declare at least one color key')
  return keys
}

const allKeys = sourceMode ? readThemeKeysFromSource(themePath) : Object.keys(getTheme('dark'))
assert.deepEqual(
  [...Object.keys(getTheme('dark'))].sort(),
  [...allKeys].sort(),
  'compiled theme keys must match the checked-out host source',
)
assert.ok(allKeys.length >= 90, 'host Theme key count drifted; re-check coverage')

const settingsKeys = [
  'promptBorder',
  'selectionBg',
  'permission',
  'suggestion',
  'success',
  'inactive',
  'subtle',
  'warning',
  'error',
]

function parseColor(value) {
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    const n = Number.parseInt(value.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(value)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function luminance(color) {
  const channel = value => {
    const normalized = value / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

function contrast(foreground, background) {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (high + 0.05) / (low + 0.05)
}

const expectedLight = { 'pink-night': false, 'pink-day': true, 'pink-ansi': false }
const built = {}
registerCustomThemeResolver(name => built[name])

for (const file of readdirSync(themesDir).filter(name => name.endsWith('.json'))) {
  const warnings = []
  const originalWarn = console.warn
  console.warn = message => warnings.push(String(message))
  let spec
  try {
    spec = parseCustomTheme(readFileSync(join(themesDir, file), 'utf8'), file)
  } finally {
    console.warn = originalWarn
  }

  assert.notEqual(spec, undefined, `${file} must parse`)
  assert.deepEqual(warnings, [], `${file} must produce zero host warnings`)
  const missing = allKeys.filter(key => key !== 'userMessageBackground' && !(key in spec.colors))
  assert.deepEqual(missing, [], `${file} must cover every Theme key`)
  const missingSettingsKeys = settingsKeys.filter(key => !(key in spec.colors))
  assert.deepEqual(
    missingSettingsKeys,
    [],
    `${file} must cover every color used by the dsh-TUI settings cards and checkbox chips`,
  )

  const theme = buildTheme(spec)
  built[spec.name] = theme
  assert.equal(isLightThemeActive(spec.name), expectedLight[spec.name], `${spec.name} identity`)
}

for (const [name, light] of Object.entries(expectedLight)) {
  assert.equal(isLightThemeActive(name), light, `${name} identity via resolver`)
}

// Backgrounds: the /settings section renders inside the session screen, so
// unfocused rows sit on the theme's terminal background while a focused row
// gets selectionBg (screens/Settings.tsx CardRow). success/inactive are the
// checkbox chip colors there ([✓] vs [  ]).
const cases = [
  ['pink-night', 'text', '#1E1E1E', 4.5],
  ['pink-night', 'claude', '#1E1E1E', 3.0],
  ['pink-night', 'inactive', '#1E1E1E', 2.5],
  ['pink-night', 'success', '#1E1E1E', 4.5],
  ['pink-night', 'success', '#55303E', 3.0],
  ['pink-night', 'inactive', '#55303E', 3.0],
  ['pink-day', 'text', '#F6F3ED', 4.5],
  ['pink-day', 'claude', '#F6F3ED', 3.0],
  ['pink-day', 'inactive', '#F6F3ED', 2.5],
  ['pink-day', 'success', '#F6F3ED', 3.0],
  ['pink-day', 'success', '#F3D7E0', 2.5],
  ['pink-day', 'inactive', '#F3D7E0', 2.5],
]
// pink-ansi is intentionally absent from the contrast cases: every one of its
// colors is an `ansi:` palette token with no pinned RGB value, so no numeric
// ratio is assertable here — the host renders whatever the user's terminal
// palette defines. Its settings keys are still covered by the per-theme
// key-coverage assertions above.
for (const [theme, key, background, minimum] of cases) {
  const foregroundRgb = parseColor(built[theme][key])
  const backgroundRgb = parseColor(background)
  assert.notEqual(foregroundRgb, undefined, `${theme}.${key} must be parseable`)
  const ratio = contrast(foregroundRgb, backgroundRgb)
  assert.ok(ratio >= minimum, `${theme}.${key} contrast ${ratio.toFixed(2)} >= ${minimum}`)
}

console.log(`OK host theme validation: ${Object.keys(built).length} themes, ${allKeys.length - 1} keys each, settings colors covered`)
