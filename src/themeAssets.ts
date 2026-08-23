/**
 * Bundled-theme installation (seam four: static theme assets).
 *
 * Copies the package's themes/*.json into ~/.dsh-tui/themes/ on boot. Only
 * files that do not exist yet are written — a user's edited or same-named
 * theme file is never overwritten. Every failure is contained per file: a
 * theme garnish must never break the TUI's boot.
 * @module dsh-tui-pink-theme/themeAssets
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ThemeInstallResult {
  /** Files newly written into the target directory. */
  readonly installed: readonly string[]
  /** Files already present in the target directory (left untouched). */
  readonly skipped: readonly string[]
  /** Files that could not be installed (per-file failures). */
  readonly failed: readonly string[]
}

// Same resolution order as the host's utils/paths.ts homeDir(): os.homedir()
// first, USERPROFILE/HOME spellings as stripped-down fallbacks.
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
  const failed: string[] = []
  let files: string[]
  try {
    files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'))
  } catch {
    return { installed, skipped, failed: [sourceDir] }
  }
  for (const file of files) {
    try {
      const target = join(targetDir, file)
      if (existsSync(target)) {
        skipped.push(file)
        continue
      }
      const text = readFileSync(join(sourceDir, file), 'utf8')
      JSON.parse(text) // our own asset, but never write a corrupt file out
      mkdirSync(targetDir, { recursive: true })
      writeFileSync(target, text)
      installed.push(file)
    } catch {
      failed.push(file)
    }
  }
  return { installed, skipped, failed }
}
