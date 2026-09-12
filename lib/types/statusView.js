/**
 * Rich status view (dsh-TUI >= 0.10.1 seam: `tuiStatus.registerView`).
 *
 * A compact one-row host React component that renders the blossom line with
 * colors taken from the active pink palette — the one thing the scalar
 * `tuiStatus.set` path can never do (the host renders set() text uncolored +
 * terminal dim).
 *
 * Data channel: the component subscribes to a tiny plugin-side external
 * store via the host React's useSyncExternalStore, exactly the "owns its
 * live data via an external store" pattern the host seam documents. The
 * plugin pushes scalar-only snapshots (turn boundaries, the clock tick,
 * settings edits); the component maps one snapshot to themed Text cells and
 * never touches the filesystem, timers, or events itself — it runs on the
 * host's render thread and must stay a pure function of its snapshot.
 *
 * Host kit rules honored here: the component is created with the host React
 * instance handed in via props (single-React rule — the plugin never imports
 * react), and `Box`/`Text` receive only layout/color props (no focus,
 * keyboard, wheel, or ref props; no pointer handlers either — the line is
 * pure display).
 * @module dsh-tui-theme/statusView
 */
export const NO_COLORS = Object.freeze({
    glyph: undefined,
    text: undefined,
    separator: undefined,
});
function sameSnapshot(a, b) {
    return (a.visible === b.visible &&
        a.glyph === b.glyph &&
        a.clock === b.clock &&
        a.turns === b.turns &&
        a.separator === b.separator &&
        a.colors.glyph === b.colors.glyph &&
        a.colors.text === b.colors.text &&
        a.colors.separator === b.colors.separator);
}
export function createStatusStore() {
    const listeners = new Set();
    let current = Object.freeze({
        visible: false,
        glyph: undefined,
        clock: undefined,
        turns: undefined,
        separator: '·',
        colors: NO_COLORS,
    });
    return {
        getSnapshot: () => current,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        push(next) {
            if (sameSnapshot(current, next))
                return;
            current = Object.freeze({
                visible: next.visible,
                glyph: next.glyph,
                clock: next.clock,
                turns: next.turns,
                separator: next.separator,
                colors: Object.freeze({
                    glyph: next.colors.glyph,
                    text: next.colors.text,
                    separator: next.colors.separator,
                }),
            });
            for (const listener of [...listeners]) {
                try {
                    listener();
                }
                catch {
                    // One broken listener must not starve the others.
                }
            }
        },
        clear() {
            listeners.clear();
        },
    };
}
/**
 * Build the rich view component bound to one store. The returned function is
 * a host React component: it receives `{ React, ui }` from the host on every
 * render and maps the current snapshot to a one-row themed Box.
 */
export function createStatusViewComponent(store) {
    return props => {
        const { React, ui } = props;
        const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
        if (!snapshot.visible)
            return null;
        const cells = [];
        if (snapshot.glyph !== undefined) {
            cells.push({ text: snapshot.glyph, color: snapshot.colors.glyph });
        }
        if (snapshot.clock !== undefined) {
            cells.push({ text: snapshot.clock, color: snapshot.colors.text });
        }
        if (snapshot.turns !== undefined) {
            cells.push({ text: snapshot.turns, color: snapshot.colors.text });
        }
        if (cells.length === 0)
            return null;
        const children = [];
        for (const [index, cell] of cells.entries()) {
            if (index > 0) {
                children.push(React.createElement(ui.Text, { key: `sep-${index}`, color: snapshot.colors.separator }, ` ${snapshot.separator} `));
            }
            children.push(React.createElement(ui.Text, { key: `cell-${index}`, color: cell.color }, cell.text));
        }
        return React.createElement(ui.Box, { flexDirection: 'row' }, children);
    };
}
/**
 * The registration descriptor for the rich view. The caller passes the same
 * contribution key the scalar path uses, so the effect-ledger resource id
 * and the headless order-test pin remain stable across both paths.
 */
export function statusViewDescriptor(key, component) {
    return { key, maxRows: 1, component };
}
