# 决策：pink-day claude* 家族整体提亮一档（渐变结尾对比度接受 2.47）

- 日期：2026-09-12
- 状态：已采纳（Accepted-risk）
- 来源：提交 `bbc7ee7`；代码审查条目 L12（`REVIEW.md`）

## 背景

宿主 `parseRGB` 只接受 `rgb(r,g,b)`，hex 形式的 claude\* 键在顶栏像素字路径上会静默回退固定品牌蓝。`bbc7ee7` 将 pink-night / pink-day 的 claude\* 四键改为 rgb() 值；提交信息只记录了 `claude` 的提亮（对比度地板 3.0→2.5，"lighter sakura-day large-text identity"），pink-day 另外三键的值变更未在提交信息中列出，审查无法直接判定其意图。

## 变更事实

pink-day 四键沿既有粉色阶梯 `#D5517F → #DE6E96 → #E879A0 → #F2A0BF` 整体上移一档：

| 键 | 旧值 | 新值 |
| --- | --- | --- |
| `claude` | #D5517F | rgb(222,110,150)（#DE6E96，新设中间档） |
| `claudeShimmer` | #E879A0 | rgb(242,160,191)（#F2A0BF） |
| `claudeBlue_FOR_SYSTEM_SPINNER` | #D5517F | rgb(232,121,160)（#E879A0，即旧 claudeShimmer 档） |
| `claudeBlueShimmer_FOR_SYSTEM_SPINNER` | #E879A0 | rgb(242,160,191)（#F2A0BF） |

pink-night 同提交为纯格式转换，值不变（`claudeBlue == claude`、`claudeBlueShimmer == claudeShimmer` 的平色结构保持）。

## 判定与理由

判定为**有意的昼樱整体提亮**，非误改：

1. 四键沿同一条色阶一致上移，方向与提交信息为 `claude` 记录的 "lighter sakura-day identity" 完全一致；偶发误改不会产生这种连贯模式。
2. 新结构有明确设计语义：昼樱下 DEEPSEEK 像素字渐变从主色 #DE6E96 到结尾 #E879A0 读作向浅色 fade，与宿主自身 HARNESS 渐变以浅色常量 `PALE` 收尾的语言一致（见 README「顶栏文字色」条目）；shimmer 对统一为 #F2A0BF 则与 pink-night 的 shimmer 平色结构对齐。
3. 校验脚本中 `claude` 用例的注释（2.5 地板）与本次方向互证。

## 接受的风险

对 pink-day 终端背景 #F6F3ED 的实测对比度（WCAG 相对亮度比）：

- `claude` #DE6E96 = 2.80（守卫地板 2.5，通过）
- `claudeBlue_FOR_SYSTEM_SPINNER` #E879A0 = **2.47**，低于为 `claude` 采纳的 2.5 大字号地板 0.03
- `claudeShimmer` / `claudeBlueShimmer` #F2A0BF = 1.80（动画高光，不设数值地板）

接受理由：该键只用于 DEEPSEEK 像素字的装饰性渐变结尾段，同字主色仍由 2.5 地板守卫，正文可读性由 4.5 的 `text` 用例守卫；0.03 的差额在像素字尺寸下不可感知。

## 落地与守卫

- `scripts/validate-themes-against-host.mjs` 新增用例：`['pink-day', 'claudeBlue_FOR_SYSTEM_SPINNER', '#F6F3ED', 2.4]`（0.10.1 起经语义别名读 `activity`），防止后续继续提亮越过已接受点。
- 替代方案（恢复 `rgb(213,81,127)`）被否决：渐变结尾深于主色与昼樱提亮方向矛盾，且该值是旧 identity 色，与新家族并读不一致。

## 影响范围

仅 pink-day 顶栏 DEEPSEEK 像素字渐变结尾段的观感；无公共契约、接口或行为变更。pink-night / pink-ansi 不受影响。
