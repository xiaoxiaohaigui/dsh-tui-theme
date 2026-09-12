/**
 * Validation and sanitization for the two user-configurable ornaments of the
 * status line (the blossom glyph and the separator).
 *
 * The /settings layer validates drafts strictly (1–2 display cells, no
 * control characters — an invalid draft blocks the save). The render layer
 * additionally sanitizes whatever actually arrives in the merged config:
 * hand-edited cordis.yml/settings.yaml values bypass the draft gate, so the
 * strip mirrors the host's own cleanRenderText (complete ANSI sequences
 * first, then C0/C1) before a hard 2-cell cap. A broken ornament must never
 * reach the status line.
 * @module dsh-tui-theme/ornament
 */
/** Rendered width of `text` in terminal cells (code points, wide = 2). */
export declare function displayCells(text: string): number;
/** A /settings draft verdict: accept, clear (re-inherit the default), or
 *  reject (the host blocks the save and keeps the editor open). */
export type OrnamentDraft = {
    kind: 'set';
    value: string;
} | {
    kind: 'clear';
};
/**
 * Validate a glyph/separator draft from the /settings text editor. Empty
 * resets to the built-in default; anything with control/format characters or
 * outside the 1–2 cell budget is rejected (undefined).
 */
export declare function parseOrnamentDraft(text: string): OrnamentDraft | undefined;
/**
 * Sanitize an ornament value from any config layer (draft validation only
 * guards /settings edits): strip complete ANSI sequences, then every control
 * or format character; fall back when nothing renderable remains, and cap
 * the rest at 2 cells so a hand-edited 50-character glyph cannot wreck the
 * line.
 */
export declare function sanitizeOrnament(value: unknown, fallback: string): string;
//# sourceMappingURL=ornament.d.ts.map