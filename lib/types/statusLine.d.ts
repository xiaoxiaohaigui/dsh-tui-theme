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
 * precedence, so a mid-session /theme switch takes effect within the pref
 * cache TTL — at most one clock tick); `statusScope: 'all-themes'` opts it
 * into every other theme too.
 *
 * Cost discipline: `session/event` is a token-level firehose (assistant/chunk
 * et al.), but the rendered text only changes at turn boundaries and on the
 * clock, so renders run on turn/start, turn/end, session/disposed, and the
 * 15s tick — never per streamed chunk. The persisted-pref read behind the
 * theme check is cached for the same tick length so a render is pure string
 * building.
 * @module dsh-tui-theme/statusLine
 */
import type { Context } from '@deepseek-ai/cordis';
/** Which themes the blossom line renders under. */
export type StatusScope = 'pink-only' | 'all-themes';
export interface StatusOptions {
    /** Master switch (cordis-config layer only; not surfaced in /settings). */
    statusEnabled?: boolean;
    /** Lead the line with the ✿ glyph. */
    showGlyph?: boolean;
    /** Include the HH:MM clock. */
    showClock?: boolean;
    /** Include the live turn count of the current session. */
    showTurns?: boolean;
    /** Theme scope of the line (default: the pink palettes only). */
    statusScope?: StatusScope;
}
/** Fully-resolved status knobs. */
export type EffectiveStatus = Required<StatusOptions>;
/**
 * @internal Drop the persisted-pref cache (verify.mjs only; not part of the
 * plugin's behavioral contract). Production invalidation is the TTL.
 */
export declare function invalidateThemePrefCacheForTests(): void;
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