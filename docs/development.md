# 开发与验证

**简体中文** | [English](development_EN.md)

本页收录 README 之外的开发细节：环境、安装前提、验证脚本参数、CI 门禁、内嵌调色板与迁移提示的维护方式。

## 环境

- Node `^22.19 || >=24`，纯 ESM；TypeScript 编译到 `lib/types/`，构建产物随仓库提交，CI 会校验它与全新构建一致。
- 宿主基线：devDependency 钉住 `@deepseek-harness-tui/dsh-tui@0.11.2`，引擎包同代钉在 `0.2.0-rc.1`；devDependency 的 `dsh-settings` 是 ≥ 0.1.7 的 Config 投影世代，因此 `verify:settings` 在本仓默认就会真跑投影断言（旧代 ≤ 0.1.6 路径由 `verify.mjs` 场景 2 与 `DSH_SETTINGS_DIR` 手验覆盖）。
- ⚠️ 0.11.2 宿主**没有内置樱族**：`pink-only` 判据恒不成立，靠 `verify.mjs` 自己往沙箱 `theme.json` 写 `pink-night` 才能让状态行可见。真机验证内置樱族要用带该分支的宿主构建。

## 安装前提

下面两条会让普通 `npm install` 失败或静默不装依赖：

- **本仓有意不提交 `package-lock.json`。** devDependency 里的宿主 tarball 内嵌 `@dsh-std/*`，其包内 manifest 仍声明 `workspace:*`；提交的 lockfile 会被 npm 忠实重放，于是 `npm install` 与 `npm ci` 都报 `EUNSUPPORTEDPROTOCOL`。删掉 lockfile 后 npm 会直接跳过 tarball 内的 bundle 目录，安装正常。请勿把它提交回来（CI 的 `contract` 档会拦下）。
- **安装时不要带 `NODE_ENV=production`。** 该变量会让 npm 按 `omit=dev` 静默省略 devDependencies，表现为 `up to date` 但 `node_modules` 为空、随后 `tsc` 找不到依赖。所以显式写 `--include=dev`（CI 里另外固定 `NODE_ENV=development`）。

## 常用命令

```sh
npm install --include=dev
npm run build            # tsc → lib/types
npm run verify           # 17 个场景：状态行两代路径、设置卡两代、toast、迁移提示、无主题不变量
npm run verify:package   # 发布清单（npm pack --dry-run）
npm run verify:peers     # peer 覆盖契约（已验证的运行时版本必须被 peer 段覆盖）
npm run verify:settings  # dsh-settings 代际投影断言（按能力探测，旧代报告跳过并以 0 退出）
npm run verify:host      # 构建 + 真宿主装配（devDependency 的 0.11.2）
npm run release:check    # build + verify + verify:package + verify:peers + verify:settings
```

改 `devDependencies` / `overrides` 后必须**删掉 `node_modules` 再全新安装**：宿主 tarball 内嵌的 `@dsh-std/*` 仍声明 `workspace:*`，增量安装会重读这些 manifest 并以 `EUNSUPPORTEDPROTOCOL` 失败（`npm install --no-package-lock` 也救不了）；全新解析时 npm 会跳过 tarball 内的 bundle 目录。安装过程本身会写出 `package-lock.json`，本仓不提交它，装完删掉即可。

## 指向其他宿主版本

`verify:host` 默认使用 devDependency 中的 dsh-TUI（当前 0.11.2）做零配置验证，不需要本地宿主源码检出。验证其它宿主时显式指向同一版本的 adapter；需要锁定版本时再设 `DSH_TUI_EXPECTED_VERSION`：

```sh
DSH_TUI_ADAPTER_DIR=/path/to/dsh-TUI/lib/types/dsh-adapter \
DSH_TUI_EXPECTED_VERSION=0.9.3 \
npm run verify:host
```

> 0.8 起 `verify:host` 只跑 `scripts/headless-order-test.mjs`（富状态行 / 设置卡片 / effect ledger 的真宿主装配）。两个主题专用脚本 `runtime-themes-headless.mjs`（运行时注册）与 `validate-themes-against-host.mjs`（主题键对宿主契约）已随主题一起删除，`DSH_TUI_SOURCE_ROOT` 不再被任何脚本使用。

