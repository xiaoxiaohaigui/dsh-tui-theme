/** Runtime theme registration for dsh-TUI 0.10.0 and newer. */

import type { Context } from '@deepseek-ai/cordis'
import type { TuiThemeDescriptor } from '@deepseek-harness-tui/dsh-tui/extensions'
import { readBundledThemes } from './themeAssets.js'

interface TuiThemesLike {
  register(descriptor: TuiThemeDescriptor, identity?: Context): () => void
}

/**
 * Register every bundled palette through the host runtime seam. The optional
 * callback is used by the entry point to remove its legacy static fallback as
 * soon as the service becomes available.
 */
export function startRuntimeThemes(ctx: Context, onAvailable?: () => void): void {
  ctx.inject(['tuiThemes'], themesCtx => {
    onAvailable?.()
    const themes = (themesCtx as Context & { tuiThemes: TuiThemesLike }).tuiThemes
    const disposers: Array<() => void> = []
    for (const bundled of readBundledThemes()) {
      try {
        const dispose = themes.register(
          {
            name: bundled.name,
            ...(bundled.displayName === undefined ? {} : { displayName: bundled.displayName }),
            base: bundled.base,
            colors: bundled.colors as TuiThemeDescriptor['colors'],
          },
          themesCtx,
        )
        if (typeof dispose === 'function') disposers.push(dispose)
      } catch (error) {
        themesCtx.logger.warn(`dsh-tui-theme: runtime theme registration failed for "${bundled.name}": ${String(error)}`)
      }
    }
    themesCtx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // A host teardown may already have removed the registry.
        }
      }
    })
  })
}
