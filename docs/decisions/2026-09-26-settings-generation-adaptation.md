# 决策：dsh-settings 两代适配 —— Config volatile 投影 + 命名空间跟随 Loader 条目 id

- 日期：2026-09-26
- 状态：已采纳
- 来源：迁移清单（dsh-tui-find 仓的 `docs/decisions/2026-09-24-settings-generation-adaptation.md`，本决策是它在本仓的落地记录）；代码审查条目 T1–T3（工作区 `REVIEW.md`）

## 背景

**现象**：dsh-TUI 升到 0.11.0（`@deepseek-ai/dsh-settings@0.1.7-rc.1`、schemastery 3.18.4）后，`/settings` 里 **dsh-tui-theme 卡片右侧打上 `命名空间未注册` 徽标**，七个字段全部不可编辑。原实现（v0.7.1）在 `ctx.inject(['settings'])` 里调 `settings.register(PLUGIN_ID, schema)`：新代服务**没有** `register`，调用抛 `TypeError` 被 `catch {}` 静默吞掉 → 命名空间从未存在 → 徽标（`lib/types/settingsSection.js`）。

**根因**：`dsh-settings` 0.1.7 换代。旧代 `SettingsProvider` 由插件用 `register(ns, schema)` 自注册命名空间；新代 `SettingsForms` 改为：

- 命名空间 = **profile 条目 id**（本插件默认即 `dsh-tui-theme`，`cordis.patch.yml` 钉死）；
- 表单 schema = 插件 **Cordis `Config`** 里标了 volatile 的字段（`volatileForm(schema)`，投影侧只读 `meta.volatile` 这份普通数据）；
- `describe()` 只列 `volatileForm(Config)` 非空的条目；
- 写入经 `configEditor` 落进当前 profile 的补丁，loader 就地把 volatile 引用改值并以 `entry.fiber.ctx.emit(self, 'loader/volatile-update', paths)` 广播（`Context.filter` 只投给该条目自己的 fiber）；
- 自带卡片的插件用 `configure({ auto: false }, ctx.fiber)` 关掉自动生成页，`configure` 对同一 fiber 二次调用会 throw。

另有两条硬约束：`.volatile()` 直到 **schemastery 3.18.3** 才有（本仓基线 3.18.1/3.18.2 没有）；volatile 字段在 `apply` 期是**引用不是值**（`Schema.resolve` 用 `createVolatile()` 包一层）。

## 决策（本仓落地）

1. **双路径按能力分支，永不解析版本号**：`typeof settings.register === 'function'` → 旧代（注册命名空间 + `scope.watch`）；否则视为新代（`configure({ auto: false }, ctx.fiber)` + 读活配置 + 订阅 `loader/volatile-update`）；两者皆无则 `info` 说明卡片本会话不可用。
2. **可编辑集合只有一个事实来源**：`src/liveConfig.ts` 的 `LIVE_CONFIG_KEYS` 驱动 `Config` 的 volatile 标记（`src/index.ts` 的 `configFields` + `liveField`），卡片字段与它**双向对拍**（`npm run verify` 断言，`npm run verify:settings` 再对真宿主投影断言一次）。
3. **`liveField` 两级能力探测**：先 `.volatile()`（3.18.3+，走框架自带校验），没有就把 `meta.volatile` 直接写 true（照抄 dsh-TUI #990 给自家 Config 的修法）；`meta` 被冻结时安静退化为不标记。
4. **命名空间取 Loader 条目 id**（`resolveSettingsNamespace`）：新代 `describe()` 直接以 `entry.options.id` 当 ns 且不校验，而插件自有分区在 `tuiSettingsSections.register()` 里仍受 `^[a-z][a-z0-9_-]*$` 约束——entry id 合法时以它为准，否则回落 `PLUGIN_ID` 并 warn；两代共用同一串，卡片、旧代注册与宿主投影不可能互相错位。
5. **apply 期 config 一律先解包**：`readConfigValues` 逐键解引用，判定按 **cosmokit 的 Volatile 协议**（`Symbol.for('cosmokit.volatile.write') in value`），`{ get }` 单键形状只作兜底。`apply` 里构造 `cordis` 层与 `readLive()` 探针都走它，杜绝把 ref 当字符串/布尔用（形状判定在 ref 多带一个普通键时就静默失效）。
6. **失败不再静默**：旧代注册失败 warn（原为裸 `catch {}`，正是这次「无日志可查」的来源）；新代下 entry id 不可用、或一个 live 字段都没有（`hasLiveConfigFields`）时各给一条可诊断的 warn；缺 `loader/volatile-update` 时 `info` 说明「改动下次加载才生效」。
7. **新增代际验证入口**：`npm run verify:settings`（`scripts/verify-settings-generation.mjs`）——对真实安装的 dsh-settings 判定世代；≥0.1.7 时用**真实的** `volatileForm`/`projectForm`/`isVolatilePath` 对构建产物 `lib/types/` 跑 20 条投影断言，旧代明确报告「无需验证」并以 0 退出（CI 安全，已挂进 CI verify 档与 `release:check`）。
8. **`settings.register` 必须按方法调用**（`settings.register?.(...)`，可选调用保留 receiver）：真 provider 的 `register()` 读自身状态，摘成局部变量再调用会丢 `this` 抛错——这条由 `verify:host` 的真实 provider 相位咬出，已补进 `scripts/verify.mjs` 的假服务（`this === undefined` 即抛）作为回归。

