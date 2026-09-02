/** Runtime theme registration for dsh-TUI 0.10.0 and newer. */
import type { Context } from '@deepseek-ai/cordis';
/**
 * Register every bundled palette through the host runtime seam. The optional
 * callback is used by the entry point to remove its legacy static fallback as
 * soon as the service becomes available.
 */
export declare function startRuntimeThemes(ctx: Context, onAvailable?: () => void): void;
//# sourceMappingURL=runtimeThemes.d.ts.map