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
/** Whether a code point renders double-width in a typical terminal (a
 *  pragmatic subset of Unicode East Asian Width W/F: CJK, Hangul, fullwidth
 *  forms, and the common emoji planes). */
function isWide(code) {
    return ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0x303e) ||
        (code >= 0x3041 && code <= 0x33ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xa000 && code <= 0xa4cf) ||
        (code >= 0xa960 && code <= 0xa97f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd));
}
/** Rendered width of `text` in terminal cells (code points, wide = 2). */
export function displayCells(text) {
    let cells = 0;
    for (const ch of text) {
        cells += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
    }
    return cells;
}
function capToCells(text, maxCells) {
    let out = '';
    let cells = 0;
    for (const ch of text) {
        const width = isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
        if (cells + width > maxCells)
            break;
        out += ch;
        cells += width;
    }
    return out;
}
/**
 * Validate a glyph/separator draft from the /settings text editor. Empty
 * resets to the built-in default; anything with control/format characters or
 * outside the 1–2 cell budget is rejected (undefined).
 */
export function parseOrnamentDraft(text) {
    const trimmed = text.trim();
    if (trimmed === '')
        return { kind: 'clear' };
    if (/[\p{C}]/u.test(trimmed))
        return undefined;
    const cells = displayCells(trimmed);
    if (cells < 1 || cells > 2)
        return undefined;
    return { kind: 'set', value: trimmed };
}
/**
 * Sanitize an ornament value from any config layer (draft validation only
 * guards /settings edits): strip complete ANSI sequences, then every control
 * or format character; fall back when nothing renderable remains, and cap
 * the rest at 2 cells so a hand-edited 50-character glyph cannot wreck the
 * line.
 */
export function sanitizeOrnament(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const flat = value
        .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, '')
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '')
        .replace(/[\p{C}]/gu, '')
        .trim();
    if (flat === '')
        return fallback;
    return capToCells(flat, 2);
}