## 本仓特有的取舍

- **可编辑面 = 7 键**：`followSystem` / `showGlyph` / `statusGlyph` / `showClock` / `showTurns` / `statusSeparator` / `statusScope`，与卡片字段逐一对应。`autoInstallThemes` / `statusEnabled` **有意不标 live**：它们是仅 profile 层的开关（README 已写明不出现在 /settings），标了反而会出现「可编辑但无 UI」的错位。
- 新代下 setter 的取值来自插件自己的行配置，因此首帧 `onDoc` 携带的是**全量已解析配置**（含 schema 默认值），与旧代「只有用户层」的形状不同；`index.ts` 的 `{ ...cordis, ...doc }` 合并对两者都成立，`followActive` 的基线语义不变。
- `configure` 的 owner 必须是 **Config 所属的插件 fiber**（`apply` 的 `ctx.fiber`），`loader/volatile-update` 也注册在插件自身 context 上（loader 只投给被更新条目的 fiber）；两者都挂在 inject 子 ctx 的 effect 上做清理。

## 替代方案

- **抬高 peer 下限到 ≥0.1.7、只支持新代**：把 0.9.x/0.10.x 用户挡在门外，与既有双宿主兼容策略冲突——否决。
- **放弃卡片、让新代自动生成页面**（不调 `configure`）：字段标签/分组/中英文案/hint 全丢，且与已注册的卡片重复——否决。
- **逐字段手写 `.volatile()`、不设 `LIVE_CONFIG_KEYS`**：卡片与 schema 的对应关系无人守，漂移即静默死卡——否决。
- **只探测 `.volatile()`、不做 meta 兜底**：3.18.1/3.18.2 上标记静默失效，整套设置页变死（#990 的病根）——否决。
- **按 #991 的方式在标记失败时启动即报错**：第三方插件会把 TUI 启动一起带走——改为 warn + 验证脚本兜底。

## 影响

- 收益：dsh-TUI 0.11/新代设置服务下卡片恢复可编辑、保存即生效；0.9.x/0.10.x 行为不变；三类静默失败（注册被吞、标记失效、命名空间错位）各自有 warn、脚本与测试兜底。
- 成本：新增 `src/liveConfig.ts`；`settingsSection.ts` 多一条世代分支；`verify.mjs` 多 3 个场景；多一个代际脚本随包分发。
- 风险：
  - 宿主 `loader/volatile-update` 语义再变 → 症状是「保存后不生效」，`verify:settings` 的重读断言会先红。
  - schemastery 未来把 `.volatile()` 改名 **且** 冻结 `meta` → 标记彻底失效，`verify:settings` 的「live 标记存在」断言会红。
  - 直接写 `meta.volatile` 绕过框架的 volatile 校验；本仓只在**扁平** Config（标的是叶子）上用它。
  - 旧代下给插件行改过 id 的用户，`settings.yaml` 里旧 `dsh-tui-theme` 一节不再生效（键跟随新 id）；默认安装 id 不变，且新代本来就以 entry id 为身份——接受并在此记录。
- 真机确认（2026-09-26）：`verify:settings` 对真机 `0.1.7-rc.1` + schemastery 3.18.4 的 20 条断言全绿；构建产物已装进本机 `dsh-tui` profile（原 0.7.1 目录整目录备份、profile 依赖声明未改），`dsh --profile dsh-tui --dump-config` 条目 id 与卡片 `ns` 一致；`/settings` 卡片徽标的肉眼复核是最后一步（见 `REVIEW.md` T4）。

## 关联

- 迁移清单与上游动向：dsh-tui-find `docs/decisions/2026-09-24-settings-generation-adaptation.md`（含 dsh-TUI [#990](https://github.com/ccch1mneyyy/dsh-TUI/issues/990) / [PR #991](https://github.com/ccch1mneyyy/dsh-TUI/pull/991)）
- 相关代码：`src/liveConfig.ts`、`src/settingsSection.ts`、`src/index.ts`
- 相关脚本：`scripts/verify-settings-generation.mjs`（`npm run verify:settings`）、`scripts/verify.mjs` 场景 2d/2e/2f
