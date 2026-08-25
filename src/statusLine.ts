/**
 * Blossom status line (seam eleven: tuiStatus).
 *
 * One keyed contribution above the prompt: a ✿ glyph, a wall clock, and the
 * live turn count of the current session (seam one, read-only — nothing is
 * ever appended to the session log). The host owns rendering and
 * sanitization; text is scalars only.
 *
 * The line belongs to the pink palettes: by default it only renders while a
 * pink theme is active (checked per render with the host's own theme
 * precedence, so a mid-session /theme switch takes effect on the next tick);
 * `statusScope: 'all-themes'` opts it into every other theme too.
 * @module dsh-tui-pink-theme/statusLine
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only import for the side effect: dsh-session's ambient declarations
// put the session/* events onto cordis's Events interface.
import type {} from '@deepseek-ai/dsh-session'
import { homeDir } from './themeAssets.js'
import { readThemePref } from './autoTheme.js'

/** Which themes the blossom line renders under. */
export type StatusScope = 'pink-only' | 'all-themes'

export interface StatusOptions {
  /** Master switch (cordis-config layer only; not surfaced in /settings). */
  statusEnabled?: boolean
  /** Lead the line with the ✿ glyph. */
  showGlyph?: boolean
  /** Include the HH:MM clock. */
  showClock?: boolean
  /** Include the live turn count of the current session. */
  showTurns?: boolean
  /** Theme scope of the line (default: the pink palettes only). */
  statusScope?: StatusScope
}

/** Fully-resolved status knobs. */
export type EffectiveStatus = Required<StatusOptions>

const GLYPH = '✿'
const STATUS_KEY = 'dsh-tui-theme'
const CLOCK_TICK_MS = 15_000

/** The bundled themes this garnish belongs to. */
const PINK_THEMES: ReadonlySet<string> = new Set(['pink-night', 'pink-day', 'pink-ansi'])

/**
 * The active theme name by the host's own precedence: DSH_TUI_THEME first,
 * then the persisted ~/.dsh-tui/theme.json pref. The unforced path (OSC 11
 * auto-detection) only ever resolves to a builtin palette, never a pink one,
 * so "no pref" means non-pink.
 */
function activeThemeName(dataDir: string): string | undefined {
  const env = process.env.DSH_TUI_THEME
  if (env !== undefined && env !== '') return env
  return readThemePref(dataDir)
}

function isPinkThemeActive(dataDir: string): boolean {
  const name = activeThemeName(dataDir)
  return name !== undefined && PINK_THEMES.has(name)
}

/** Structural view of the host service; the real type lives in the host. */
interface TuiStatusLike {
  set(
    key: string,
    text: string | number | boolean | undefined,
    identity?: unknown,
  ): () => void
}

function clockText(): string {
  // "HH:MM" from toTimeString()'s "HH:MM:SS GMT…" prefix — locale independent.
  return new Date().toTimeString().slice(0, 5)
}

/**
 * Start the status line inside the `tuiStatus` inject.
 *
 * The inject (not a ctx.get probe) is load-bearing: this plugin's row may
 * start before the dsh-tui-extensions row mounts its services, and a plain
 * `get(name, false)` at apply-time silently misses that ordering. The inject
 * callback fires when the service registers — now or later — and property
 * access inside it carries the caller binding the host's caller checks and
 * effect ledger want. Hosts that never provide the seam simply never run
 * the callback: the intended degradation, not an error.
 * @param ctx - The plugin's own activation context.
 * @param getEffective - Current knobs (re-read on every render so /settings
 *   edits land live without restarting anything).
 */
export function startStatusLine(ctx: Context, getEffective: () => EffectiveStatus): void {
  const dataDir = join(homeDir(), '.dsh-tui')
  ctx.inject(['tuiStatus'], statusCtx => {
    const status = (statusCtx as Context & { tuiStatus: TuiStatusLike }).tuiStatus

    const turns = new Map<object, number>()
    let current: object | undefined
    let dispose: (() => void) | undefined
    let lastText: string | undefined

    const render = (): void => {
      try {
        const eff = getEffective()
        const parts: string[] = []
        // The line is pink garnish: off on other themes unless opted in.
        // The theme check runs here (not once at startup) so a mid-session
        // /theme switch lands on the next tick or session event.
        const themeAllows = eff.statusScope === 'all-themes' || isPinkThemeActive(dataDir)
        if (eff.statusEnabled && themeAllows) {
          if (eff.showGlyph) parts.push(GLYPH)
          if (eff.showClock) parts.push(clockText())
          if (eff.showTurns && current !== undefined) {
            parts.push(`${turns.get(current) ?? 0}✦`)
          }
        }
        const text = parts.join(' · ')
        if (text === lastText) return
        lastText = text
        // The trailing identity must be the inject-scoped context (the same
        // activation the traceable binds as caller) — the plugin's outer ctx
        // is a different activation view and would be silently rejected.
        dispose = status.set(STATUS_KEY, text === '' ? undefined : text, statusCtx) ?? dispose
      } catch {
        // Display garnish only: a rendering hiccup must never travel upward.
      }
    }

    statusCtx.on('session/event', (session, event) => {
      current = session
      if (event?.type === 'turn/end') {
        turns.set(session, (turns.get(session) ?? 0) + 1)
      }
      render()
    })
    statusCtx.on('session/disposed', session => {
      turns.delete(session)
      if (current === session) current = undefined
      render()
    })

    const timer = setInterval(render, CLOCK_TICK_MS)
    timer.unref?.()
    statusCtx.effect(() => () => {
      clearInterval(timer)
      try {
        dispose?.()
      } catch {
        // The host store is already gone on teardown — nothing to clear.
      }
    })
    render()
  })
}
