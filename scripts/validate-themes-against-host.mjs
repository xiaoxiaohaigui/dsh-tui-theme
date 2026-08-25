/**
 * Validate bundled themes against the real dsh-TUI source implementation.
 * DSH_TUI_SOURCE_ROOT must point at a dsh-TUI source checkout.
 *
 * Run with: npx -y tsx scripts/validate-themes-against-host.mjs
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = process.env.DSH_TUI_SOURCE_ROOT
if (sourceRoot === undefined || sourceRoot === '') {
  throw new Error('DSH_TUI_SOURCE_ROOT must point at a dsh-TUI source checkout for this host theme validation.')
}
const hostRoot = resolve(sourceRoot)
const customThemePath = join(hostRoot, 'src', 'customTheme.ts')
const themePath = join(hostRoot, 'src', 'theme.ts')

if (!existsSync(customThemePath) || !existsSync(themePath)) {
  throw new Error(`dsh-TUI sources not found at ${hostRoot}`)
}

const hostPackagePath = join(hostRoot, 'package.json')
if (!existsSync(hostPackagePath)) {
  throw new Error(`dsh-TUI package metadata not found at ${hostPackagePath}`)
}
const hostPackage = JSON.parse(readFileSync(hostPackagePath, 'utf8'))
assert.equal(hostPackage.version, '0.9.2', `expected dsh-TUI source 0.9.2, received ${hostPackage.version}`)

const sandboxHome = mkdtempSync(join(tmpdir(), 'pink-theme-host-validate-'))
process.env.USERPROFILE = sandboxHome
process.env.HOME = sandboxHome

const themesDir = join(pluginRoot, 'themes')
const { parseCustomTheme, buildTheme } = await import(pathToFileURL(customThemePath).href)
const { getTheme, isLightThemeActive, registerCustomThemeResolver } = await import(
  pathToFileURL(themePath).href
)

const allKeys = Object.keys(getTheme('dark'))
assert.ok(allKeys.length >= 90, 'host Theme key count drifted; re-check coverage')

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

  const theme = buildTheme(spec)
  built[spec.name] = theme
  assert.equal(isLightThemeActive(spec.name), expectedLight[spec.name], `${spec.name} identity`)
}

for (const [name, light] of Object.entries(expectedLight)) {
  assert.equal(isLightThemeActive(name), light, `${name} identity via resolver`)
}

const cases = [
  ['pink-night', 'text', '#1E1E1E', 4.5],
  ['pink-night', 'claude', '#1E1E1E', 3.0],
  ['pink-night', 'inactive', '#1E1E1E', 2.5],
  ['pink-day', 'text', '#F6F3ED', 4.5],
  ['pink-day', 'claude', '#F6F3ED', 3.0],
  ['pink-day', 'inactive', '#F6F3ED', 2.5],
]
for (const [theme, key, background, minimum] of cases) {
  const foregroundRgb = parseColor(built[theme][key])
  const backgroundRgb = parseColor(background)
  assert.notEqual(foregroundRgb, undefined, `${theme}.${key} must be parseable`)
  const ratio = contrast(foregroundRgb, backgroundRgb)
  assert.ok(ratio >= minimum, `${theme}.${key} contrast ${ratio.toFixed(2)} >= ${minimum}`)
}

console.log(`✓ host theme validation: ${Object.keys(built).length} themes, ${allKeys.length - 1} keys each`)
