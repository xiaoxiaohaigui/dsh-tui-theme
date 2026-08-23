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
import type { Context } from '@deepseek-ai/cordis';
import { type PinkSettingsDoc } from './settingsSection.js';
export declare const name = "dsh-tui-theme";
/** Configurable knobs; every key has a sane default. */
export type Config = PinkSettingsDoc;
export declare const Config: Schemastery<Config>;
/**
 * Wire the pink theme plugin.
 * @param ctx - Cordis context (the plugin's own activation).
 * @param config - Validated plugin config (schema defaults applied).
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map