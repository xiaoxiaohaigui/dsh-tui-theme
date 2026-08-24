# dsh-tui-theme 代码评审问题清单

> 评审日期：2026-08（仓库状态：v0.3.1，`521a6e6`）
> 评审方法：源码通读 + `npm run build`（零错误）+ `npm run verify`（8/8 通过）+ 边界推演 + git 产物核对。
> 本文只收录**较重要的问题**（可直接处理）；低优先级项见文末附录。
> 处理完请在对应条目打勾并记录处理方式，方便追溯。
>
> **2026-08-24 处理结果**：M1 / M2 / M4 / M5 属实，已修复并有测试覆盖；M3 经宿主源码核验为安全（保留去重守卫消掉残留项）；附录 L4 / L5 / L6 顺手修复。验证：`npm run verify` 10 项 + 两个回归脚本全绿。

---

## ✅ M1. 跟随检测窗口会吞掉用户按键（已修复）

- **位置**：`src/autoTheme.ts:141-188`（`refreshDetectedBackground`）
- **严重度**：中（体验 / 输入完整性）
- **问题**：检测终端背景时，以 raw 模式给 `stdin` 挂 `'data'` 监听等待 OSC 11 应答，最多 400ms。该窗口内（宿主输入解析尚未挂载）用户敲下的按键会被 `onData` 消费进 buffer，因不匹配应答正则而被**静默丢弃**——不重放、不转发。
- **触发条件**：`followSystem` 开启（本部署默认开启）时的每次启动，用户恰好在该窗口内输入。
- **核实**：属实。窗口内非应答字节只留在本地 `buffer`，`finish` 直接丢弃。宿主 ink 用 `'readable'` pull 模式消费输入（`ink/ink.tsx`），插件检测先于宿主输入泵挂载，窗口内按键确实无人接手。
- **修复**（候选方案 1 + 宿主同款哨兵的合并）：
  1. **字节重放**：`finish` 把窗口内全部缓冲字节（匹配段之外）经 `stdin.unshift()` 退回流内部缓冲——宿主挂载后的 `read()` pump 会取走；`unshift` 不可用时降级 `emit('data')`。latin1 往返字节无损。
  2. **DA1 哨兵早停**：照搬宿主 `terminal-querier.ts` 的做法——查询串追加 `ESC[c`（DA1），DA1 应答先于 OSC 11 应答到达即证明终端不支持/忽略 OSC 11，立即关窗，不再等满 400ms。
- **验证**：verify 场景 5 扩充——窗口内注入按键断言经 `unshift` 完整回放；DA1 先到断言早停且不写文件。

---

## ✅ M2. 关闭 follow 与在途检测存在竞态（已修复）

- **位置**：`src/index.ts:119-126` + `src/autoTheme.ts:154-172`（`finish`）
- **严重度**：中（语义违背，测试未覆盖）
- **问题**：`runFollowSystem` 启动后不可中止；若在 ≤400ms 检测窗口内用户在 `/settings` 关闭 `followSystem`，`finish()` 仍会执行 `writeThemePref`，用检测结果覆写 pref——违背 README 与 verify 场景 7 承诺的"off = pref preserved"。
- **说明**：现有 verify 场景 7 用 stub 上下文，刷新流程根本不会启动，因此**没有覆盖在途刷新被关闭打断的情形**——这是测试盲区。
- **核实**：属实。`finish` 无条件写 pref；且 `index.ts` 回调里关闭分支只记日志、无法中止在途检测。
- **修复**：采用候选方案 2 的回调查询变体——`refreshDetectedBackground` 增加 `isActive: () => boolean` 门控参数，`finish` 写盘前重查；`runFollowSystem` 透传；`index.ts` 传入 `() => followActive === true`。不引入中止句柄（定时器与监听器照旧在 `finish` 内清理）。
- **验证**：verify 场景 5 新增子用例——应答到达前翻 `active = false`，断言 `theme.json` / `theme-follow.json` 均不写；翻回 `true` 后断言写入恢复。

---

## ✅ M3. `status.set` 的旧 disposer 从不调用（已对照宿主源码核验：安全，残留项已消除）

- **位置**：`src/statusLine.ts:123`（`dispose = status.set(...) ?? dispose`）
- **严重度**：~~中~~ → **低（已核验）**
- **核验结论（2026-08，宿主 ccch1mneyyy/dsh-TUI @ main，v0.9.0）**：
  - 宿主 `src/dsh-adapter/status.ts` 的 `TuiStatusStore` 是**按 key 替换的 Map**（`entries.set(key, ...)`），同 key 重设不会累积贡献、不会多行渲染；文本相同还会去重（adopt token，不 re-emit，不触发重渲染）。
  - 每次 `set` 返回的 disposer 由 `clearIf(key, token, owner)` **token 守卫**：任何旧 disposer（含插件里被覆盖丢弃的那些）在真正清理时都会因 token 不匹配而 no-op，绝不可能误删新写入。
  - 残留影响仅为：每次 render 的 set 都会向 caller 的 effect 绑定一个最终 no-op 的 disposer 并在 `tuiEffectLedger` 记一条 'replace'（`src/dsh-adapter/status.ts:210-232`、`host-access.ts:412-443`）——按分钟/轮次级别累计，体量极小，随激活销毁统一清理。
