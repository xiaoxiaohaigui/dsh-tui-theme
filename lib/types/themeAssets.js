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
import { mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
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
/** Read bundled descriptors for hosts that support runtime theme registration. */
export function readBundledThemes(sourceDir = bundledThemesDir()) {
    let files;
    try {
        files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'));
    }
    catch (error) {
        console.warn(`dsh-tui-theme: could not read bundled themes from ${sourceDir}: ${String(error)}`);
        return [];
    }
    const themes = [];
    for (const file of files) {
        try {
            const value = JSON.parse(readFileSync(join(sourceDir, file), 'utf8'));
            const name = value.name;
            const base = value.base;
            const colors = value.colors;
            if (typeof name !== 'string' ||
                !/^[a-z][a-z0-9_-]*(?::[a-z][a-z0-9_-]*)?$/u.test(name) ||
                (base !== 'light' && base !== 'dark' && base !== 'dark-ansi') ||
                colors === null ||
                typeof colors !== 'object' ||
                Array.isArray(colors)) {
                throw new Error('invalid theme descriptor');
            }
            const normalizedColors = {};
            for (const [key, color] of Object.entries(colors)) {
                if (typeof color !== 'string')
                    throw new Error(`invalid color for ${key}`);
                normalizedColors[key] = color;
            }
            themes.push({
                file,
                name,
                ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
                base,
                colors: normalizedColors,
            });
        }
        catch (error) {
            console.warn(`dsh-tui-theme: skipping bundled theme ${file}: ${String(error)}`);
        }
    }
    return themes;
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
                    const healed = healCorruptTarget(target, text);
                    if (healed === 'repaired')
                        repaired.push(file);
                    else if (healed === 'failed')
                        failed.push(file);
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
 * Remove files that this activation installed when a runtime theme service
 * becomes available. A byte-for-byte check preserves edits made in the small
 * window between installation and runtime confirmation.
 */
export function removeBundledThemes(files, targetDir = themesTargetDir(), sourceDir = bundledThemesDir()) {
    const removed = [];
    for (const file of files) {
        try {
            const bundled = readFileSync(join(sourceDir, file), 'utf8');
            const target = join(targetDir, file);
            if (readFileSync(target, 'utf8') !== bundled)
                continue;
            unlinkSync(target);
            removed.push(file);
        }
        catch {
            // Runtime registration must remain best-effort if a file disappears or
            // the target directory becomes unavailable during teardown.
        }
    }
    if (removed.length > 0) {
        try {
            if (readdirSync(targetDir).length === 0)
                rmdirSync(targetDir);
        }
        catch {
            // An empty directory is only a cosmetic artifact; leave it in place if
            // it was removed concurrently or is no longer empty.
        }
    }
    return removed;
}
/**
 * Bundled theme files present in the target directory byte-for-byte
 * identical to the bundled copy. On runtime-theme hosts such files shadow
 * the registry while adding nothing, so the entry point can point them out
 * once. User-edited or foreign same-named files are never reported — the
 * never-overwrite rule keeps them, and no toast may nag about them.
 */
export function findShadowedBundledThemes(targetDir = themesTargetDir(), sourceDir = bundledThemesDir()) {
    const shadowed = [];
    let files;
    try {
        files = readdirSync(sourceDir).filter(entry => entry.toLowerCase().endsWith('.json'));
    }
    catch {
        return shadowed;
    }
    for (const file of files) {
        try {
            if (readFileSync(join(targetDir, file), 'utf8') === readFileSync(join(sourceDir, file), 'utf8')) {
                shadowed.push(file);
            }
        }
        catch {
            // Missing or unreadable target: not a shadow.
        }
    }
    return shadowed;
}
/**
 * Self-heal an existing target that fails to parse as JSON — the leftover of
 * a torn write from an interrupted installation. The damaged file is kept as
 * <target>.corrupt-<timestamp>-<pid>-<random> and the bundled copy installed
 * fresh. Returns `skipped` when the target is valid JSON or unreadable, and
 * `failed` when the corrupt target was moved but replacement could not finish.
 */
function healCorruptTarget(target, text) {
    let existing;
    try {
        existing = readFileSync(target, 'utf8');
    }
    catch {
        return 'skipped';
    }
    try {
        JSON.parse(existing);
        return 'skipped';
    }
    catch {
        // Proven corrupt: fall through to backup and reinstall.
    }
    let backup;
    try {
        backup = `${target}.corrupt-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
        renameSync(target, backup);
    }
    catch {
        return 'skipped';
    }
    try {
        writeFileSync(target, text, { flag: 'wx' });
        return 'repaired';
    }
    catch {
        return 'failed';
    }
}
