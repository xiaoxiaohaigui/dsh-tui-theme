/**
 * Host-contract gates: palette keys that only newer dsh-TUI releases accept.
 *
 * Why a gate instead of "just ship the keys": the runtime theme seam validates
 * a whole descriptor against the host's own Theme contract, and a single
 * unknown key rejects the descriptor outright (the host logs one warning and
 * returns its no-op disposer). A palette carrying a key the host never heard
 * of therefore does not degrade — all three sakura themes disappear at once,
 * with only a host-side log line to explain it. The static-asset path is
 * gentler (unknown keys are skipped one by one, each with a warning) but still
 * noisy on every boot.
 *
 * Upstream PR #1260 added the eight chrome keys below to the contract; the
 * first published release carrying them is dsh-TUI 0.14.0 (npm, 2026-10-07).
 * On anything older — including every static-asset host — this plugin withholds
 * them and ships the 73-semantic-key palettes it published as v0.7.3, so a
 * theme never vanishes over a cosmetic key.
 *
 * Detection reads the host package's own manifest
 * (`@deepseek-harness-tui/dsh-tui/package.json`, a published subpath). When it
 * cannot be resolved, or the version is a prerelease, the answer is "not
 * supported": the palettes still register, so the worst case is a missing tint
 * rather than three missing themes.
 * @module dsh-tui-theme/hostContract
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

/** The published host package whose Theme contract the palettes must satisfy. */
const HOST_PACKAGE = '@deepseek-harness-tui/dsh-tui'

/**
 * The chrome keys upstream PR #1260 added to the host Theme contract: the
 * context bar's five segment fills, the thinking-effort ignition pair (crest
 * colour and the band it fades into) and the prompt caret fill. They are the
 * only keys this plugin ships that a host release can predate.
 */
export const CHROME_THEME_KEYS = [
  'contextBarSystem',
  'contextBarPrompt',
  'contextBarAssistant',
  'contextBarThinking',
  'contextBarTools',
  'ignition',
  'ignitionDim',
  'cursor',
] as const

const chromeThemeKeys: ReadonlySet<string> = new Set(CHROME_THEME_KEYS)

/** The first published dsh-TUI release that carries CHROME_THEME_KEYS. */
const CHROME_KEYS_SINCE = [0, 14, 0] as const

type Release = readonly [number, number, number]

/**
 * Parse a published release version. Prereleases and build metadata answer
 * `undefined` on purpose: a prerelease of the boundary release may or may not
 * carry the keys, and withholding eight colours is the cheap side of that bet.
 */
function parseRelease(version: string | undefined): Release | undefined {
  if (typeof version !== 'string') return undefined
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function atLeast(release: Release | undefined, threshold: Release): boolean {
  if (release === undefined) return false
  for (let index = 0; index < threshold.length; index += 1) {
    const value = release[index] ?? 0
    const bound = threshold[index] ?? 0
    if (value !== bound) return value > bound
  }
  return true
}

let resolvedVersion: string | undefined
let versionResolved = false
let supportOverride: boolean | undefined

/**
 * The installed host release, or `undefined` when its manifest cannot be
 * resolved. Resolved once per process; the plugin never talks to the host
 * package at runtime otherwise.
 */
export function hostThemeVersion(): string | undefined {
  if (!versionResolved) {
    versionResolved = true
    try {
      const manifestPath = createRequire(import.meta.url).resolve(`${HOST_PACKAGE}/package.json`)
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown }
      resolvedVersion = typeof manifest.version === 'string' ? manifest.version : undefined
    } catch {
      resolvedVersion = undefined
    }
  }
  return resolvedVersion
}

/** Whether the installed host's Theme contract includes the chrome keys. */
export function hostSupportsChromeKeys(): boolean {
  if (supportOverride !== undefined) return supportOverride
  return atLeast(parseRelease(hostThemeVersion()), CHROME_KEYS_SINCE)
}

/** Pin the answer for hermetic tests; `undefined` restores detection. */
export function setChromeKeySupportForTests(value: boolean | undefined): void {
  supportOverride = value
}

/** Drop the chrome keys; the input object is never mutated. */
export function withoutChromeKeys(colors: Readonly<Record<string, string>>): Record<string, string> {
  const filtered: Record<string, string> = {}
  for (const [key, color] of Object.entries(colors)) {
    if (!chromeThemeKeys.has(key)) filtered[key] = color
  }
  return filtered
}
