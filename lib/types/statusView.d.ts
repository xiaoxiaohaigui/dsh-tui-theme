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
import type { TuiStatusViewDescriptor } from '@deepseek-harness-tui/dsh-tui/extensions';
/** Raw color values for one render, straight from the active palette (or
 *  all undefined under non-pink themes — the terminal default then applies). */
export interface StatusColors {
    readonly glyph: string | undefined;
    readonly text: string | undefined;
    readonly separator: string | undefined;
}
export declare const NO_COLORS: StatusColors;
/** Everything one render needs, as scalars only. Frozen by the store. */
export interface StatusSnapshot {
    readonly visible: boolean;
    readonly glyph: string | undefined;
    readonly clock: string | undefined;
    /** The turn-count cell, e.g. "3✦" (undefined while no session is live). */
    readonly turns: string | undefined;
    readonly separator: string;
    readonly colors: StatusColors;
}
/**
 * The plugin-side external store the rich view subscribes to. Pushes are
 * deduplicated: a snapshot equal to the current one notifies nobody, so a
 * clock tick that changed nothing costs no React render.
 */
export interface StatusStore {
    getSnapshot(): StatusSnapshot;
    subscribe(listener: () => void): () => void;
    push(next: StatusSnapshot): void;
    /** Drop all listeners (activation teardown). */
    clear(): void;
}
export declare function createStatusStore(): StatusStore;
/** Structural views of the host kit; the real types live in the host. */
interface StatusViewReact {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
    useSyncExternalStore(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => StatusSnapshot): StatusSnapshot;
}
interface StatusViewUi {
    readonly Box: unknown;
    readonly Text: unknown;
}
export interface StatusViewProps {
    readonly React: StatusViewReact;
    readonly ui: StatusViewUi;
}
/**
 * Build the rich view component bound to one store. The returned function is
 * a host React component: it receives `{ React, ui }` from the host on every
 * render and maps the current snapshot to a one-row themed Box.
 */
export declare function createStatusViewComponent(store: StatusStore): (props: StatusViewProps) => unknown;
/**
 * The registration descriptor for the rich view. The caller passes the same
 * contribution key the scalar path uses, so the effect-ledger resource id
 * and the headless order-test pin remain stable across both paths.
 */
export declare function statusViewDescriptor(key: string, component: TuiStatusViewDescriptor['component']): TuiStatusViewDescriptor;
export {};
//# sourceMappingURL=statusView.d.ts.map