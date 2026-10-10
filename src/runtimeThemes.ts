/** Runtime theme registration for dsh-TUI 0.10.0 and newer. */

import type { Context } from '@deepseek-ai/cordis'
import type { TuiThemeDescriptor } from '@deepseek-harness-tui/dsh-tui/extensions'
import { hostSupportsChromeKeys, hostThemeVersion, withoutChromeKeys } from './hostContract.js'
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
    // The host rejects a whole descriptor over one unknown key, so a palette
    // must never carry a key its contract lacks (hostContract.ts). Pre-0.14.0
    // hosts get the palettes without the eight chrome keys; logged once so a
    // palette downgrade is never mistaken for a broken registration.
    const chromeKeys = hostSupportsChromeKeys()
    if (!chromeKeys) {
      themesCtx.logger.info(
        `dsh-tui-theme: host ${hostThemeVersion() ?? 'unknown'} predates the chrome theme keys (dsh-TUI 0.14.0); registering the palettes without them`,
      )
    }
    const disposers: Array<() => void> = []
    for (const bundled of readBundledThemes()) {
      try {
        const dispose = themes.register(
          {
            name: bundled.name,
            ...(bundled.displayName === undefined ? {} : { displayName: bundled.displayName }),
            base: bundled.base,
            colors: (chromeKeys ? bundled.colors : withoutChromeKeys(bundled.colors)) as TuiThemeDescriptor['colors'],
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
