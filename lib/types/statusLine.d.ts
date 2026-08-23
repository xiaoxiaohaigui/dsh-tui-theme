/**
 * Blossom status line (seam eleven: tuiStatus).
 *
 * One keyed contribution above the prompt: a ✿ glyph, a wall clock, and the
 * live turn count of the current session (seam one, read-only — nothing is
 * ever appended to the session log). The host owns rendering and
 * sanitization; text is scalars only.
 * @module dsh-tui-pink-theme/statusLine
 */
import type { Context } from '@deepseek-ai/cordis';
export interface StatusOptions {
    /** Master switch (cordis-config layer only; not surfaced in /settings). */
    statusEnabled?: boolean;
    /** Lead the line with the ✿ glyph. */
    showGlyph?: boolean;
    /** Include the HH:MM clock. */
    showClock?: boolean;
    /** Include the live turn count of the current session. */
    showTurns?: boolean;
}
/** Fully-resolved status knobs. */
export type EffectiveStatus = Required<StatusOptions>;
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
export declare function startStatusLine(ctx: Context, getEffective: () => EffectiveStatus): void;
//# sourceMappingURL=statusLine.d.ts.map