# dsh-tui-theme 🌸

[简体中文](README.md) | **English**

A sakura-pink theme plugin for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI): one package brings three pink themes, a blossom status line and a `/settings` section, all through official seams. No shortcuts, no commands, and it leaves nothing behind when uninstalled.

## What it does

| Feature | Seam | Notes |
| --- | --- | --- |
| **Three pink themes** | Theme runtime (dsh-TUI ≥ 0.10.0) / static assets (older hosts) | `pink-night`, `pink-day`, `pink-ansi` |
| **Cached background follow** | Settings + local cache | Optionally reuses an existing `theme-follow.json` result; never reads terminal input or sends OSC queries |
| **Blossom status line** | `tuiStatus` | One decorated line above the prompt: ✿ · clock · live turn count (pink themes only by default) |
| **Settings section** | `tuiSettingsSections` | An editable block in `/settings` (background-follow and status-line subpages); changes apply immediately |
| **Toasts** | `tuiToast` (≥ 0.10.0) | Background-follow results, theme-file self-repair, shadowing-file notices; silently skipped on older hosts |
| **Legacy file cleanup** | `tuiDialogs` (≥ 0.9.3) | A one-shot host confirmation dialog when shadowing theme files are detected; only byte-identical copies are removed |

**Deliberately out of scope**: no shortcuts, no command registration or override, no input interception, no session events, no system-prompt injection. `tuiDialogs` is a host-owned neutral confirmation panel — the host renders it and owns the keyboard, the plugin only submits a request — so it is not input interception.

## Quick start

```sh
# Install (published on npm)
dsh plugin --profile dsh-tui add -w dsh-tui-theme@latest
```

```sh
# Switch themes inside dsh-TUI
/theme              # picker: pink-night / pink-day / pink-ansi
/theme pink-night   # or switch directly (the plugin takes over once follow is on)
```

Local tarball install (development / personal use):

```sh
cd /path/to/dsh-tui-theme
npm run build
npm pack
dsh plugin --profile dsh-tui add -w ./dsh-tui-theme-<version>.tgz
```

> Do not install the source directory as a dependency: its development `node_modules` can resolve a different Cordis/DSH framework instance than the dsh-TUI host, and the plugin will fail to register its services.

Upgrading is the same command again: `dsh plugin --profile dsh-tui add -w dsh-tui-theme@latest`.

## Themes

