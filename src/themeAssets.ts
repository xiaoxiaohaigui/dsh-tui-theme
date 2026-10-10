/**
 * Bundled-theme installation (seam four: static theme assets).
 *
 * Copies the package's themes/*.json into ~/.dsh-tui/themes/ on boot. Only
 * files that do not exist yet are written — a user's edited or same-named
 * theme file is never overwritten. What gets written is the host-appropriate
 * form of the asset (see bundledThemeForms): a host that predates the chrome
 * keys receives the v0.7.3 byte layout instead of per-key warnings. The one
 * exception to the never-overwrite rule is a target that no longer parses as
 * JSON (a torn write from an interrupted installation):
 * that file is backed up under a .corrupt-<timestamp> name and replaced, so
 * a crash can never shadow a bundled theme forever. Every failure is
 * contained per file: a theme garnish must never break the TUI's boot.
 * @module dsh-tui-theme/themeAssets
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHROME_THEME_KEYS, hostSupportsChromeKeys, withoutChromeKeys } from './hostContract.js'

export interface ThemeInstallResult {
  /** Files newly written into the target directory. */
  readonly installed: readonly string[]
  /** Files already present in the target directory (left untouched). */
  readonly skipped: readonly string[]
  /** Corrupt targets backed up and reinstalled (self-heal). */
  readonly repaired: readonly string[]
  /** Files that could not be installed (per-file failures). */
  readonly failed: readonly string[]
  /** Set only when the bundled directory itself was unreadable, so nothing
   *  was attempted and no per-file entry exists. Carries the directory and
   *  the underlying error for the caller's log. */
  readonly sourceError?: string
}

export interface BundledTheme {
  readonly file: string
  readonly name: string
  readonly displayName?: string
  readonly base: 'light' | 'dark' | 'dark-ansi'
  readonly colors: Record<string, string>
}

// Same resolution order as the host's utils/paths.ts homeDir(): os.homedir()
// first, USERPROFILE/HOME spellings as stripped-down fallbacks. When all three
// come up empty the returned '' makes every derived path resolve against the
// process cwd — the host's own semantics, kept deliberately identical rather
// than second-guessed here.
export function homeDir(): string {
  return homedir() || process.env.USERPROFILE || process.env.HOME || ''
}

/** The package's bundled themes/ directory (sibling of the built lib/). */
export function bundledThemesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'themes')
}

/** The host's user-theme directory (~/.dsh-tui/themes). */
export function themesTargetDir(): string {
  return join(homeDir(), '.dsh-tui', 'themes')
}

/** Read bundled descriptors for hosts that support runtime theme registration. */
export function readBundledThemes(sourceDir: string = bundledThemesDir()): BundledTheme[] {
  let files: string[]
  try {
    files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'))
  } catch (error) {
    console.warn(`dsh-tui-theme: could not read bundled themes from ${sourceDir}: ${String(error)}`)
    return []
  }
  const themes: BundledTheme[] = []
  for (const file of files) {
    try {
      const value = JSON.parse(readFileSync(join(sourceDir, file), 'utf8')) as Record<string, unknown>
      const name = value.name
      const base = value.base
      const colors = value.colors
      if (
        typeof name !== 'string' ||
        !/^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)?$/u.test(name) ||
        (base !== 'light' && base !== 'dark' && base !== 'dark-ansi') ||
        colors === null ||
        typeof colors !== 'object' ||
        Array.isArray(colors)
      ) {
        throw new Error('invalid theme descriptor')
      }
      const normalizedColors: Record<string, string> = {}
      for (const [key, color] of Object.entries(colors as Record<string, unknown>)) {
        if (typeof color !== 'string') throw new Error(`invalid color for ${key}`)
        normalizedColors[key] = color
      }
      themes.push({
        file,
        name,
        ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
        base,
        colors: normalizedColors,
      })
    } catch (error) {
      console.warn(`dsh-tui-theme: skipping bundled theme ${file}: ${String(error)}`)
    }
  }
  return themes
}

/**
 * How one bundled theme file presents itself to the host in use.
 *
 * `write` is the text this plugin installs: the bundled file as-is, except on
 * a host that predates the chrome keys (hostContract.ts), where those eight
 * keys are withheld — the static parser would otherwise warn per key on every
 * boot, and a runtime-registered descriptor carrying them is rejected whole.
 * The withheld text is the exact byte layout the plugin published as v0.7.3.
 *
 * `copies` lists every text form that still counts as this plugin's own copy
 * for the byte-identical checks (removal after runtime confirmation, shadow
 * detection). It holds both forms so a file left by an older plugin release
 * stays recognisable after a host upgrade — losing that would silently let a
 * stale 73-key file shadow the registry forever.
 */
function bundledThemeForms(file: string, sourceDir: string): { write: string; copies: string[] } {
  const text = readFileSync(join(sourceDir, file), 'utf8')
  const withheld = stripChromeKeys(text)
  if (hostSupportsChromeKeys() || withheld === undefined) return { write: text, copies: [text] }
  return { write: withheld, copies: [withheld, text] }
}

/**
 * Re-serialize a theme file without the chrome keys, preserving the bundled
 * formatting (`JSON.stringify(parsed, null, 2)` plus a trailing newline), so
 * the withheld text is byte-identical to the 0.7.3 assets. Returns undefined
 * for text that cannot be parsed or carries none of the keys.
 */
