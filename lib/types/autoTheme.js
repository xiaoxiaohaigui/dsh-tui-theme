/**
 * Cached terminal-background follow for the pink theme pair.
 *
 * dsh-TUI does not expose a plugin terminal-query seam. Plugins must
 * therefore not create their own stdin consumers or raw-mode leases: the host
 * owns both through Ink. This module only applies a previously stored result
 * before mount. A future host-owned query service can refresh that cache
 * without changing the preference format used here.
 *
 * The pref write mirrors the host's writeThemePref byte-for-byte
 * ({"theme": name}, 2-space indent).
 * @module dsh-tui-theme/autoTheme
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
/** The pair this feature switches between (light terminal -> day). */
const LIGHT_THEME = 'pink-day';
const DARK_THEME = 'pink-night';
function prefPath(dir) {
    return join(dir, 'theme.json');
}
function cachePath(dir) {
    return join(dir, 'theme-follow.json');
}
function readJsonSync(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
}
function writeJsonSync(path, value) {
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
        renameSync(temporary, path);
        return true;
    }
    catch {
        try {
            rmSync(temporary, { force: true });
        }
        catch {
            // The filesystem is already failing; a stale temp file is harmless.
        }
        return false;
    }
}
/** The persisted theme pref ({ theme: name }), host format. */
export function readThemePref(dataDir) {
    const parsed = readJsonSync(prefPath(dataDir));
    return typeof parsed?.theme === 'string' ? parsed.theme : undefined;
}
/** Persist the theme pref in the host's exact format. */
export function writeThemePref(name, dataDir) {
    return writeJsonSync(prefPath(dataDir), { theme: name });
}
/** The cached terminal-background result, if a prior compatible writer stored one. */
export function readFollowCache(dataDir) {
    const cached = readJsonSync(cachePath(dataDir));
    return typeof cached?.light === 'boolean' ? cached : undefined;
}
/** Map a cached background to this pair's theme name. */
export function themeForBackground(light) {
    return light ? LIGHT_THEME : DARK_THEME;
}
/**
 * Apply the cached follow behavior synchronously before mount. It returns the
 * resolved name only when the existing preference already matched or the new
 * preference committed successfully.
 */
export function applyCachedFollow(dataDir) {
    const cached = readFollowCache(dataDir);
    if (cached === undefined)
        return undefined;
    const target = themeForBackground(cached.light);
    if (readThemePref(dataDir) === target)
        return target;
    return writeThemePref(target, dataDir) ? target : undefined;
}
/**
 * Apply a previously detected background without touching terminal I/O. A
 * future host-owned terminal query service may refresh theme-follow.json; this
 * plugin intentionally does not access stdin, stdout, or raw mode directly.
 */
export function runFollowSystem(dataDir, isCurrent, log) {
    if (!isCurrent())
        return;
    const applied = applyCachedFollow(dataDir);
    if (!isCurrent())
        return;
    if (applied === undefined) {
        log('follow: cached background unavailable or preference write failed; keeping current choice');
    }
    else {
        log(`follow: applied cached background (${applied})`);
    }
}
