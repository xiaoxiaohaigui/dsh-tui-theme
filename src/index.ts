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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { startStatusLine, type EffectiveStatus, type StatusScope } from './statusLine.js'
import { registerPinkSettings, type PinkSettingsDoc } from './settingsSection.js'
import { startToastRelay } from './toast.js'
import { notifyLegacyThemeFiles } from './legacyNotice.js'
import { hasLiveConfigFields, isLiveConfigKey, liveField, readConfigValues } from './liveConfig.js'
import { PLUGIN_ID } from './pluginId.js'

export const name = PLUGIN_ID

/** Configurable knobs; every key has a sane default. */
export type Config = PinkSettingsDoc

/** The row-config fields in declaration order. The live marking is applied
 *  afterwards from `LIVE_CONFIG_KEYS` (liveConfig.ts) so the /settings card's
 *  editable set and the marked set cannot drift apart — scripts/verify.mjs
 *  asserts both directions of that parity. */
const configFields = {
  statusEnabled: z.boolean().default(true),
  statusGlyph: z.string().default('✿'),
  statusSeparator: z.string().default('·'),
  showGlyph: z.boolean().default(true),
  showClock: z.boolean().default(true),
  showTurns: z.boolean().default(true),
  statusScope: z.union(['pink-only', 'all-themes'] as const).default('pink-only'),
}

// Explicit annotation: the inferred z.dict output references cosmokit's Dict
// through a pnpm-virtual path, which is not portable in declaration emit
// (TS2883). Mirrors the official plugin-template's workaround.
//
// statusEnabled stays a cordis-config knob only (invisible in /settings, and
// therefore not marked live): turning the garnish off entirely is what
// uninstalling is for, per user feedback.
//
// On a `dsh-settings` ≥0.1.7 host the marked fields below ARE the /settings
// form schema (the namespace is the profile entry id); on ≤0.1.6 hosts they
// are ordinary config values and the card's values come from the namespace
// registration instead.
export const Config: Schemastery<Config> = z.object(
  Object.fromEntries(
    Object.entries(configFields).map(([key, field]) => [
      key,
      isLiveConfigKey(key) ? liveField(field) : field,
    ]),
  ) as unknown as typeof configFields,
)

/** Fully-resolved knobs: hardcoded defaults, overlaid by cordis config. */
type EffectiveConfig = EffectiveStatus

const DEFAULTS: EffectiveConfig = {
  statusEnabled: true,
  statusGlyph: '✿',
  statusSeparator: '·',
  showGlyph: true,
  showClock: true,
  showTurns: true,
  statusScope: 'pink-only' as StatusScope,
}

/**
 * Wire the blossom status line.
 * @param ctx - Cordis context (the plugin's own activation).
 * @param config - Validated plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config = {}): void {
  // A `dsh-settings` ≥0.1.7 host hands every marked field to apply as a live
  // ref, not as the value it stands for (liveConfig.ts); unwrap before any
  // read, here and in the readLive() probe the settings wiring re-runs.
  const live = readConfigValues(config)
  // The cordis.yml layer: schema defaults plus explicit ?? fallbacks so a
  // bare composition still resolves every knob.
  const cordis: EffectiveConfig = {
    statusEnabled: live.statusEnabled ?? DEFAULTS.statusEnabled,
    statusGlyph: live.statusGlyph ?? DEFAULTS.statusGlyph,
    statusSeparator: live.statusSeparator ?? DEFAULTS.statusSeparator,
    showGlyph: live.showGlyph ?? DEFAULTS.showGlyph,
    showClock: live.showClock ?? DEFAULTS.showClock,
    showTurns: live.showTurns ?? DEFAULTS.showTurns,
    statusScope: live.statusScope ?? DEFAULTS.statusScope,
  }

  // User-visible one-liners for the few events worth surfacing (the plugin
  // logger is invisible to a TUI user). Hosts without the 0.10 toast seam
  // degrade to a silent no-op.
  const sendToast = startToastRelay(ctx)
  // One-shot migration notice for the theme files ≤0.7.x installed: the host
  // owns those names now, and this plugin never writes ~/.dsh-tui again.
  notifyLegacyThemeFiles(sendToast)

  // The /settings user layer (settings.yaml) overrides the cordis layer and
  // lands live through scope.watch; both override the hardcoded defaults.
  let effective: EffectiveConfig = cordis
  registerPinkSettings(ctx, {
    cordis,
    // The live row config: on ≥0.1.7 hosts the loader rewrites these refs in
    // place, so re-reading after `loader/volatile-update` yields the edit.
    readLive: () => readConfigValues(config),
    hasLiveFields: hasLiveConfigFields(Config),
    onDoc: doc => {
      effective = { ...cordis, ...doc }
    },
  })

  startStatusLine(ctx, () => effective)
}
