/**
 * Terminal-background follow: the pink pair's `auto`.
 *
 * The host's `auto` pseudo-theme resolves builtin light/dark via an OSC 11
 * query at mount and keeps the result in memory only — user themes cannot
 * ride it. This module gives pink-day/pink-night the same behavior from the
 * plugin side:
 *
 * - the caller wires this from the settings inject callback (see index.ts):
 *   that fires before the React tree mounts and reads ~/.dsh-tui/theme.json,
 *   so the cached detection still decides this boot;
 * - a fresh OSC 11 query then refreshes the cache for the next boot. The
 *   very first enabling (or a system flip between boots) lands one boot
 *   late — the same cadence as the host's own "re-select auto or restart".
 *
 * The pref write mirrors the host's writeThemePref byte-for-byte
 * ({"theme": name}, 2-space indent) and the light test mirrors the host's
 * luminance threshold so both sides always agree on light/dark.
 * @module dsh-tui-theme/autoTheme
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The pair this feature switches between (light terminal → day). */
const LIGHT_THEME = 'pink-day'
const DARK_THEME = 'pink-night'

const QUERY = '\x1b]11;?\x07'
// OSC 11 reply: rgb:RRRR/GGGG/BBBB with 1-4 hex digits per channel, BEL or
// ST terminated.
const REPLY = /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(?:\x07|\x1b\\)/
const DETECT_TIMEOUT_MS = 400

interface FollowCache {
  light: boolean
  at: number
}

function prefPath(dir: string): string {
  return join(dir, 'theme.json')
}

function cachePath(dir: string): string {
  return join(dir, 'theme-follow.json')
}

function readJsonSync<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

function writeJsonSync(path: string, value: unknown): boolean {
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify(value, null, 2))
    return true
  } catch {
    return false
  }
}

/** The persisted theme pref ({ theme: name }), host format. */
export function readThemePref(dataDir: string): string | undefined {
  const parsed = readJsonSync<{ theme?: unknown }>(prefPath(dataDir))
  return typeof parsed?.theme === 'string' ? parsed.theme : undefined
}

/** Persist the theme pref in the host's exact format. */
export function writeThemePref(name: string, dataDir: string): boolean {
  return writeJsonSync(prefPath(dataDir), { theme: name })
}

/** The cached detection, if one exists. */
export function readFollowCache(dataDir: string): FollowCache | undefined {
  const cached = readJsonSync<FollowCache>(cachePath(dataDir))
  return typeof cached?.light === 'boolean' ? cached : undefined
}

function writeFollowCache(light: boolean, dataDir: string): void {
  writeJsonSync(cachePath(dataDir), { light, at: Date.now() })
}

/**
 * Map a detected background to this pair's theme name.
 * @param light - True for a light terminal background.
 */
export function themeForBackground(light: boolean): string {
  return light ? LIGHT_THEME : DARK_THEME
}

/**
 * Apply the follow behavior synchronously from cache: writes the resolved
 * theme name into the pref when it differs. Safe before mount — pure fs.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @returns The applied theme name, or undefined when no cache exists yet.
 */
export function applyCachedFollow(dataDir: string): string | undefined {
  const cached = readFollowCache(dataDir)
  if (cached === undefined) return undefined
  const target = themeForBackground(cached.light)
  if (readThemePref(dataDir) !== target) {
    writeThemePref(target, dataDir)
  }
  return target
}

/** Scale a 1-4 digit hex OSC channel to 8-bit. */
function channel8(hex: string): number {
  const value = parseInt(hex, 16)
  if (hex.length >= 3) return Math.round(value / (16 ** hex.length - 1) * 255)
  return value * (hex.length === 2 ? 1 : 17)
}

/** The host's luminance test (ThemeProvider.isLightBackground). */
function isLightBackground(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b > 140
}

/**
 * Query the terminal background (OSC 11) and refresh the cache + pref.
 * Best effort: no TTY, an unresponsive terminal, or a parse failure just
 * leaves the previous state intact. Runs before the host's own stdin
 * parsing is mounted; raw mode is restored to whatever it was.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @param stdout - Injectable for tests.
 * @param stdin - Injectable for tests.
 * @param setTimeoutFn - Injectable for tests.
 * @returns The detected light-ness, or undefined when unavailable.
 */
export function refreshDetectedBackground(
  dataDir: string,
  stdout: NodeJS.WriteStream = process.stdout,
  stdin: NodeJS.ReadStream = process.stdin,
  setTimeoutFn: typeof setTimeout = setTimeout,
): Promise<boolean | undefined> {
  return new Promise(resolve => {
    if (stdout.isTTY !== true || stdin.isTTY !== true) {
      resolve(undefined)
      return
    }
    const wasRaw = stdin.isRaw === true
    try {
      stdin.setRawMode?.(true)
    } catch {
      resolve(undefined)
      return
    }
    let buffer = ''
    let settled = false
    const finish = (light: boolean | undefined): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdin.removeListener('data', onData)
      try {
        stdin.setRawMode?.(wasRaw)
      } catch {
        // Stream already torn down — nothing to restore.
      }
      if (light !== undefined) {
        writeFollowCache(light, dataDir)
        const target = themeForBackground(light)
        if (readThemePref(dataDir) !== target) {
          writeThemePref(target, dataDir)
        }
      }
      resolve(light)
    }
    const onData = (chunk: Buffer | string): void => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1')
      const match = REPLY.exec(buffer)
      if (match === null) return
      finish(
        isLightBackground(
          channel8(match[1] ?? ''),
          channel8(match[2] ?? ''),
          channel8(match[3] ?? ''),
        ),
      )
    }
    const timer = setTimeoutFn(() => finish(undefined), DETECT_TIMEOUT_MS)
    if (stdin.isPaused()) stdin.resume()
    stdin.on('data', onData)
    stdout.write(QUERY)
  })
}

/**
 * The whole follow sequence for apply(): cached value now (pre-mount),
 * fresh detection for the next boot.
 * @param dataDir - The host data directory (~/.dsh-tui).
 * @param log - Info sink for the applied/refreshed outcomes.
 */
export function runFollowSystem(
  dataDir: string,
  log: (message: string) => void,
): void {
  const applied = applyCachedFollow(dataDir)
  if (applied !== undefined && existsSync(prefPath(dataDir))) {
    log(`follow: applied cached background (${applied})`)
  }
  void refreshDetectedBackground(dataDir).then(light => {
    if (light === undefined) {
      log('follow: terminal background unavailable, keeping current choice')
    } else {
      log(`follow: detected ${light ? 'light' : 'dark'} terminal → ${themeForBackground(light)}`)
    }
  })
}
