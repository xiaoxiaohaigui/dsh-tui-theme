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

import { AsyncResource } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { removeBundledThemes } from './themeAssets.js'
import type { ToastSend } from './toast.js'
import { PLUGIN_ID } from './pluginId.js'

/** Structural view of the host service; the real type lives in the host. */
interface TuiDialogsLike {
  confirm(owner: Context, request: unknown): Promise<boolean>
}

/**
 * Start the shadow-cleanup offer. Returns the offer function to call when
 * shadowed files are detected (empty list = no-op). The tuiDialogs service
 * is consumed through ctx.inject and may arrive before or after the offer —
 * both orders converge on one dialog.
 * @param ctx - The plugin's own activation context.
 * @param sendToast - The toast relay sender for the cleanup result.
 */
export function startShadowCleanup(ctx: Context, sendToast: ToastSend): (files: readonly string[]) => void {
  let dialogs: TuiDialogsLike | undefined
  let owner: Context | undefined
  // The traceable service resolves its caller through the ambient Cordis
  // activation (the same rule the toast relay works around): capture the
  // inject's async scope and re-enter it for every call, including offers
  // that arrive from another inject of this activation.
  let scope: AsyncResource | undefined
  let pending: readonly string[] | undefined
  let offered = false
  let disposed = false

  const ask = (service: TuiDialogsLike, ownerCtx: Context, files: readonly string[]): void => {
    const names = files.join('、')
    const request = {
      title: '清理旧主题文件',
      message: `检测到 ${files.length} 个与插件内置完全相同的旧主题文件（${names}），它们会遮蔽运行时主题，使配色无法随插件更新。要删除它们吗？`,
      confirmLabel: '删除',
      cancelLabel: '保留',
    }
    const call = (): Promise<boolean> => {
      if (scope === undefined) return service.confirm(ownerCtx, request)
      return scope.runInAsyncScope(() => service.confirm(ownerCtx, request))
    }
    // The real host resolves malformed requests with false rather than
    // rejecting or throwing; a synchronous throw still means a hostile
    // service, and a garnish must never propagate that upward.
    try {
      void call()
        .then(confirmed => {
          // A stale activation must not act on a late answer.
          if (disposed || confirmed !== true) return
          const removed = removeBundledThemes([...files])
          if (removed.length === 0) {
            // Every candidate was edited (or vanished) between detection and
            // confirmation — the byte check protected them, and the earlier
            // toast already describes the situation.
            ctx.logger.info(`${PLUGIN_ID}: shadow cleanup confirmed, but no file was still byte-identical; nothing removed`)
            return
          }
          ctx.logger.info(`${PLUGIN_ID}: removed ${removed.length} shadowing legacy file(s) after user confirmation`)
          sendToast(`✿ 已清理 ${removed.length} 个旧主题文件，配色将随插件自动更新`, 'success')
        })
        .catch(error => {
          ctx.logger.warn(`${PLUGIN_ID}: shadow cleanup dialog failed: ${String(error)}`)
        })
    } catch (error) {
      ctx.logger.warn(`${PLUGIN_ID}: shadow cleanup dialog failed: ${String(error)}`)
    }
  }

  ctx.inject(['tuiDialogs'], dialogsCtx => {
    if (disposed) return
    dialogs = (dialogsCtx as Context & { tuiDialogs: TuiDialogsLike }).tuiDialogs
    owner = dialogsCtx
    scope = new AsyncResource('dsh-tui-theme-shadow-dialog')
    dialogsCtx.effect(() => () => {
      dialogs = undefined
      owner = undefined
      scope = undefined
    })
    const files = pending
    if (files !== undefined) {
      pending = undefined
      ask(dialogs, dialogsCtx, files)
    }
  })

  ctx.effect(() => () => {
    disposed = true
  })

  return files => {
    if (offered || disposed || files.length === 0) return
    offered = true
    if (dialogs !== undefined && owner !== undefined) {
      ask(dialogs, owner, files)
    } else {
      pending = files
    }
  }
}
