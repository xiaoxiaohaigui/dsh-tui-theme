/**
 * One-shot guided cleanup for shadowing legacy theme files (tuiDialogs).
 *
 * On a runtime-themes host, byte-identical leftovers in ~/.dsh-tui/themes/
 * (written by pre-0.10 plugin versions or a manual install) permanently
 * shadow the runtime registry, so palette updates never reach the user. The
 * existing toast points them out once; this module additionally offers a
 * host-managed confirm dialog to delete the shadowing copies right away.
 *
 * Safety posture, unchanged from the toast-only era:
 * - only files byte-identical to the bundled copy are ever touched — the
 *   deletion goes through removeBundledThemes(), which re-checks every byte
 *   at deletion time, so a file edited between detection and confirmation
 *   survives;
 * - declining (Esc, the cancel label, the host's 30s auto-cancel when no UI
 *   is attached, or the seam never arriving on older hosts) keeps the exact
 *   previous behavior: the toast stands, nothing is deleted;
 * - the offer happens at most once per activation, and the dialog request is
 *   owned by the activation's effect ledger, so a disposed activation cannot
 *   leave an orphaned panel behind.
 *
 * tuiDialogs is the host's own managed dialog chrome (the pi
 * ctx.ui.confirm seam): the TUI owns the keyboard and renders the panel next
 * to its approval UI — the plugin never touches input itself, which keeps
 * the "no input interception" boundary intact.
 * @module dsh-tui-theme/shadowCleanup
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToastSend } from './toast.js';
/**
 * Start the shadow-cleanup offer. Returns the offer function to call when
 * shadowed files are detected (empty list = no-op). The tuiDialogs service
 * is consumed through ctx.inject and may arrive before or after the offer —
 * both orders converge on one dialog.
 * @param ctx - The plugin's own activation context.
 * @param sendToast - The toast relay sender for the cleanup result.
 */
export declare function startShadowCleanup(ctx: Context, sendToast: ToastSend): (files: readonly string[]) => void;
//# sourceMappingURL=shadowCleanup.d.ts.map