function stripChromeKeys(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as { colors?: Record<string, unknown> }
    if (parsed === null || typeof parsed !== 'object') return undefined
    const colors = parsed.colors
    if (colors === null || typeof colors !== 'object' || Array.isArray(colors)) return undefined
    if (!CHROME_THEME_KEYS.some(key => Object.prototype.hasOwnProperty.call(colors, key))) return undefined
    parsed.colors = withoutChromeKeys(colors as Record<string, string>)
    return `${JSON.stringify(parsed, null, 2)}\n`
  } catch {
    return undefined
  }
}

/**
 * Install every bundled theme JSON that the target directory is missing.
 * @param targetDir - Destination directory (defaults to ~/.dsh-tui/themes).
 * @param sourceDir - Bundled assets (defaults to this package's themes/).
 * @returns Per-file outcome. Never throws.
 */
export function installBundledThemes(
  targetDir: string = themesTargetDir(),
  sourceDir: string = bundledThemesDir(),
): ThemeInstallResult {
  const installed: string[] = []
  const skipped: string[] = []
  const repaired: string[] = []
  const failed: string[] = []
  let files: string[]
  try {
    files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'))
  } catch (error) {
    // No file was attempted, so `failed` stays empty; the directory-level
    // reason travels separately so the caller can log a precise line.
    return { installed, skipped, repaired, failed, sourceError: `could not read bundled themes from ${sourceDir}: ${String(error)}` }
  }
  for (const file of files) {
    const target = join(targetDir, file)
    try {
      const text = bundledThemeForms(file, sourceDir).write
      JSON.parse(text) // our own asset, but never write a corrupt file out
      mkdirSync(targetDir, { recursive: true })
      try {
        writeFileSync(target, text, { flag: 'wx' })
        installed.push(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const healed = healCorruptTarget(target, text)
          if (healed === 'repaired') repaired.push(file)
          else if (healed === 'failed') failed.push(file)
          else skipped.push(file)
        } else {
          failed.push(file)
        }
      }
    } catch {
      failed.push(file)
    }
  }
  return { installed, skipped, repaired, failed }
}

/**
 * Remove files that this activation installed when a runtime theme service
 * becomes available. A byte-for-byte check preserves edits made in the small
 * window between installation and runtime confirmation.
 */
export function removeBundledThemes(
  files: readonly string[],
  targetDir: string = themesTargetDir(),
  sourceDir: string = bundledThemesDir(),
): string[] {
  const removed: string[] = []
  for (const file of files) {
    try {
      const bundled = bundledThemeForms(file, sourceDir).copies
      const target = join(targetDir, file)
      if (!bundled.includes(readFileSync(target, 'utf8'))) continue
      unlinkSync(target)
      removed.push(file)
    } catch {
      // Runtime registration must remain best-effort if a file disappears or
      // the target directory becomes unavailable during teardown.
    }
  }
  if (removed.length > 0) {
    try {
      if (readdirSync(targetDir).length === 0) rmdirSync(targetDir)
    } catch {
      // An empty directory is only a cosmetic artifact; leave it in place if
      // it was removed concurrently or is no longer empty.
    }
  }
  return removed
}

/**
 * Bundled theme files present in the target directory byte-for-byte
 * identical to the bundled copy. On runtime-theme hosts such files shadow
 * the registry while adding nothing, so the entry point can point them out
 * once. User-edited or foreign same-named files are never reported — the
 * never-overwrite rule keeps them, and no toast may nag about them.
 */
export function findShadowedBundledThemes(
  targetDir: string = themesTargetDir(),
  sourceDir: string = bundledThemesDir(),
): string[] {
  const shadowed: string[] = []
  let files: string[]
  try {
    files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'))
  } catch {
    return shadowed
  }
  for (const file of files) {
    try {
      const copies = bundledThemeForms(file, sourceDir).copies
      if (copies.includes(readFileSync(join(targetDir, file), 'utf8'))) {
        shadowed.push(file)
      }
    } catch {
      // Missing or unreadable target: not a shadow.
    }
  }
  return shadowed
}

/**
 * Self-heal an existing target that fails to parse as JSON — the leftover of
 * a torn write from an interrupted installation. The damaged file is kept as
 * <target>.corrupt-<timestamp>-<pid>-<random> and the bundled copy installed
 * fresh. Returns `skipped` when the target is valid JSON or unreadable, and
 * `failed` when the corrupt target was moved but replacement could not finish.
 */
function healCorruptTarget(target: string, text: string): 'repaired' | 'skipped' | 'failed' {
  let existing: string
  try {
    existing = readFileSync(target, 'utf8')
  } catch {
    return 'skipped'
  }
  try {
    JSON.parse(existing)
    return 'skipped'
  } catch {
    // Proven corrupt: fall through to backup and reinstall.
  }
  let backup: string
  try {
    backup = `${target}.corrupt-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`
    renameSync(target, backup)
  } catch {
    return 'skipped'
  }
  try {
    writeFileSync(target, text, { flag: 'wx' })
    return 'repaired'
  } catch {
    return 'failed'
  }
}
