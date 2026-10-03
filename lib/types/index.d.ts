/**
 * dsh-tui-theme — dsh-TUI 的樱花粉状态行插件（dsh-TUI 生态）。
 *
 * 0.8 起樱花粉主题归 dsh-TUI 内置（pink-night / pink-day / pink-ansi），本插件
 * 不再携带、安装或注册任何主题：个性化只剩既有接缝，不注册快捷键、不注册命令、
 * 不拦截任何输入：
 * - 接缝十一（状态行）：输入框上方一行小装饰（✿ · 时钟 · 本轮轮数），默认仅在
 *   内置樱花粉主题下显示；富状态视图用内嵌的家族调色板上色（palette.ts），
 *   宿主主题文件与偏好只读不写（themePref.ts）；
 * - 接缝六（设置区块）：/settings 里一个可编辑面板，即时生效；宿主设置服务
 *   换代后（dsh-settings ≥0.1.7，dsh-TUI ≥0.11）面板改由本插件 Config 里标了
 *   live 的字段投影，命名空间取 Loader 条目 id（liveConfig.ts / settingsSection.ts）；
 * - 接缝十二（toast）：0.7.x 留在 ~/.dsh-tui/themes/ 的旧 pink-* 文件提示一次
 *   （legacyNotice.ts）；旧宿主没有该接缝时自动静默。
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
 * Wire the blossom status line.
 * @param ctx - Cordis context (the plugin's own activation).
 * @param config - Validated plugin config (schema defaults applied).
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map