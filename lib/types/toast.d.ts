/**
 * Toast relay for the plugin-facing transient-notification seam
 * (dsh-TUI 0.10: `ctx.tuiToast`).
 *
 * The plugin's own logger output is invisible to a TUI user, so the one event
 * still worth surfacing — the migration notice for theme files a ≤0.7.x
 * install left behind (legacyNotice.ts) — goes through the host's toast
 * surface instead. A send never blocks on a retry chain, but it does report
 * the outcome: hosts without the seam (dsh-TUI < 0.10) never fire the inject,
 * so every attempt is a silent no-op and `onDelivered` stays uncalled —
 * exactly like the other soft-probed seams.
 *
 * The host registers its toast sink late (the dsh-tui row applies after the
 * extensions row, and both may trail this plugin), so a toast dropped for
 * having no sink is retried on a short schedule before giving up. The
 * tuiToast service itself arrives with the extensions row, so a send fired
 * before the seam even exists waits on the same schedule. Retries are
 * bounded, unref'd, and cleared with the activation; a toast lost to a host
 * rate limit is not worth fighting — the next real event re-reports.
 *
 * The caller hears about the outcome, not just the attempt: a send answers
 * whether its first attempt landed, and `onDelivered` fires at the moment a
 * delivery succeeds — which may be a retry, seconds later.
 * @module dsh-tui-theme/toast
 */
import type { Context } from '@deepseek-ai/cordis';
/** Host toast color vocabulary (neutral when omitted). */
export type ToastColor = 'success' | 'warning' | 'error';
/** Per-send options: the color to use and the delivery report to call back. */
export interface ToastSendOptions {
    /** Host toast color vocabulary; neutral when omitted. */
    color?: ToastColor;
    /**
     * Called exactly once, at the moment the text reaches the host's sink — on
     * the first attempt or on a later retry. Never called when every attempt was
     * refused (no seam ever arrived, or the host rejected each send). It must
     * not throw: it runs inside the delivery path.
     */
    onDelivered?: () => void;
}
/**
 * Send one transient notification; resolves to whether the *first* attempt
 * landed. A send that only lands later reports through `onDelivered`, so a
 * caller that records something (legacyNotice's marker) can wait for the
 * delivery instead of the attempt.
 */
export type ToastSend = (text: string, options?: ToastSendOptions) => boolean;
/**
 * @internal Shrink the retry schedule for hermetic tests (verify.mjs only;
 * not part of the plugin's behavioral contract).
 */
export declare function setToastRetryDelaysForTests(delays: readonly number[]): void;
/**
 * Start the toast relay. Returns a sender that is callable immediately and
 * from any later context (settings watches, timers): `show()` binds through
 * the service's own activation, so unlike `tuiStatus.set` it takes no
 * identity argument — but the service object itself must still be read
 * inside the inject (same rule as every other seam).
 * @param ctx - The plugin's own activation context.
 */
export declare function startToastRelay(ctx: Context): ToastSend;
//# sourceMappingURL=toast.d.ts.map