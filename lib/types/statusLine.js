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
import { join } from 'node:path';
import { homeDir } from './themeAssets.js';
import { readThemePref } from './autoTheme.js';
import { PLUGIN_ID } from './pluginId.js';
const GLYPH = '✿';
// The tuiStatus contribution key (same value as the settings namespace and
// the cordis plugin name — one literal would be three drift risks).
const STATUS_KEY = PLUGIN_ID;
const CLOCK_TICK_MS = 15_000;
// The persisted-pref cache lives for one clock tick: a mid-session /theme
// switch (the host rewrites theme.json alongside its own in-memory switch)
// lands on the next turn boundary or tick, which is exactly the "next tick"
// semantic the render path always promised. Without the cache every render
// would pay a synchronous stat+read+JSON.parse on the host's UI thread.
const THEME_PREF_TTL_MS = CLOCK_TICK_MS;
/** The bundled themes this garnish belongs to. */
const PINK_THEMES = new Set(['pink-night', 'pink-day', 'pink-ansi']);
// `value: undefined` is a cached "no pref file / unparsable" answer, so the
// common non-pink host (no theme.json at all) is one memory read per TTL
// window instead of a failed syscall per render.
let prefCache;
/**
 * @internal Drop the persisted-pref cache (verify.mjs only; not part of the
 * plugin's behavioral contract). Production invalidation is the TTL.
 */
export function invalidateThemePrefCacheForTests() {
    prefCache = undefined;
}
/**
 * The active theme name by the host's own precedence: DSH_TUI_THEME first,
 * then the persisted ~/.dsh-tui/theme.json pref (read through a one-tick
 * cache). The unforced path (OSC 11 auto-detection) only ever resolves to a
 * builtin palette, never a pink one, so "no pref" means non-pink.
 *
 * This deliberately mirrors the host's ThemeProvider resolution chain
 * (`components/design-system/ThemeProvider.tsx`, baseline dsh-TUI 0.9.3);
 * keep the two in sync if the host adds a precedence layer. If the host ever
 * exposes a theme-query seam for plugins, prefer that over this re-read.
 */
function activeThemeName(dataDir) {
    const env = process.env.DSH_TUI_THEME;
    if (env !== undefined && env !== '')
        return env;
    const now = Date.now();
    if (prefCache === undefined || now - prefCache.at >= THEME_PREF_TTL_MS) {
        prefCache = { at: now, value: readThemePref(dataDir) };
    }
    return prefCache.value;
}
function isPinkThemeActive(dataDir) {
    const name = activeThemeName(dataDir);
    return name !== undefined && PINK_THEMES.has(name);
}
function clockText() {
    // "HH:MM" from toTimeString()'s "HH:MM:SS GMT…" prefix — locale independent.
    return new Date().toTimeString().slice(0, 5);
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
export function startStatusLine(ctx, getEffective) {
    const dataDir = join(homeDir(), '.dsh-tui');
    ctx.inject(['tuiStatus'], statusCtx => {
        const status = statusCtx.tuiStatus;
        const turns = new Map();
        let current;
        let dispose;
        let lastText;
        const render = () => {
            try {
                const eff = getEffective();
                const parts = [];
                // The line is pink garnish: off on other themes unless opted in.
                // The theme check runs here (not once at startup) so a mid-session
                // /theme switch lands within one pref-cache TTL — the next tick or
                // turn boundary.
                const themeAllows = eff.statusScope === 'all-themes' || isPinkThemeActive(dataDir);
                if (eff.statusEnabled && themeAllows) {
                    if (eff.showGlyph)
                        parts.push(GLYPH);
                    if (eff.showClock)
                        parts.push(clockText());
                    if (eff.showTurns && current !== undefined) {
                        parts.push(`${turns.get(current) ?? 0}✦`);
                    }
                }
                const text = parts.join(' · ');
                if (text === lastText)
                    return;
                lastText = text;
                // The trailing identity must be the inject-scoped context (the same
                // activation the traceable binds as caller) — the plugin's outer ctx
                // is a different activation view and would be silently rejected.
                dispose = status.set(STATUS_KEY, text === '' ? undefined : text, statusCtx) ?? dispose;
            }
            catch {
                // Display garnish only: a rendering hiccup must never travel upward.
            }
        };
        statusCtx.on('session/event', (session, event) => {
            current = session;
            const type = event?.type;
            if (type === 'turn/end') {
                turns.set(session, (turns.get(session) ?? 0) + 1);
            }
            // The firehose filter: session/event carries every token-level chunk,
            // tool call, and step bracket, but the rendered text only changes at
            // turn boundaries (the count) or on the clock timer. turn/start is a
            // session's first live event, so a session switch repaints immediately
            // (the new session's count is 0 until its first turn ends).
            if (type === 'turn/start' || type === 'turn/end')
                render();
        });
        statusCtx.on('session/disposed', session => {
            turns.delete(session);
            if (current === session)
                current = undefined;
            render();
        });
        const timer = setInterval(render, CLOCK_TICK_MS);
        timer.unref?.();
        statusCtx.effect(() => () => {
            clearInterval(timer);
            try {
                dispose?.();
            }
            catch {
                // The host store is already gone on teardown — nothing to clear.
            }
        });
        render();
    });
}
