/**
 * Blossom status line (seam eleven: tuiStatus).
 *
 * One keyed contribution above the prompt: a ✿ glyph, a wall clock, and the
 * live turn count of the current session (seam one, read-only — nothing is
 * ever appended to the session log). The host owns rendering and
 * sanitization; text is scalars only.
 * @module dsh-tui-pink-theme/statusLine
 */
const GLYPH = '✿';
const STATUS_KEY = 'dsh-tui-theme';
const CLOCK_TICK_MS = 15_000;
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
    ctx.inject(['tuiStatus'], statusCtx => {
        const status = statusCtx.tuiStatus;
        const turns = new Map();
        let current;
        let dispose;
        const render = () => {
            try {
                const eff = getEffective();
                const parts = [];
                if (eff.showGlyph)
                    parts.push(GLYPH);
                if (eff.showClock)
                    parts.push(clockText());
                if (eff.showTurns && current !== undefined) {
                    parts.push(`${turns.get(current) ?? 0}✦`);
                }
                const text = parts.join(' · ');
                // The trailing identity must be the inject-scoped context (the same
                // activation the traceable binds as caller) — the plugin's outer ctx
                // is a different activation view and would be silently rejected.
                dispose = status.set(STATUS_KEY, text === '' ? undefined : text, statusCtx) ?? dispose;
            }
            catch {
                // Display garnish only: a rendering hiccup must never travel upward.
            }
        };
        ctx.on('session/event', (session, event) => {
            current = session;
            if (event?.type === 'turn/end') {
                turns.set(session, (turns.get(session) ?? 0) + 1);
            }
            render();
        });
        ctx.on('session/disposed', session => {
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
