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

import { AsyncResource } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'

/** Host toast color vocabulary (neutral when omitted). */
export type ToastColor = 'success' | 'warning' | 'error'

/** Structural view of the host service; the real type lives in the host. */
interface TuiToastLike {
  show(
    text: string | number | boolean,
    options?: { color?: ToastColor; timeoutMs?: number },
  ): boolean
}

/** Per-send options: the color to use and the delivery report to call back. */
export interface ToastSendOptions {
  /** Host toast color vocabulary; neutral when omitted. */
  color?: ToastColor
  /**
   * Called exactly once, at the moment the text reaches the host's sink — on
   * the first attempt or on a later retry. Never called when every attempt was
   * refused (no seam ever arrived, or the host rejected each send). It must
   * not throw: it runs inside the delivery path.
   */
  onDelivered?: () => void
}

/**
 * Send one transient notification; resolves to whether the *first* attempt
 * landed. A send that only lands later reports through `onDelivered`, so a
 * caller that records something (legacyNotice's marker) can wait for the
 * delivery instead of the attempt.
 */
export type ToastSend = (text: string, options?: ToastSendOptions) => boolean

/** Drop-retry schedule (ms). The first delivery attempt is always immediate. */
const RETRY_DELAYS_MS = [2_000, 4_000]
let retryDelays: readonly number[] = RETRY_DELAYS_MS

/**
 * @internal Shrink the retry schedule for hermetic tests (verify.mjs only;
 * not part of the plugin's behavioral contract).
 */
export function setToastRetryDelaysForTests(delays: readonly number[]): void {
  retryDelays = delays
}

/**
 * Start the toast relay. Returns a sender that is callable immediately and
 * from any later context (settings watches, timers): `show()` binds through
 * the service's own activation, so unlike `tuiStatus.set` it takes no
 * identity argument — but the service object itself must still be read
 * inside the inject (same rule as every other seam).
 * @param ctx - The plugin's own activation context.
 */
export function startToastRelay(ctx: Context): ToastSend {
  const pending = new Set<ReturnType<typeof setTimeout>>()
  let show: TuiToastLike['show'] | undefined

  const clearPending = (): void => {
    for (const timer of pending) clearTimeout(timer)
    pending.clear()
  }

  ctx.inject(['tuiToast'], toastCtx => {
    const toast = (toastCtx as Context & { tuiToast: TuiToastLike }).tuiToast
    // show() resolves its caller through the ambient Cordis activation, so a
    // call from a foreign async scope (a settings watch, a host timer of
    // another seam) is refused even though this plugin is alive. Capture the
    // activation scope here — inside the inject, where it is ambient — and
    // re-enter it for every send, exactly like the inject-created interval
    // that keeps the status line rendering.
    const scope = new AsyncResource('dsh-tui-theme-toast')
    show = (text, options) => {
      try {
        return scope.runInAsyncScope(() => toast.show(text, options))
      } catch {
        // A hostile or tearing-down host must never propagate into the caller.
        return false
      }
    }
    toastCtx.effect(() => () => {
      show = undefined
      clearPending()
    })
  })

  ctx.effect(() => () => {
    show = undefined
    clearPending()
  })

  const attempt = (text: string, options: ToastSendOptions, depth: number): boolean => {
    // A seam that has not arrived yet (the extensions row applies after this
    // plugin) retries on the same bounded schedule as a dropped send.
    if (show !== undefined && show(text, options.color === undefined ? {} : { color: options.color })) {
      options.onDelivered?.()
      return true
    }
    if (depth >= retryDelays.length) return false
    const timer = setTimeout(() => {
      pending.delete(timer)
      attempt(text, options, depth + 1)
    }, retryDelays[depth])
    timer.unref?.()
    pending.add(timer)
    return false
  }

  return (text, options) => attempt(text, options ?? {}, 0)
}