| Theme | Base | Look |
| --- | --- | --- |
| `pink-night` | dark | Dark plum background, rose-pink accents; covers every host Theme key (73 semantic keys on 0.10.x, older names mapped by host aliases) |
| `pink-day` | light | Ivory-pink background, ink-plum text, soft rose accents (passes the host's light-identity check) |
| `pink-ansi` | dark-ansi | 16-colour ANSI fallback, brand colours mapped to the magenta family |

All three pass the official dsh-TUI validator (zero warnings, full key coverage) and WCAG contrast checks (body text ≥ 11:1).

### Screenshots

The main screen was captured on dsh-tui 0.9.2; the `/settings` card is from 0.9.3:

| `pink-day` | `pink-night` |
| :---: | :---: |
| ![pink-day theme](docs/screenshots/pink-day.png) | ![pink-night theme](docs/screenshots/pink-night.png) |

The pink-theme block in `/settings` (background / blossom glyph / clock / turns / status-line scope; saves apply immediately):

![pink-theme settings block](docs/screenshots/settings.png)

> The ❯ prompt and link colour in these shots are hardcoded by the host — see [Hardcoded by the host](#hardcoded-by-the-host-themes-cannot-cover).

## Configuration

Precedence: `/settings` user layer > `cordis.yml` config layer > built-in defaults. Open the **pink-theme** block in `/settings` (background-follow and status-line subpages):

| Field | Default | Notes |
| --- | --- | --- |
| `followSystem` | `false` | Apply the last saved terminal-background result at startup (day ↔ night); the plugin never refreshes the cache. When on, the field shows the cache state, e.g. `on (cache: light · 2026-09-12)` or `on (no cache, startup unchanged)` |
| `showGlyph` | `true` | Blossom glyph on/off (on = line starts with the glyph) |
| `statusGlyph` | `✿` | Glyph character: 1–2 display cells, control characters rejected, empty restores the default |
| `showClock` | `true` | Show an HH:MM clock |
| `showTurns` | `true` | Show the current session turn count (`N✦`, counted from this launch) |
| `statusSeparator` | `·` | Separator between segments; same validation as the glyph character |
| `statusScope` | `pink-only` | Where the status line shows: `pink-only` (pink themes) or `all-themes` |

Turning all three decorations (glyph / clock / turns) off hides the whole status line. Two profile-only switches live in `cordis.patch.yml` and never appear in `/settings`: `autoInstallThemes` and `statusEnabled`.

> This table *is* the plugin's editable surface: the card fields and `LIVE_CONFIG_KEYS` in `src/liveConfig.ts` match key for key, asserted both ways by `npm run verify`.

## Cached background follow

dsh-TUI exposes no plugin-safe terminal query seam. To avoid racing the host's stdin/raw-mode lifecycle, the plugin never sends OSC 11 and never reads terminal input — it only reuses a cache you already have (off by default):

- When enabled, startup reads an existing `light` result from `~/.dsh-tui/theme-follow.json`: light → `pink-day`, dark → `pink-night`, and writes the choice to `~/.dsh-tui/theme.json`;
- With no cache, your current `/theme` choice is kept exactly as is; the plugin never creates or refreshes the cache;
- Such a cache may be left over from an earlier compatible version; the plugin will only regain refresh capability once dsh-TUI ships a host-owned query seam;
- While enabled, the cache overrides the persisted `/theme` choice at startup; turning it off restores manual selection;
- The `DSH_TUI_THEME` environment variable always wins (host behaviour, the plugin never overrides it).

On dsh-TUI ≥ 0.10.0 the result arrives as a toast: when `theme.json` was actually rewritten it says “switched to … per the saved terminal background, `/reload` applies it now” (the current screen still shows the old theme until `/reload` or restart); enabling follow manually with no cache says so honestly. Nothing changes at the startup baseline, so it stays quiet instead of nagging on every launch.

## Toasts

Plugin logs are invisible to TUI users, so a few events worth knowing go through host toasts (the `tuiToast` seam on ≥ 0.10.0; output only, never intercepting input; older hosts fall back to plain logging):

| Event | Toast |
| --- | --- |
| Background follow rewrote the theme preference | ✿ switched to … per the saved terminal background, `/reload` applies it now |
| Follow enabled manually, cache matches the current theme | ✿ keeping … per the saved terminal background |
| Follow enabled manually but no cache exists | ✿ no saved terminal-background cache, keeping the current theme (warning colour) |
| A corrupted theme file was repaired | ✿ repaired the corrupted theme file: … (warning colour) |
| A legacy same-name file is byte-identical to the bundled copy | ✿ … is identical to the bundled copy; deleting it lets the colours follow the plugin |

The last row only ever concerns files byte-identical to the bundled copy — files you recoloured yourself are never mentioned or deleted. In the shadowing case, dsh-TUI ≥ 0.9.3 also shows a one-shot confirmation dialog: confirming removes the copies after the same byte-level check and reports back with a toast; declining or dismissing changes nothing.

## Theme files: install, self-repair, cleanup

- **Runtime hosts (≥ 0.10.0)**: the three themes register live through `ctx.tuiThemes`, so palettes follow the plugin and a normal mount writes nothing into your home directory. If the service arrives late, the plugin falls back to the static path and deletes the files it wrote this run once the runtime service confirms — but only if they are still unmodified.
- **Older hosts**: files are copied into `~/.dsh-tui/themes/` only when missing; a `pink-*.json` you edited is never overwritten.
- **Corrupted files are the one exception**: a file that cannot be parsed as JSON (say, a leftover from an interrupted install) is renamed to `<name>.corrupt-<timestamp>` to preserve the scene, the bundled copy is reinstalled, and the plugin logs a warning plus a toast.
- **Upgrading from an older host**: to switch to runtime-managed themes, back up and delete `~/.dsh-tui/themes/pink-{night,day,ansi}.json` yourself — the plugin never deletes user files. Leftovers byte-identical to the bundled copy get a one-shot notice and confirmation dialog.

## Hardcoded by the host (themes cannot cover)

These elements are hardcoded by dsh-TUI, read no theme key, and are out of reach for both theme JSON and plugin seams (first measured on 0.9.3, re-checked item by item on 0.11.0 and re-verified on 0.11.2; one item — header text colours — carries a corrected description). All of them need upstream dsh-TUI changes (for example: wire the charge colours and context-bar segments to theme keys, use `isLightThemeActive()` for empty segments, add theme keys for the prompt cursor); until then, every community theme package lives under the same constraints.

<details>
<summary>Show the full list (10 items, with host source locations)</summary>

| Element | Current state | Location (host source) |
| --- | --- | --- |
| Prompt ❯ glyph | No colour parameter in the default state (terminal default foreground, dimmed while the model works); the top reasoning-effort charge animation uses a hardcoded blue ramp (dark `#82B9FF` / light `#1E5FEB`) | `EffortChargeGlyph.tsx`, `trajectory/effortIgnition.ts` |
| Footer context-bar segment colours | The system / prompt / assistant / thinking / tools segments use a hardcoded navy→brand-blue ramp (`#22305F`→`#5A7CFF`) and never follow the theme | `screens/StatusMetrics.ts` |
| Progress-bar empty-segment colours | The host compares `themeName === 'light'` as a string — a custom light theme such as pink-day is not `'light'`, so it gets the darker empty segment | `screens/StatusLine.tsx` |
| Status-line text colour | On the legacy path the host renders scalar status lines colourless + terminal dim; since 0.10.1 the plugin uses the `tuiStatus.registerView` rich status view to colour by theme, and older hosts fall back to the scalar path | `screens/Chat.tsx`, `dsh-adapter/status.ts` |
| Prompt block cursor | The host hides the native terminal cursor and draws the prompt cursor as an inverse character, so its colour is the inverse of the theme's text/background; OSC 12 only colours the invisible native cursor (which becomes visible only with `CLAUDE_CODE_ACCESSIBILITY=1`) | `ink/components/App.tsx`, `components/PromptInput.tsx` |
| Body links | OSC 8 hyperlinks default to a hardcoded ANSI blue (`chalk.blue`); a comment notes wrap-ansi cannot preserve theme RGB across OSC 8, so link colour reads no theme key | `cc/hyperlink.ts` |
| Header pixel whale | Its palette is hardcoded and pre-rendered at module load; no theme can recolour the whale — four colours on 0.9.3 (outline/body/belly/mouth), six since 0.10.x (a heart and a sleep-Z state colour on top) | `components/Whale.tsx` |
| Header text colours | The ✦ wordmark and welcome line follow the theme (`claude`, `accent` since 0.10.1), and the wordmark's sweep **highlight follows the theme too** — `LogoV2` passes `theme.accentShimmer` (the 0.10.1 key name, `claudeShimmer` before it) to `sweep()` as the highlight colour, and all three bundled themes set it (visible only during the opening sweep and a `/deepseek` replay). The `DEEPSEEK`/`HARNESS` pixel words and the welcome line keep the constant `FLASH` as their sweep highlight, `HARNESS` still ends its gradient on the fixed constant `PALE`, and the remaining main/gradient-end colours follow `claude`/`claudeBlue_FOR_SYSTEM_SPINNER` (`accent`/`activity` since 0.10.1). Also: the host's `parseRGB` accepts only `rgb(r,g,b)`, so hex/ansi values silently fall back to the fixed brand blue (hence pink-ansi keeps a blue header) | `components/LogoV2.tsx`, `components/bigfont.ts`, `components/shimmer.ts`, `components/Spinner/spinnerUtils.ts` |
| Thinking-header pulse glyph | While the reasoning is still streaming, the spinner glyph at the head of the folded thinking header pulses between the constants `BRAND` and `ICE` (minimal mode drops the colour); only the label on the same row follows the theme (hover uses `text`, otherwise dim) | `components/messages/AssistantThinkingMessage.tsx`, `components/shimmer.ts` |
| Main-screen components and layout | Header whale, tool cards, prompt box and friends cannot be replaced or re-laid-out by plugins — a platform rule (built-ins win, no component-replacement seam); themes only reach the colour layer | Host architecture convention |

</details>

## Uninstall

```sh
# First switch to a non pink-* theme inside dsh-TUI
/theme auto

# Then remove the plugin and the optional local theme assets
dsh plugin --profile dsh-tui remove -w dsh-tui-theme
rm ~/.dsh-tui/themes/pink-{night,day,ansi}.json
rm ~/.dsh-tui/theme-follow.json
```

## Compatibility

- **Minimum dsh-TUI: 0.8.8** (status line and settings section; measured on 0.9.3). 0.10.0 and newer use runtime theme registration; 0.10.1 and newer colour the status line through the rich status view (older hosts fall back to the colourless scalar line); hosts without the `dsh-tui-extensions` surface degrade gracefully to “install the three themes only” without errors.
- **Both generations of `dsh-settings` are supported**: ≤ 0.1.6 (dsh-TUI 0.9.x/0.10.x) uses plugin-registered namespaces + `scope.watch`; ≥ 0.1.7 (dsh-TUI 0.11+) uses Config volatile-field projection + `loader/volatile-update` re-reads. The branch is chosen by capability probing, never by parsing versions, and failures on either path are logged rather than swallowed.
- **dsh runtimes from `0.2.0-rc.1` validate peers at startup**: the host reads each bundle's `peerDependencies`, compares every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` range against its own runtime version, and skips the whole bundle on a mismatch (stderr reports `skipping profile bundle`). This plugin's peer ranges cover `0.1.0-rc.6`–`0.1.x` and `0.2.0-rc.1`–`0.2.x` (since v0.7.3; the new generation is declared as `^0.2.0-rc.1`), so 0.2 hosts load it normally. The host always evaluates with `includePrerelease` semantics, which is why 0.2 prereleases pass there; npm's default prerelease semantics are narrower, so a future range like `0.2.1-rc.x` would report an unmet peer on the npm side (the framework packages ship with the dsh CLI and a profile never installs `@deepseek-ai/*`, so this has no practical effect).
- Node `^22.19 || >=24`, pure ESM, MIT.

## Development

```sh
npm install --include=dev   # this repo ships no lockfile, so --include=dev is required
npm run build
npm run verify
npm run verify:package
```

Install prerequisites, verification-script arguments (`verify:settings` / `verify:host`), CI gates and the palette workflow live in [docs/development_EN.md](docs/development_EN.md).
