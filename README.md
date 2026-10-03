# dsh-tui-theme 🌸

**简体中文** | [English](README_EN.md)

[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 的花符状态行插件：输入框上方一行 `✿ · 时钟 · 轮数`，外加一个 `/settings` 可编辑区块与一条一次性迁移提示，全部走官方接缝，不注册快捷键或命令。

> **0.8 起本插件不再提供主题。** 樱花粉三套（`pink-night` / `pink-day` / `pink-ansi`）已作为**宿主内置预设**随 dsh-TUI 发布，调色板与主题键由上游维护；本包只保留非主题的装饰部分，也就不会再与内置主题抢名字、抢文件或抢调色板。仍在旧宿主（无内置樱族）上使用 0.7.x 主题能力的用户，请继续钉 `dsh-tui-theme@0.7.3`。

## 0.8 变更（升级前请读）

| 0.7.x 的能力 | 0.8 的状态 |
| --- | --- |
| 三套粉主题（运行时注册 / 静态安装） | **移除**。宿主内置同名主题，优先级高于任何同名 `~/.dsh-tui/themes/*.json` |
| 缓存背景跟随（`followSystem`） | **移除**（该功能只为在昼樱/夜樱间切换而存在） |
| 旧主题文件遮蔽检测 + 清理对话框 | **移除**；改为一次性 toast 提示（见下） |
| 花符状态行（含富状态视图配色） | **保留**，配色改为包内嵌的家族三色（`src/palette.ts`） |
| `/settings` 里的 pink-theme 区块 | **保留**，只剩「状态行」一组字段 |
| toast 通道 | **保留**，用于上面那条迁移提示 |

迁移要点：

- 插件不再写入 `~/.dsh-tui`（唯一例外是迁移提示的标记文件 `theme-plugin-notice.json`，只在确实发现旧主题文件时写一次）。插件只**读**宿主的 `theme.json` 判断当前主题。
- 0.7.x 装过的 `~/.dsh-tui/themes/pink-night.json` 等文件不会被删除。在带内置樱族的宿主上它们**不再生效**（内置优先）；**如果你手动改过它们的配色，请把文件改成别的主题名**（例如 `my-pink.json`）才能继续采用。
- 首次启动会对此发一条中性 toast 提示一次，之后不再打扰；被提到的文件不会被动过。
- `~/.dsh-tui/theme-follow.json` 已无人读取，可自行删除。

## 能力一览

| 能力 | 接缝 | 说明 |
| --- | --- | --- |
| **花符状态行** | `tuiStatus` | 输入框上方一行装饰：✿ · 时钟 · 实时轮数；默认仅在内置樱花粉主题下显示 |
| **富状态视图** | `tuiStatus.registerView`（≥ 0.10.1） | 一行 React 视图，用包内嵌的家族调色板上色；旧宿主自动回退到无色标量行 |
| **设置面板** | `tuiSettingsSections` | `/settings` 里一个可编辑区块（花符 / 时钟 / 轮数 / 分隔符 / 展示范围），保存即时生效 |
| **迁移提示** | `tuiToast`（≥ 0.10.0） | 发现 ≤0.7.x 留下的 `pink-*.json` 时提示一次；旧宿主静默降级 |

**明确不做的事**：不注册快捷键、不注册或修改命令、不拦截输入、不追加会话事件、不注入 system prompt、不安装或注册任何主题文件。

## 快速开始

```sh
# 预发布版（npm 上 @latest 仍指向带主题的 0.7.3，预发布需要显式版本）
dsh plugin --profile dsh-tui add -w dsh-tui-theme@0.8.0-pre.1
```

本地 tarball 安装（开发 / 自用）：

```sh
cd /path/to/dsh-tui-theme
npm run build
npm pack
dsh plugin --profile dsh-tui add -w ./dsh-tui-theme-0.8.0-pre.1.tgz
```

> 不要以本地源码目录作为依赖安装：其开发 `node_modules` 可能与 dsh-TUI 宿主解析出不同的 Cordis/DSH framework instance，插件会无法注册服务。

装好后状态行只在樱花粉主题下出现；想在任何主题下都显示，把 `/settings` 里的「状态行展示」改成「所有主题」（那里不上色）。

## 配置

优先级：`/settings` 用户层 > `cordis.yml` 配置层 > 内置默认值。在 `/settings` 里找到 **dsh-tui-theme** 区块：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `showGlyph` | `true` | 花符开关：开 = 以花符开头，关 = 不显示 |
| `statusGlyph` | `✿` | 花符字符：1–2 个显示单元、不接受控制字符，留空恢复默认 |
| `showClock` | `true` | 显示 HH:MM 时钟 |
| `showTurns` | `true` | 显示当前会话轮数（`N✦`，自本次启动起计） |
| `statusSeparator` | `·` | 各段之间的分隔符，校验规则同花符字符 |
| `statusScope` | `pink-only` | 状态行展示：`pink-only` 仅内置樱花粉主题 / `all-themes` 所有主题（非粉主题下无色） |

三项装饰（花符 / 时钟 / 轮数）全关时状态行整体消失。另有仅 profile 层的开关（写在 `cordis.patch.yml`，不出现在 `/settings`）：`statusEnabled`。

> 上表就是本插件的可编辑面：卡片字段与 `src/liveConfig.ts` 的 `LIVE_CONFIG_KEYS` 逐键相等，由 `npm run verify` 双向断言。

### 截图

`/settings` 里的 dsh-tui-theme 区块（0.7.x 实拍；0.8 起卡片只剩「状态行」一组，字段未变）：

![dsh-tui-theme 设置区块](docs/screenshots/settings.png)

## 迁移提示（toast）

插件日志对 TUI 用户不可见，因此唯一值得知道的事件走宿主 toast（≥ 0.10.0 的 `tuiToast` 接缝，纯输出、不拦截任何输入；旧宿主没有该接缝，自动静默）：

| 事件 | 提示 |
| --- | --- |
| 发现 ≤0.7.x 留下的 `pink-*.json` | ✿ 发现旧主题文件 …：pink-* 现由 dsh-TUI 内置并优先于同名文件，本插件不再安装主题；自定义过配色的文件请改名以继续生效 |

同一次安装只提示一次（标记文件记在 `~/.dsh-tui/theme-plugin-notice.json`）。只点名插件当年装过的那三个文件名——你自己建的主题文件永远不会被提及。插件不会删除或修改这些文件。

## 状态行与主题的关系

- 状态行是**装饰**：宿主负责渲染、截断与清理，插件只提交标量文本或一行组件。
- **可见性判定**沿用宿主自己的主题优先级：`DSH_TUI_THEME` 环境变量 > `~/.dsh-tui/theme.json` 持久选择。因此插件只知道“当前主题名”，不缓存调色板；`pink-only` 判据就是那三个内置名。
- **配色**来自 `src/palette.ts` 里内嵌的三个色值（家族 `accent` / `inactiveShimmer` / `subtle`，与宿主内置樱族逐键一致）。宿主没有向插件公开“当前调色板”的查询接缝（运行时主题服务只收注册、不回读），所以这是插件唯一持有的颜色来源；非粉主题一律不着色。
- **标量行在旧宿主上由宿主统一以无色 + dim 渲染**，插件无法控制颜色——这是宿主行为，富状态视图（≥ 0.10.1）正是为了绕开它。
- 插件不安装、不注册、不修补任何主题文件，也不修改 `theme.json`（那是宿主的用户偏好）。

## 卸载

```sh
# 移除插件
dsh plugin --profile dsh-tui remove -w dsh-tui-theme

# 可选：清掉 0.7.x 留下的本地主题资产
rm ~/.dsh-tui/themes/pink-{night,day,ansi}.json
rm ~/.dsh-tui/theme-follow.json
rm ~/.dsh-tui/theme-plugin-notice.json
```

## 兼容性

- **dsh-TUI 下限 0.8.8**（状态行与设置面板，0.9.3 实测）。0.10.1 起状态行走富状态视图按内嵌调色板上色，更旧宿主自动回退无色标量行；缺 `dsh-tui-extensions` 扩展面的宿主自动静默降级，不报错。
- **樱花粉主题需要宿主内置**：`pink-only` 判据是 `pink-night` / `pink-day` / `pink-ansi` 三个名字。宿主尚未内置它们时（含 0.11.2 基线），本插件不提供主题，`pink-only` 下状态行不会显示——请改用 `statusScope: all-themes`，或继续使用 `dsh-tui-theme@0.7.3`。
- **`dsh-settings` 两代都支持**：≤ 0.1.6（dsh-TUI 0.9.x/0.10.x）走插件注册命名空间 + `scope.watch`；≥ 0.1.7（dsh-TUI 0.11+）走 Config volatile 字段投影 + `loader/volatile-update` 重读。判定按能力探测，不解析版本号；两条路径的失败都写日志而不是静默。
- **dsh 运行时 `0.2.0-rc.1` 起有启动期 peer 校验**：宿主读 bundle 的 `peerDependencies`，把 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 段与运行时版本比对，不匹配就跳过整个 bundle（stderr 提示 `skipping profile bundle`）。本插件的 peer 段覆盖 `0.1.0-rc.6`–`0.1.x` 与 `0.2.0-rc.1`–`0.2.x`（自 v0.7.3 起，新世代写作 `^0.2.0-rc.1`），因此 0.2 宿主正常加载。宿主校验固定用 `includePrerelease` 语义，故 0.2 线的预发布档同样放行。
- Node `^22.19 || >=24`，纯 ESM，MIT。

## 开发

```sh
npm install --include=dev   # 本仓不提交 lockfile，务必带 --include=dev
npm run build
npm run verify
npm run verify:package
```

安装前提、验证脚本参数（`verify:settings` / `verify:host`）、CI 门禁与内嵌调色板的维护方式见 [docs/development.md](docs/development.md)。