`verify:settings` 按能力探测 `dsh-settings` 代际：devDependency 是 ≥ 0.1.7 时真跑投影断言；要验证另一代，把 `DSH_SETTINGS_DIR` 指向真机那份安装：

```sh
DSH_SETTINGS_DIR="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings" npm run verify:settings
```

CI 只覆盖 0.11.2 零配置线；0.9.x 兼容回归仍需本机按上面的 env 指向对应宿主 worktree。宿主基线（devDependency 与 CI 的 `DSH_TUI_EXPECTED_VERSION`）由 `verify:peers` 的断言守住：两边不一致时它直接失败。

## CI 门禁

`.github/workflows/ci.yml` 有两个并行档位，外加一个汇总门禁（branch protection 只需盯住 `ci-gate`）：

| 档位 | 内容 |
| --- | --- |
| `contract` | 免依赖、数秒完成：断言 `package-lock.json` 不存在；跑 `verify:package` |
| `verify` | 完整档：`npm install --include=dev` → `build` → `lib/` 无漂移 → `verify` → `verify:package` → `verify:peers` → `verify:settings` → `verify:host` |

## 内嵌调色板（`src/palette.ts`）

状态行富视图只用三个色值，且只在粉主题下着色：家族 `accent`（花符）、`inactiveShimmer`（时钟 / 轮数）、`subtle`（分隔符）。这三个值内嵌在 `src/palette.ts`，与宿主内置樱族（宿主 `src/theme.ts` 的 `pinkNightTheme` / `pinkDayTheme` / `pinkAnsiTheme`）逐键一致——插件不再读任何主题文件，宿主也没有向插件公开“当前调色板”的查询接缝，所以这是唯一来源。

维护方式：

1. 上游改了家族色值（或新增粉主题名）时，同步改 `src/palette.ts` 的表；
2. 若新增了主题名，同时更新 `src/themePref.ts` 的 `PINK_THEMES`；
3. `scripts/verify.mjs` 场景 8/15 钉住三套取值与非粉不上色，改完跑 `npm run verify`；
4. 想确认与宿主逐键一致：对宿主 worktree 跑 `node probes/compare-preset-palettes.mjs`（工作区级探针，见 `D:\dsh-tui-theme\probes\README.md`）。

## 迁移提示与标记文件（`src/legacyNotice.ts`）

- 检查 `~/.dsh-tui/themes/` 里是否存在插件当年装过的 `pink-*.json`；只认这三个文件名，用户自建主题永不被提及。
- 命中且标记文件 `~/.dsh-tui/theme-plugin-notice.json` 不存在 → 发一条中性 toast 并写标记；之后每次启动都保持安静。
- 标记记的是“已提示过”，与 toast 是否真的渲染无关：`tuiToast` 与内置樱族同在 0.10 线，缺接缝的宿主本来也不需要这条提示，而重复提示会变成打扰。
- 本地复测：删掉标记文件即可让提示重新出现；插件不会删除或修改被提到的主题文件。

## 可编辑面只有一个事实来源

`src/liveConfig.ts` 的 `LIVE_CONFIG_KEYS` 驱动 Config 的 volatile 标记，并与 `/settings` 卡片字段逐键相等（`npm run verify` 双向断言，`npm run verify:settings` 再对真宿主投影断言一次）。改配置项时，卡片字段、Config 与 README 的配置表要同步更新。

## 预发布版本的发布口径

- 版本形如 `0.8.0-pre.1`；npm 的 `latest` 仍指向带主题的 `0.7.3`，预发布必须显式指定版本或另打 dist-tag（例如 `npm publish --tag next`，用户装 `dsh-tui-theme@next`）。
- 发布链与正式版相同：`release:check` + `verify:host` 全绿 → bump → commit → tag → push → publish；区别只在 dist-tag 与 README 的安装命令。
- 0.7.x 线（带主题）继续留在 `latest`，直到宿主内置樱族随正式版发布、且本条目的 0.8 稳定版跟进为止。
