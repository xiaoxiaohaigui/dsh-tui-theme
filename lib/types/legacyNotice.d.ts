/**
 * One-shot migration notice for the theme files pre-0.8 releases installed.
 *
 * 0.8 handed the pink family to dsh-TUI: `pink-night` / `pink-day` /
 * `pink-ansi` are built-ins now, the plugin registers nothing, and it never
 * writes into `~/.dsh-tui` again. Files a ≤0.7.x install left in
 * `~/.dsh-tui/themes/` are dead weight from then on — on a host that knows the
 * built-in names the catalog resolves built-ins *before* static files, so a
 * hand-tuned palette in one of those files silently stops applying.
 *
 * The plugin cannot tell which host generation it runs on (the runtime theme
 * service exposes no lookup and does not report refusals), so the notice stays
 * factual about both: it names the files, says the host now owns those names,
 * and tells a user who customized one how to keep it.
 *
 * Delivery is best-effort through the toast relay (which retries a send that
 * raced the seam's arrival); the marker records the *attempt*, not a
 * confirmed render. A host whose toast seam never arrives is a host without
 * the built-in pink family either — `tuiToast` and the pink palettes landed in
 * the same 0.10 line — so a lost notice there costs nothing, while a repeated
 * one would nag. No legacy files means no toast and no marker: an uninstall
 * stays traceless.
 * @module dsh-tui-theme/legacyNotice
 */
import type { ToastSend } from './toast.js';
/** What one boot found, and whether the notice reached the user. */
export interface LegacyNoticeOutcome {
    /** Legacy pink-* theme files still present (sorted `*.json` names). */
    readonly files: readonly string[];
    /** Whether this boot issued the notice (and recorded the marker). */
    readonly notified: boolean;
}
/**
 * Legacy `pink-*.json` files in the host's user theme directory. Foreign names
 * are never reported: the plugin only ever installed the three pink files, and
 * a hand-made theme is the user's business, not a migration artifact.
 */
export declare function findLegacyThemeFiles(dir?: string): string[];
/**
 * Point out leftover plugin-installed theme files exactly once.
 *
 * @param send - The toast sender (see toast.ts); its answer is advisory — the
 *   relay's own retry chain covers a seam that has not arrived yet.
 * @param dir - The host data directory (~/.dsh-tui); overridable for tests.
 */
export declare function notifyLegacyThemeFiles(send: ToastSend, dir?: string): LegacyNoticeOutcome;
//# sourceMappingURL=legacyNotice.d.ts.map