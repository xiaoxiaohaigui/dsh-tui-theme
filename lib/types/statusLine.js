/**
 * Blossom status line (seam eleven: tuiStatus).
 *
 * One keyed contribution above the prompt: a ✿ glyph, a wall clock, and the
 * live turn count of the current session (seam one, read-only — nothing is
 * ever appended to the session log). The host owns rendering and
 * sanitization; text is scalars only.
 *
 * Two render paths, chosen once per activation (no hot switching):
 * - dsh-TUI >= 0.10.1 (`registerView` present): a themed one-row rich view
 *   (see statusView.ts) whose colors come from the active pink palette;
 * - older hosts: the historical scalar `set()` line, which the host renders
 *   uncolored + terminal dim.
 *
 * The line belongs to the pink palettes: by default it only renders while a
 * pink theme is active (checked per render with the host's own theme
 * precedence, so a mid-session /theme switch takes effect within the pref
 * cache TTL — at most one clock tick); `statusScope: 'all-themes'` opts it
 * into every other theme too (uncolored there — non-pink palettes are not
 * readable from a plugin).
 *
 * Cost discipline: `session/event` is a token-level firehose (assistant/chunk
 * et al.), but the rendered content only changes at turn boundaries and on
 * the clock, so pushes/renders run on turn/start, turn/end, session/disposed,
 * and the 15s tick — never per streamed chunk. The persisted-pref read behind
 * the theme check and the palette read behind the colors are each cached for
 * the same tick length so a render is pure string building.
 * @module dsh-tui-theme/statusLine
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledThemesDir, homeDir, themesTargetDir } from './themeAssets.js';
import { readThemePref } from './autoTheme.js';
import { sanitizeOrnament } from './ornament.js';
import { createStatusStore, createStatusViewComponent, statusViewDescriptor, NO_COLORS, } from './statusView.js';
import { PLUGIN_ID } from './pluginId.js';
const GLYPH = '✿';
const SEPARATOR = '·';
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
 * @internal Drop the persisted-pref and palette caches (verify.mjs only; not
 * part of the plugin's behavioral contract). Production invalidation is the
 * TTL. Both caches share the reset so test scenarios cannot couple through
 * the 15s palette TTL the way they could through the pref one.
 */
export function invalidateThemePrefCacheForTests() {
    prefCache = undefined;
    colorsCache = undefined;
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
// ── palette colors ──────────────────────────────────────────────────────────
// Read from the effective pink palette with the same one-tick cache as the
// pref: a legacy ~/.dsh-tui/themes/<name>.json first (it shadows the runtime
// registry on old hosts), then this package's bundled copy. Non-pink themes
// render uncolored.
let colorsCache;
function paletteCell(colors, keys) {
    for (const key of keys) {
        const value = colors[key];
        if (typeof value === 'string' && value !== '')
            return value;
    }
    return undefined;
}
function readPalette(name) {
    // `accent` is the 0.10.1 canonical brand key; `claude` is the 0.9.x name
    // the bundled JSONs still carry (the host aliases it at admission, but this
    // read bypasses the host entirely).
    for (const dir of [themesTargetDir(), bundledThemesDir()]) {
        try {
            const parsed = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
            if (parsed.colors === null || typeof parsed.colors !== 'object')
                continue;
            return {
                glyph: paletteCell(parsed.colors, ['accent', 'claude']),
                text: paletteCell(parsed.colors, ['text']),
                separator: paletteCell(parsed.colors, ['subtle', 'inactive']),
            };
        }
        catch {
            // Missing or unreadable source: try the next one.
        }
    }
    return NO_COLORS;
}
function paletteFor(dataDir) {
    const name = activeThemeName(dataDir);
    if (name === undefined || !PINK_THEMES.has(name))
        return NO_COLORS;
    const now = Date.now();
    if (colorsCache === undefined || colorsCache.name !== name || now - colorsCache.at >= THEME_PREF_TTL_MS) {
        colorsCache = { at: now, name, colors: readPalette(name) };
    }
    return colorsCache.colors;
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
        let legacyDispose;
        let viewDispose;
        let store;
        // The scalar path's render. Both paths compute the same cells; they only
        // differ in how the result reaches the host.
        const renderScalar = () => {
            const eff = getEffective();
            const cells = statusCells(eff);
            const separator = sanitizeOrnament(eff.statusSeparator, SEPARATOR);
            const parts = [cells.glyph, cells.clock, cells.turns].filter((value) => value !== undefined);
            const text = parts.join(` ${separator} `);
            if (text === lastText)
                return;
            lastText = text;
            // The trailing identity must be the inject-scoped context (the same
            // activation the traceable binds as caller) — the plugin's outer ctx
            // is a different activation view and would be silently rejected.
            legacyDispose = status.set(STATUS_KEY, text === '' ? undefined : text, statusCtx) ?? legacyDispose;
        };
        let lastText;
        const render = () => {
            try {
                if (store !== undefined) {
                    const eff = getEffective();
                    const cells = statusCells(eff);
                    store.push({
                        visible: cells.glyph !== undefined || cells.clock !== undefined || cells.turns !== undefined,
                        glyph: cells.glyph,
                        clock: cells.clock,
                        turns: cells.turns,
                        separator: sanitizeOrnament(eff.statusSeparator, SEPARATOR),
                        colors: paletteFor(dataDir),
                    });
                    return;
                }
                renderScalar();
            }
            catch {
                // Display garnish only: a rendering hiccup must never travel upward.
            }
        };
        /** The three optional cells (all undefined = the line is off: master
         *  switch, theme scope, and the toggles fold into this one shape). */
        function statusCells(eff) {
            const enabled = eff.statusEnabled && (eff.statusScope === 'all-themes' || isPinkThemeActive(dataDir));
            if (!enabled)
                return { glyph: undefined, clock: undefined, turns: undefined };
            return {
                glyph: eff.showGlyph ? sanitizeOrnament(eff.statusGlyph, GLYPH) : undefined,
                clock: eff.showClock ? clockText() : undefined,
                turns: eff.showTurns && current !== undefined ? `${turns.get(current) ?? 0}✦` : undefined,
            };
        }
        // Rich path probe: a soft capability check, exactly like every other
        // seam. registerView is fixed for the host's lifetime, so the choice is
        // made once per activation; a refused registration (returned undefined)
        // or a hostile one that throws falls back to set(). The throw defense is
        // load-bearing: without it the error escapes the inject callback and
        // takes the session/event wiring and the first render down with it.
        if (typeof status.registerView === 'function') {
            const viewStore = createStatusStore();
            try {
                const dispose = status.registerView(statusViewDescriptor(STATUS_KEY, createStatusViewComponent(viewStore)), statusCtx);
                if (dispose !== undefined) {
                    store = viewStore;
                    viewDispose = dispose;
                }
            }
            catch (error) {
                statusCtx.logger.warn(`dsh-tui-theme: rich status view registration failed, staying on the scalar line: ${String(error)}`);
            }
        }
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
                legacyDispose?.();
            }
            catch {
                // The host store is already gone on teardown — nothing to clear.
            }
            try {
                viewDispose?.();
            }
            catch {
                // Same teardown race as above; the rich view is best-effort too.
            }
            store?.clear();
        });
        render();
    });
}
