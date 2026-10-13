/**
 * One-shot migration notice for the theme files pre-0.8 releases installed.
 *
 * 0.8 handed the pink family to dsh-TUI: `pink-night` / `pink-day` /
 * `pink-ansi` are host-owned built-ins from the family's upstream merge on,
 * the plugin registers nothing, and it never writes into `~/.dsh-tui` again.
 * Files a ≤0.7.x install left in `~/.dsh-tui/themes/` become dead weight on a
 * host that carries those built-ins — it resolves them *before* static files,
 * so a hand-tuned palette in one of those files silently stops applying. On a
 * host without them (0.10/0.11 ship `tuiToast` but not the family) those files
 * are still the only source of the theme names, so the notice must not talk
 * that user into breaking a working setup.
 *
 * The plugin cannot tell which host generation it runs on (the runtime theme
 * service exposes no lookup and does not report refusals), so the notice stays
 * factual about both: it names the files, states the built-in precedence as a
 * condition, and pairs the advice with its consequences — the host dedupes a
 * static file by its JSON `name` (renaming the file alone changes nothing),
 * and a file that moves off the pink names leaves {@link PINK_THEMES}, so the
 * default `pink-only` scope would hide the status line until the display scope
 * changes too.
 *
 * Delivery is best-effort through the toast relay (which retries a send that
 * raced the seam's arrival), and the marker records a notice the user could
 * actually see, not an attempt: the relay answers the first delivery
 * synchronously and reports any retry that lands through `onDelivered`. The
 * toast seam (0.10) predates the built-in family, so a host whose toast seam
 * never arrives has no built-ins either — there the legacy files still work
 * exactly as before, and recording a notice nobody received would be a lie.
 * That boot stays quiet (a repeated notice would nag; a silent retry does
 * not) and the next one tries again, so a host later upgraded to carry the
 * seam is told exactly once — right when its built-ins start shadowing the
 * files. No legacy files means no toast and no marker: an uninstall stays
 * traceless.
 * @module dsh-tui-theme/legacyNotice
 */
import type { ToastSend } from './toast.js';
/** What one boot found, and whether the notice went out. */
export interface LegacyNoticeOutcome {
    /** Legacy pink-* theme files still present (sorted `*.json` names). */
    readonly files: readonly string[];
    /**
     * Whether this boot issued the notice. The marker follows the *delivery*,
     * so on a host that cannot show a toast yet this is true while the marker
     * stays absent and the next boot repeats the attempt.
     */
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
 * The text is generation-neutral on purpose: it makes the built-in precedence
 * a condition, and it points a user who customized one at the `name` field —
 * the host dedupes a static file against a built-in by that field, not by the
 * file name — plus the display-scope change renaming forces (the default
 * `pink-only` scope keys on the three pink names). At most three file names
 * can be listed, and the whole message stays inside the host's 200-cell toast
 * cap (asserted by verify.mjs scenario 12).
 *
 * The marker lands when the relay confirms a delivery, never on the mere
 * attempt: a host whose toast seam has not arrived (0.8.8–0.9.x, the README's
 * supported floor) still parses the legacy files as static themes, and if it
 * is ever upgraded to one carrying the built-in family, this notice is
 * exactly what the user needs to hear — recording it unheard would swallow it
 * forever (the marker outlives the upgrade).
 *
 * @param send - The toast sender (see toast.ts): it answers whether the first
 *   attempt landed, and reports a retry that lands later through
 *   `onDelivered`; the marker follows that report.
 * @param dir - The host data directory (~/.dsh-tui); overridable for tests.
 */
export declare function notifyLegacyThemeFiles(send: ToastSend, dir?: string): LegacyNoticeOutcome;
//# sourceMappingURL=legacyNotice.d.ts.map