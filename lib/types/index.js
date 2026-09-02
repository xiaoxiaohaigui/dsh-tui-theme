/**
 * dsh-tui-theme — 樱花粉主题插件（dsh-TUI 生态）。
 *
 * 个性化全部走既有接缝，不注册快捷键、不注册命令、不拦截任何输入：
 * - 接缝四（主题）：内置三套粉色 JSON（pink-night / pink-day / pink-ansi），
 *   新宿主通过运行时服务注册，旧宿主同步复制进 ~/.dsh-tui/themes/（仅缺失时）；
 * - 缓存背景跟随：安全应用已有的终端背景缓存，在昼樱/夜樱间切换；
 *   dsh-TUI 未提供插件终端查询接缝时，不直接读写 stdin、raw mode 或 OSC 11；
 * - 接缝十一（状态行）：输入框上方一行小装饰（✿ · 时钟 · 本轮轮数）；
 * - 接缝六（设置区块）：/settings 里一个可编辑面板，即时生效。
 *
 * 遵循 #183 纪律：所有宿主服务用 ctx.inject 软探测，缺席即静默降级；
 * 插件缺失或宿主较旧时行为退化为“什么都没发生”，绝不拖垮启动。
 * @module dsh-tui-theme
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { installBundledThemes, homeDir, removeBundledThemes } from './themeAssets.js';
import { startRuntimeThemes } from './runtimeThemes.js';
import { startStatusLine } from './statusLine.js';
import { runFollowSystem } from './autoTheme.js';
import { registerPinkSettings } from './settingsSection.js';
import { PLUGIN_ID } from './pluginId.js';
export const name = PLUGIN_ID;
// Explicit annotation: the inferred z.dict output references cosmokit's Dict
// through a pnpm-virtual path, which is not portable in declaration emit
// (TS2883). Mirrors the official plugin-template's workaround.
//
// statusEnabled / autoInstallThemes stay cordis-config knobs only (invisible
// in /settings): turning the garnish off entirely is what uninstalling is
// for, per user feedback. followSystem defaults off for generic installs;
// the shipped cordis.patch.yml opts this deployment in.
export const Config = z.object({
    autoInstallThemes: z.boolean().default(true),
    statusEnabled: z.boolean().default(true),
    followSystem: z.boolean().default(false),
    showGlyph: z.boolean().default(true),
    showClock: z.boolean().default(true),
    showTurns: z.boolean().default(true),
    statusScope: z.union(['pink-only', 'all-themes']).default('pink-only'),
});
const DEFAULTS = {
    autoInstallThemes: true,
    statusEnabled: true,
    followSystem: false,
    showGlyph: true,
    showClock: true,
    showTurns: true,
    statusScope: 'pink-only',
};
/**
 * Wire the pink theme plugin.
 * @param ctx - Cordis context (the plugin's own activation).
 * @param config - Validated plugin config (schema defaults applied).
 */
export function apply(ctx, config = {}) {
    // The cordis.yml layer: schema defaults plus explicit ?? fallbacks so a
    // bare composition still resolves every knob.
    const cordis = {
        autoInstallThemes: config.autoInstallThemes ?? DEFAULTS.autoInstallThemes,
        statusEnabled: config.statusEnabled ?? DEFAULTS.statusEnabled,
        followSystem: config.followSystem ?? DEFAULTS.followSystem,
        showGlyph: config.showGlyph ?? DEFAULTS.showGlyph,
        showClock: config.showClock ?? DEFAULTS.showClock,
        showTurns: config.showTurns ?? DEFAULTS.showTurns,
        statusScope: config.statusScope ?? DEFAULTS.statusScope,
    };
    // New hosts own the palette in memory. Install synchronously first so an old
    // host can resolve a persisted theme during its first render. If a runtime
    // service appears afterwards, remove only files written by this activation
    // before registering the in-memory palettes.
    let runtimeConfirmed = false;
    const ownedStaticFiles = new Set();
    const installStatic = () => {
        if (runtimeConfirmed)
            return;
        if (!cordis.autoInstallThemes)
            return;
        const result = installBundledThemes();
        for (const file of result.installed) {
            ctx.logger.info(`${PLUGIN_ID}: installed bundled theme "${file}" into ~/.dsh-tui/themes/`);
        }
        for (const file of result.repaired) {
            ctx.logger.warn(`${PLUGIN_ID}: found a corrupt "${file}" in ~/.dsh-tui/themes/, backed it up and reinstalled the bundled copy`);
        }
        for (const file of result.failed) {
            ctx.logger.warn(`${PLUGIN_ID}: could not install bundled theme "${file}"`);
        }
        for (const file of [...result.installed, ...result.repaired])
            ownedStaticFiles.add(file);
    };
    const markRuntimeAvailable = () => {
        runtimeConfirmed = true;
        if (ownedStaticFiles.size > 0) {
            removeBundledThemes([...ownedStaticFiles]);
            ownedStaticFiles.clear();
        }
    };
    let runtimePresent = false;
    try {
        runtimePresent = ctx.get('tuiThemes', false) !== undefined;
    }
    catch {
        runtimePresent = false;
    }
    if (runtimePresent) {
        runtimeConfirmed = true;
        startRuntimeThemes(ctx);
    }
    else {
        installStatic();
        ctx.effect(() => () => {
            ownedStaticFiles.clear();
        });
        startRuntimeThemes(ctx, markRuntimeAvailable);
    }
    // The /settings user layer (settings.yaml) overrides the cordis layer and
    // lands live through scope.watch; both override the hardcoded defaults.
    let effective = cordis;
    // Background follow applies only an existing cache. dsh-TUI exposes
    // no plugin terminal-query seam, so a theme plugin must not compete with
    // Ink's stdin reader or raw-mode lease. The /settings layer still determines
    // whether the cached result may control this startup.
    let followActive;
    const dataDir = join(homeDir(), '.dsh-tui');
    const applyFollow = () => {
        runFollowSystem(dataDir, () => followActive === true, message => {
            ctx.logger.info(`${PLUGIN_ID}: ${message}`);
        });
    };
    registerPinkSettings(ctx, cordis, doc => {
        effective = { ...cordis, ...doc };
        const follow = effective.followSystem === true;
        if (followActive === undefined) {
            // First document: align the baseline, not a switch. A value that only
            // matches the default logs nothing; a user layer that starts enabled
            // still applies the cache immediately.
            followActive = follow;
            if (follow)
                applyFollow();
            return;
        }
        if (followActive !== follow) {
            followActive = follow;
            if (follow) {
                applyFollow();
            }
            else {
                ctx.logger.info(`${PLUGIN_ID}: follow: disabled, manual /theme choice preserved`);
            }
        }
    });
    // The follow decision is owned entirely by the /settings layer above: there
    // is no timer or fallback path on hosts without a settings service — the
    // plugin keeps the user's existing theme choice and degrades to static
    // assets rather than applying a profile default before the merged document
    // can arrive.
    startStatusLine(ctx, () => effective);
}