- **结论**：插件的重复 set 模式与宿主契约兼容，**无需修改**；若在意 ledger 增长，可在 render 中文本未变时跳过 set（宿主已替你做了这件事）。
- **处理**：采纳核验建议的 `lastText` 去重守卫——`statusLine.ts` 的 `render` 在文本未变时直接返回，不调 `set()`。ledger 残留与无谓的身份校验一并消除，渲染输出不变。
- **验证**：verify 场景 2/6/8 复跑全绿（各断言对应的渲染文本都发生变化，守卫不改变可观察输出）。

---

## ✅ M4. 设置服务注册路径无异常防护（已修复）

- **位置**：`src/settingsSection.ts:59-70`（`settings.register` / `scope.get`）对比 `:88-100`（`sections.register` 有 try/catch + `logger.warn`）
- **严重度**：中（健壮性 / 纪律一致性）
- **问题**：热重载重复注册或更严格的宿主在 `settings.register` / `scope.get()` 抛错时，inject 回调异常会向上传播；而同一文件里 sections 路径已做了完整防护。违背文件头自述的 #183 纪律。
- **核实**：属实，两条注入路径防护不对称。
- **修复**：`settings.register` + `scope.get` + `scope.watch` 整体包进与 sections 相同的 try/catch + `logger.warn`（文案 "settings namespace registration failed"），与 #183 纪律对齐。
- **验证**：verify 新增场景 9——stub `settings.register` 抛错，断言不抛出、只记一条 warning。

---

## ✅ M5. 150ms 兜底定时器无生命周期管理（已修复）

- **位置**：`src/index.ts:133-138`（`setTimeout(..., FOLLOW_FALLBACK_MS)`）
- **严重度**：中低（资源/热重载卫生）
- **问题**：定时器不随插件 dispose 清理（热重载后仍可能触发 `runFollowSystem` 写文件），也未 `unref()`。
- **核实**：属实。
- **修复**：按候选方案执行——`fallbackTimer.unref?.()` + `ctx.effect(() => () => clearTimeout(fallbackTimer))`。
- **验证**：verify 新增场景 10——无 settings 服务 + `followSystem: true`，apply 后立即跑全部 disposer，等 250ms（>150ms 兜底），断言无任何 `follow:` 日志。

---

## 附录 A：低优先级项处理情况

| # | 位置 | 说明 | 处理 |
|---|---|---|---|
| L1 | `scripts/verify.mjs` | 缺 `channel8` 1/2 位分支测试（人工核对数学正确：`f/ff/fff/ffff→255`、`8000→128`）；OSC 应答 BEL 终止分支（`\x07`）未测 | 部分：场景 5 的按键回放子用例现用 `\x07` 终止，BEL 分支已覆盖；`channel8` 分支测试未加 |
| L2 | `src/themeAssets.ts:58` | `readdirSync` 失败时 `failed` 放入目录路径而非文件名，`index.ts:95` 日志措辞误导 | 未处理（极低概率路径，日志措辞问题） |
| L3 | `src/themeAssets.ts:27-29` | 家目录三源全空时返回 `''`，`join('', ...)` 退化为相对 CWD 写入 | 未处理（与宿主 `homeDir()` 同源行为，保持一致优先） |
| L4 | 仓库根 | 缺 `.gitattributes`：`core.autocrlf=true` 下 build 后 `lib/` 6 文件全量显示 modified（实测为纯行尾噪音，`git diff --numstat` 为空） | ✅ 已修：新增 `.gitattributes`（`* text=auto` + 图片 binary）并 `git add --renormalize`，build 后不再出现行尾噪音 |
| L5 | `README.md:111-112` | 开发小节写 `pnpm`，仓库实际是 npm（package-lock.json），且无 `packageManager` 字段 | ✅ 已修：改为 `npm install && npm run build` |
| L6 | `package.json` | `verify` 直接 import `lib/` 不先构建；建议 `"pretest": "npm run build"` 防陈旧产物假阴假阳 | ✅ 已修：新增 `"preverify": "npm run build"`（npm 生命周期钩，对应 `verify` 脚本名） |
| L7 | `src/autoTheme.ts:35-38` | `FollowCache.at` 写入后从未读取（dead field） | 未处理（缓存文件的诊断痕迹，保留可读性） |
| L8 | `src/statusLine.ts:104-127` | 每次 render 同步读 `~/.dsh-tui/theme.json`（主线程同步 IO）；时钟节拍 15s 可放宽到 60s | 未处理（单文件小 JSON、15s 一次，实测无感；M3 守卫已削减无变化的读后动作） |
| L9 | `scripts/verify.mjs:46-98` | stub `inject` 不支持迟到服务注册，M2/M5 路径（兜底定时器、在途刷新）在测试射程之外 | 部分解决：M2/M5 路径已分别由场景 5（直调 `refreshDetectedBackground`）与场景 10 覆盖；迟到注册场景仍未测 |

## 附录 B：处理顺序（实际执行记录）

实际按 M1+M2（同在 `autoTheme.ts`，一次改完）→ M4 → M5 → M3（先查宿主契约定性，再只取去重守卫）→ L4/L5/L6 的顺序处理。全部改动一次提交（本地，未推送）；`npm run verify` 10 项全绿，两个回归脚本（`headless-order-test.mjs`、`validate-themes-against-host.mjs`，后者需 `npx tsx` 运行）与加载冒烟全绿。
