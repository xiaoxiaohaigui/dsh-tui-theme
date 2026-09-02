/** Runtime theme registration for dsh-TUI 0.10.0 and newer. */
import { readBundledThemes } from './themeAssets.js';
/**
 * Register every bundled palette through the host runtime seam. The optional
 * callback is used by the entry point to remove its legacy static fallback as
 * soon as the service becomes available.
 */
export function startRuntimeThemes(ctx, onAvailable) {
    ctx.inject(['tuiThemes'], themesCtx => {
        onAvailable?.();
        const themes = themesCtx.tuiThemes;
        const disposers = [];
        for (const bundled of readBundledThemes()) {
            try {
                const dispose = themes.register({
                    name: bundled.name,
                    ...(bundled.displayName === undefined ? {} : { displayName: bundled.displayName }),
                    base: bundled.base,
                    colors: bundled.colors,
                }, themesCtx);
                if (typeof dispose === 'function')
                    disposers.push(dispose);
            }
            catch (error) {
                themesCtx.logger.warn(`dsh-tui-theme: runtime theme registration failed for "${bundled.name}": ${String(error)}`);
            }
        }
        themesCtx.effect(() => () => {
            for (const dispose of disposers.splice(0)) {
                try {
                    dispose();
                }
                catch {
                    // A host teardown may already have removed the registry.
                }
            }
        });
    });
}
