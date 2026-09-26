# 开发与验证

**简体中文** | [English](development_EN.md)

本页收录 README 之外的开发细节：环境、安装前提、验证脚本参数、CI 门禁与调色板改动流程。

## 环境

- Node `^22.19 || >=24`，纯 ESM；TypeScript 编译到 `lib/types/`，构建产物随仓库提交，CI 会校验它与全新构建一致。
- 宿主基线：devDependency 钉住 `@deepseek-harness-tui/dsh-tui@0.10.1`；`dsh-settings` 仍是旧代（≤ 0.1.6），因此 `verify:settings` 在本仓默认跳过。

## 安装前提

下面两条会让普通 `npm install` 失败或静默不装依赖：

- **本仓有意不提交 `package-lock.json`。** devDependency 里的宿主 tarball 内嵌 `@dsh-std/*`，其包内 manifest 仍声明 `workspace:*`；提交的 lockfile 会被 npm 忠实重放，于是 `npm install` 与 `npm ci` 都报 `EUNSUPPORTEDPROTOCOL`。删掉 lockfile 后 npm 会直接跳过 tarball 内的 bundle 目录，安装正常。请勿把它提交回来（CI 的 `contract` 档会拦下）。
- **安装时不要带 `NODE_ENV=production`。** 该变量会让 npm 按 `omit=dev` 静默省略 devDependencies，表现为 `up to date` 但 `node_modules` 为空、随后 `tsc` 找不到依赖。所以显式写 `--include=dev`（CI 里另外固定 `NODE_ENV=development`）。

## 常用命令

```sh
npm install --include=dev
npm run build            # tsc → lib/types
npm run verify           # 插件契约、主题校验、卡片字段与可编辑面双向对拍
npm run verify:package   # 发布清单（npm pack --dry-run）
npm run verify:settings  # dsh-settings 代际投影断言（按能力探测，旧代跳过并以 0 退出）
npm run verify:host      # 构建 + 零配置宿主验证（0.10.1）
npm run release:check    # build + verify + verify:package + verify:settings
```

## 指向其他宿主版本

`verify:host` 默认使用 devDependency 中的 dsh-TUI（当前 0.10.1）做零配置验证，不需要本地宿主源码检出。验证旧版或发布基线时，显式指向同一版本的宿主 adapter 与源码；需要锁定版本时再设 `DSH_TUI_EXPECTED_VERSION`：

```sh
DSH_TUI_ADAPTER_DIR=/path/to/dsh-TUI/lib/types/dsh-adapter \
DSH_TUI_SOURCE_ROOT=/path/to/dsh-TUI-source \
DSH_TUI_EXPECTED_VERSION=0.9.3 \
npm run verify:host
```

`verify:settings` 同理：devDependency 的 `dsh-settings` 是旧代时脚本会明确报告跳过并以 0 退出；要真正验证 ≥ 0.1.7 的 Config 投影，把 `DSH_SETTINGS_DIR` 指向真机那份安装：

```sh
DSH_SETTINGS_DIR="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings" npm run verify:settings
```

CI 只覆盖 0.10.1 零配置线；0.9.x 兼容回归仍需本机按上面的 env 指向对应宿主 worktree。

## CI 门禁

`.github/workflows/ci.yml` 有两个并行档位，外加一个汇总门禁（branch protection 只需盯住 `ci-gate`）：

| 档位 | 内容 |
| --- | --- |
| `contract` | 免依赖、数秒完成：断言 `package-lock.json` 不存在；跑 `verify:package` |
| `verify` | 完整档：`npm install --include=dev` → `build` → `lib/` 无漂移 → `verify` → `verify:package` → `verify:settings` → `verify:host` |

## 改调色板

1. 编辑 `themes/*.json`；
2. `npm run verify`（官方校验器、对比度、全键覆盖）；
3. 删除 `~/.dsh-tui/themes/` 下对应文件，让插件重新安装——插件绝不覆盖已存在的文件。

## 可编辑面只有一个事实来源

`src/liveConfig.ts` 的 `LIVE_CONFIG_KEYS` 驱动 Config 的 volatile 标记，并与 `/settings` 卡片字段逐键相等（`npm run verify` 双向断言，`npm run verify:settings` 再对真宿主投影断言一次）。改配置项时，卡片字段、Config 与 README 的配置表要同步更新。设计依据见[决策记录](decisions/2026-09-26-settings-generation-adaptation.md)。
