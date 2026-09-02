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
import type { Context } from '@deepseek-ai/cordis';
/** Host toast color vocabulary (neutral when omitted). */
export type ToastColor = 'success' | 'warning' | 'error';
/** Send one transient notification; resolves to whether it was delivered. */
export type ToastSend = (text: string, color?: ToastColor) => boolean;
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