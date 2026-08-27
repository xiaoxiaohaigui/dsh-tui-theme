/**
 * Bundled-theme installation (seam four: static theme assets).
 *
 * Copies the package's themes/*.json into ~/.dsh-tui/themes/ on boot. Only
 * files that do not exist yet are written — a user's edited or same-named
 * theme file is never overwritten. The one exception is a target that no
 * longer parses as JSON (a torn write from an interrupted installation):
 * that file is backed up under a .corrupt-<timestamp> name and replaced, so
 * a crash can never shadow a bundled theme forever. Every failure is
 * contained per file: a theme garnish must never break the TUI's boot.
 * @module dsh-tui-theme/themeAssets
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Same resolution order as the host's utils/paths.ts homeDir(): os.homedir()
// first, USERPROFILE/HOME spellings as stripped-down fallbacks.
export function homeDir() {
    return homedir() || process.env.USERPROFILE || process.env.HOME || '';
}
/** The package's bundled themes/ directory (sibling of the built lib/). */
export function bundledThemesDir() {
    return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'themes');
}
/** The host's user-theme directory (~/.dsh-tui/themes). */
export function themesTargetDir() {
    return join(homeDir(), '.dsh-tui', 'themes');
}
/**
 * Install every bundled theme JSON that the target directory is missing.
 * @param targetDir - Destination directory (defaults to ~/.dsh-tui/themes).
 * @param sourceDir - Bundled assets (defaults to this package's themes/).
 * @returns Per-file outcome. Never throws.
 */
export function installBundledThemes(targetDir = themesTargetDir(), sourceDir = bundledThemesDir()) {
    const installed = [];
    const skipped = [];
    const repaired = [];
    const failed = [];
    let files;
    try {
        files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'));
    }
    catch {
        return { installed, skipped, repaired, failed: [sourceDir] };
    }
    for (const file of files) {
        const target = join(targetDir, file);
        try {
            const text = readFileSync(join(sourceDir, file), 'utf8');
            JSON.parse(text); // our own asset, but never write a corrupt file out
            mkdirSync(targetDir, { recursive: true });
            try {
                writeFileSync(target, text, { flag: 'wx' });
                installed.push(file);
            }
            catch (error) {
                if (error.code === 'EEXIST') {
                    if (healCorruptTarget(target, text))
                        repaired.push(file);
                    else
                        skipped.push(file);
                }
                else {
                    failed.push(file);
                }
            }
        }
        catch {
            failed.push(file);
        }
    }
    return { installed, skipped, repaired, failed };
}
/**
 * Self-heal an existing target that fails to parse as JSON — the leftover of
 * a torn write from an interrupted installation. The damaged file is kept as
 * <target>.corrupt-<timestamp> and the bundled copy installed fresh. Returns
 * false (leave untouched) when the target is valid JSON (a user file the
 * never-overwrite rule protects), unreadable (unreadable is not proven
 * corrupt), or when the backup/replace itself fails (degrade to the plain
 * silent skip).
 */
function healCorruptTarget(target, text) {
    let existing;
    try {
        existing = readFileSync(target, 'utf8');
    }
    catch {
        return false;
    }
    try {
        JSON.parse(existing);
        return false;
    }
    catch {
        // Proven corrupt: fall through to backup and reinstall.
    }
    try {
        renameSync(target, `${target}.corrupt-${Date.now()}`);
        writeFileSync(target, text, { flag: 'wx' });
        return true;
    }
    catch {
        return false;
    }
}
