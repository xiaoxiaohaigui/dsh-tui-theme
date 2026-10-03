/**
 * One-shot migration notice for the theme files pre-0.8 releases installed.
 *
 * 0.8 handed the pink family to dsh-TUI: `pink-night` / `pink-day` /
 * `pink-ansi` are built-ins now, the plugin registers nothing, and it never
 * writes into `~/.dsh-tui` again. Files a ≤0.7.x install left in
 * `~/.dsh-tui/themes/` are dead weight from then on — on a host that knows the
 * built-in names the catalog resolves built-ins *before* static files, so a
 * hand-tuned palette in one of those files silently stops applying.
 *
 * The plugin cannot tell which host generation it runs on (the runtime theme
 * service exposes no lookup and does not report refusals), so the notice stays
 * factual about both: it names the files, says the host now owns those names,
 * and tells a user who customized one how to keep it.
 *
 * Delivery is best-effort through the toast relay (which retries a send that
 * raced the seam's arrival); the marker records the *attempt*, not a
 * confirmed render. A host whose toast seam never arrives is a host without
 * the built-in pink family either — `tuiToast` and the pink palettes landed in
 * the same 0.10 line — so a lost notice there costs nothing, while a repeated
 * one would nag. No legacy files means no toast and no marker: an uninstall
 * stays traceless.
 * @module dsh-tui-theme/legacyNotice
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ToastSend } from './toast.js'
import { PINK_THEMES, dataDir } from './themePref.js'

/** What one boot found, and whether the notice reached the user. */
export interface LegacyNoticeOutcome {
  /** Legacy pink-* theme files still present (sorted `*.json` names). */
  readonly files: readonly string[]
  /** Whether this boot issued the notice (and recorded the marker). */
  readonly notified: boolean
}

/** Marker recording that the notice has been shown, inside ~/.dsh-tui. */
const NOTICE_FILE = 'theme-plugin-notice.json'

/**
 * Legacy `pink-*.json` files in the host's user theme directory. Foreign names
 * are never reported: the plugin only ever installed the three pink files, and
 * a hand-made theme is the user's business, not a migration artifact.
 */
export function findLegacyThemeFiles(dir: string = dataDir()): string[] {
  try {
    return readdirSync(join(dir, 'themes'))
      .filter(entry => {
        const lower = entry.toLowerCase()
        return lower.endsWith('.json') && PINK_THEMES.has(lower.slice(0, -'.json'.length))
      })
      .sort()
  } catch {
    return []
  }
}

/** Whether a previous boot recorded the notice (unreadable = not recorded). */
function alreadyNotified(dir: string): boolean {
  try {
    return readFileSync(join(dir, NOTICE_FILE), 'utf8').trim() !== ''
  } catch {
    return false
  }
}

/** Atomic marker write in the same shape the host's own preference writers use. */
function writeMarker(dir: string): void {
  const path = join(dir, NOTICE_FILE)
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temporary, JSON.stringify({ themeRemovalNotifiedAt: Date.now() }, null, 2), {
      flag: 'wx',
    })
    renameSync(temporary, path)
  } catch {
    try {
      rmSync(temporary, { force: true })
    } catch {
      // A stale temp file is harmless; the next boot repeats the notice.
    }
  }
}

/**
 * Point out leftover plugin-installed theme files exactly once.
 *
 * @param send - The toast sender (see toast.ts); its answer is advisory — the
 *   relay's own retry chain covers a seam that has not arrived yet.
 * @param dir - The host data directory (~/.dsh-tui); overridable for tests.
 */
export function notifyLegacyThemeFiles(send: ToastSend, dir: string = dataDir()): LegacyNoticeOutcome {
  const files = findLegacyThemeFiles(dir)
  if (files.length === 0) return { files, notified: false }
  if (alreadyNotified(dir)) return { files, notified: false }
  const text =
    `✿ 发现旧主题文件 ${files.join('、')}：pink-* 现由 dsh-TUI 内置并优先于同名文件，` +
    '本插件不再安装主题；自定义过配色的文件请改名以继续生效'
  send(text)
  writeMarker(dir)
  return { files, notified: true }
}
