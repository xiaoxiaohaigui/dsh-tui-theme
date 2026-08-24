/**
 * dsh-tui-theme — 樱花粉主题插件（dsh-TUI 生态）。
 *
 * 个性化全部走既有接缝，不注册快捷键、不注册命令、不拦截任何输入：
 * - 接缝四（主题）：内置三套粉色 JSON（pink-night / pink-day / pink-ansi），
 *   启动时复制进 ~/.dsh-tui/themes/（仅缺失时，绝不覆盖用户已有文件）；
 * - 自动跟随：检测终端/系统背景色（OSC 11，与宿主同阈值），在昼樱/夜樱
 *   间自动切换——pink 版的 auto；
 * - 接缝十一（状态行）：输入框上方一行小装饰（✿ · 时钟 · 本轮轮数）；
 * - 接缝六（设置区块）：/settings 里一个可编辑面板，即时生效。
 *
 * 遵循 #183 纪律：所有宿主服务用 ctx.inject 软探测，缺席即静默降级；
 * 插件缺失或宿主较旧时行为退化为“什么都没发生”，绝不拖垮启动。
 * @module dsh-tui-theme
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { installBundledThemes, homeDir } from './themeAssets.js';
import { startStatusLine } from './statusLine.js';
import { runFollowSystem } from './autoTheme.js';
import { registerPinkSettings } from './settingsSection.js';
export const name = 'dsh-tui-theme';
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
 * Backstop delay for the cordis-layer follow decision on hosts without a
 * settings service (see apply). Stays under the host's own 300ms pre-mount
 * settings gate so the pref write still lands before first paint.
 */
const FOLLOW_FALLBACK_MS = 150;
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
    if (cordis.autoInstallThemes) {
        const result = installBundledThemes();
        for (const file of result.installed) {
            ctx.logger.info(`dsh-tui-theme: installed bundled theme "${file}" into ~/.dsh-tui/themes/`);
        }
        for (const file of result.failed) {
            ctx.logger.warn(`dsh-tui-theme: could not install bundled theme "${file}"`);
        }
    }
    // The /settings user layer (settings.yaml) overrides the cordis layer and
    // lands live through scope.watch; both override the hardcoded defaults.
    let effective = cordis;
    // Background follow honors the MERGED knob (cordis layer overlaid by the
    // /settings user layer), so the decision cannot be taken synchronously at
    // apply(): the user layer is only readable once the settings service
    // answers. The settings callback still fires before the host's React tree
    // mounts (the host gates its own mount on the same service, probed
    // against 0.9.0), so the pref write decides this boot exactly like a sync
    // write would, and toggling followSystem in /settings re-decides live.
    let followActive;
    const dataDir = join(homeDir(), '.dsh-tui');
    const startFollow = () => {
        runFollowSystem(dataDir, message => {
            ctx.logger.info(`dsh-tui-theme: ${message}`);
        });
    };
    registerPinkSettings(ctx, cordis, doc => {
        effective = { ...cordis, ...doc };
        if (effective.followSystem !== followActive) {
            followActive = effective.followSystem;
            if (followActive) {
                startFollow();
            }
            else {
                ctx.logger.info('dsh-tui-theme: follow: disabled, manual /theme choice preserved');
            }
        }
    });
    // Degradation backstop for hosts that never provide a settings service:
    // the inject callback never fires there, so the cordis-layer decision
    // applies instead. The delay lets any pending service registration (and
    // its callback) land first — it no-ops once followActive is settled, and
    // stays inside the host's own 300ms pre-mount settings gate either way.
    setTimeout(() => {
        if (followActive === undefined && cordis.followSystem) {
            followActive = true;
            startFollow();
        }
    }, FOLLOW_FALLBACK_MS);
    startStatusLine(ctx, () => effective);
}
