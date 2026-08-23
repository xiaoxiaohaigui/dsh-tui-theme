# dsh-tui-theme 🌸

[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 的樱花粉主题插件。一个包带来四种个性化，全部走官方接缝：

| 个性化 | 接缝 | 说明 |
| --- | --- | --- |
| **三套粉色主题** | 主题（静态资产） | `pink-night` 夜樱 / `pink-day` 昼樱 / `pink-ansi` 樱·ANSI，启动时自动装进 `~/.dsh-tui/themes/` |
| **自动跟随背景** | 启动时序 | 检测终端/系统背景色（OSC 11，与宿主同阈值），在昼樱/夜樱间自动切换——pink 版的 auto |
| **花符状态行** | `tuiStatus` | 输入框上方一行小装饰：✿ · 时钟 · 实时轮数 |
| **设置面板** | `tuiSettingsSections` | `/settings` 里一个可编辑区块，改完即时生效 |

**明确不做的事**：不注册快捷键、不注册/修改任何命令、不拦截输入、不追加会话事件、不注入 system prompt。卸载即无痕（可选删除主题文件）。

## 主题预览

| 主题 | 基底 | 风格 |
| --- | --- | --- |
| `pink-night` 夜樱 | dark | 深梅紫底、玫瑰粉强调、粉鲸鱼吉祥物，96 键全覆盖 |
| `pink-day` 昼樱 | light | 象牙粉底、墨梅正文、柔和玫瑰强调（已通过宿主浅色身份判定） |
| `pink-ansi` 樱·ANSI | dark-ansi | 16 色 ANSI 回退，品牌色映射到 magenta 系 |

三套均通过 dsh-TUI 官方校验器（零警告、全键覆盖）与 WCAG 对比度检查（正文 ≥ 11:1）。

> 小知识：`pink-day` 的 `text` 写成 `rgb(61,43,51)` 而非 hex——宿主按 `text` 墨色亮度自动判定主题深浅，且只认 `rgb()` 格式。

## 自动跟随终端背景

设置里的“跟随终端背景”开启后（本部署默认开启）：

- 每次启动检测终端背景（跟随系统主题的终端会随系统深浅变化），亮 → `pink-day`，暗 → `pink-night`，写入 `~/.dsh-tui/theme.json`，与宿主 `auto` 伪主题同款行为、同一亮度阈值；
- 检测结果缓存在 `~/.dsh-tui/theme-follow.json`，因此切换在**启动瞬间**就生效；首次开启或系统刚翻转后的那次启动可能滞后一拍（与宿主 auto “重新选择或重启后跟上”一致）；
- 开启此功能后 `/theme` 的选择由插件接管（每次启动都会按背景覆写）；关闭它即可恢复手动选择；
- `DSH_TUI_THEME` 环境变量仍然最优先（宿主行为，插件不覆盖环境变量）。

## 安装

```sh
# 方式一：本地路径（开发/自用）
dsh plugin --profile dsh-tui add -w /path/to/dsh-tui-theme

# 方式二：从 GitHub（发布后）
dsh plugin --profile dsh-tui add -w github:<你的用户名>/dsh-tui-theme
```

重启 dsh-TUI 后插件自动把三套主题复制进 `~/.dsh-tui/themes/`（**仅缺失时复制，绝不覆盖你已有的同名文件**），然后：

```sh
# 在 dsh-TUI 里
/theme              # 选择器：夜樱 / 昼樱 / 樱·ANSI
/theme pink-night   # 或直接切换（开启跟随后由插件接管）
```

## 配置

配置有三层，优先级：`/settings` 用户层 > `cordis.yml` 配置层 > 内置默认值。

`/settings` 里找到 **pink-theme** 区块即可编辑：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `followSystem` | 部署默认开 | 跟随终端背景：昼樱 ↔ 夜樱自动切换 |
| `showGlyph` | `true` | 花符：开 = ✿ 开头，关 = 不显示 |
| `showClock` | `true` | 显示 HH:MM 时钟 |
| `showTurns` | `true` | 显示当前会话轮数（`N✦`，自本次启动起计） |

三项装饰全关时状态行整体消失。另有仅 profile 层的开关（`cordis.patch.yml`，不出现在 /settings）：`autoInstallThemes`、`statusEnabled`。

> 已知宿主限制：底栏的上下文进度条分段色（蓝色系）与空余段配色是宿主硬编码的，主题与插件均无法覆盖；自定义浅色主题（pink-day）会拿到深色空余段配色（宿主按 `themeName === 'light'` 判断，不识别自定义浅色主题）。这需要上游修复。

## 卸载

```sh
dsh plugin --profile dsh-tui remove -w dsh-tui-theme    # 移除插件
rm ~/.dsh-tui/themes/pink-{night,day,ansi}.json         # 可选：删除主题文件
rm ~/.dsh-tui/theme-follow.json                         # 可选：删除跟随缓存
```

## 开发

```sh
pnpm install && pnpm build   # tsc -> lib/types/
npm run verify               # 沙盒测试（临时 HOME + 伪造 TTY，不碰真实 ~/.dsh-tui）
```

主题调色板改起来最直接：编辑 `themes/*.json` 后重新 `npm run verify`，再删掉 `~/.dsh-tui/themes/` 下对应文件让插件重装。

## 兼容性

- dsh-TUI 的 `dsh-tui-extensions` 扩展面（tuiStatus / tuiSettingsSections）；旧版 profile 缺这些服务时插件自动退化为“仅安装主题”，不会报错。
- Node `^22.19 || >=24`，纯 ESM，MIT。
