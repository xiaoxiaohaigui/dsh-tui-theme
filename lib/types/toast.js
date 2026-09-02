/**
 * Toast relay for the plugin-facing transient-notification seam
 * (dsh-TUI 0.10: `ctx.tuiToast`).
 *
 * The plugin's own logger output is invisible to a TUI user, so the few
 * events worth surfacing — a follow-system pref write, a repaired theme
 * file, a shadowing legacy static install — go through the host's toast
 * surface instead. Sending is fire-and-forget: hosts without the seam
 * (dsh-TUI < 0.10) never fire the inject and every send is a silent no-op,
 * exactly like the other soft-probed seams.
 *
 * The host registers its toast sink late (the dsh-tui row applies after the
 * extensions row, and both may trail this plugin), so a toast dropped for
 * having no sink is retried on a short schedule before giving up. The
 * tuiToast service itself arrives with the extensions row, so a send fired
 * before the seam even exists waits on the same schedule. Retries are
 * bounded, unref'd, and cleared with the activation; a toast lost to a host
 * rate limit is not worth fighting — the next real event re-reports.
 * @module dsh-tui-theme/toast
 */
import { AsyncResource } from 'node:async_hooks';
/** Drop-retry schedule (ms). The first delivery attempt is always immediate. */
const RETRY_DELAYS_MS = [2_000, 4_000];
let retryDelays = RETRY_DELAYS_MS;
/**
 * @internal Shrink the retry schedule for hermetic tests (verify.mjs only;
 * not part of the plugin's behavioral contract).
 */
export function setToastRetryDelaysForTests(delays) {
    retryDelays = delays;
}
/**
 * Start the toast relay. Returns a sender that is callable immediately and
 * from any later context (settings watches, timers): `show()` binds through
 * the service's own activation, so unlike `tuiStatus.set` it takes no
 * identity argument — but the service object itself must still be read
 * inside the inject (same rule as every other seam).
 * @param ctx - The plugin's own activation context.
 */
export function startToastRelay(ctx) {
    const pending = new Set();
    let show;
    const clearPending = () => {
        for (const timer of pending)
            clearTimeout(timer);
        pending.clear();
    };
    ctx.inject(['tuiToast'], toastCtx => {
        const toast = toastCtx.tuiToast;
        // show() resolves its caller through the ambient Cordis activation, so a
        // call from a foreign async scope (a settings watch, a host timer of
        // another seam) is refused even though this plugin is alive. Capture the
        // activation scope here — inside the inject, where it is ambient — and
        // re-enter it for every send, exactly like the inject-created interval
        // that keeps the status line rendering.
        const scope = new AsyncResource('dsh-tui-theme-toast');
        show = (text, options) => {
            try {
                return scope.runInAsyncScope(() => toast.show(text, options));
            }
            catch {
                // A hostile or tearing-down host must never propagate into the caller.
                return false;
            }
        };
        toastCtx.effect(() => () => {
            show = undefined;
            clearPending();
        });
    });
    ctx.effect(() => () => {
        show = undefined;
        clearPending();
    });
    const attempt = (text, color, depth) => {
        // A seam that has not arrived yet (the extensions row applies after this
        // plugin) retries on the same bounded schedule as a dropped send.
        if (show !== undefined && show(text, color === undefined ? {} : { color }))
            return true;
        if (depth >= retryDelays.length)
            return false;
        const timer = setTimeout(() => {
            pending.delete(timer);
            attempt(text, color, depth + 1);
        }, retryDelays[depth]);
        timer.unref?.();
        pending.add(timer);
        return false;
    };
    return (text, color) => attempt(text, color, 0);
}
