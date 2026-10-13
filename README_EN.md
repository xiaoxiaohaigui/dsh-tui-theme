# dsh-tui-theme 🌸

[简体中文](README.md) | **English**

A blossom status line for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI): one `✿ · clock · turns` line above the prompt, an editable `/settings` block, and a one-shot migration notice — all through official seams, with no shortcuts and no commands.

> **Since 0.8 this package ships no themes.** The sakura-pink family (`pink-night` / `pink-day` / `pink-ansi`) has moved upstream: PR [#1294](https://github.com/ccch1mneyyy/dsh-TUI/pull/1294) merged into dsh-TUI's main line on 2026-10-12 (merge `4f4980fe`) and **ships as a built-in dsh-TUI preset since dsh-TUI 0.15.0**, with its palettes and theme keys maintained there; this package keeps only the non-theme garnish, so it can no longer compete with the built-ins over names, files, or palettes. Below dsh-TUI 0.15.0 a pink theme name can only come from the theme files a 0.7.x install left behind (see *Migration notes*), so a fresh install there cannot obtain one — stay on `dsh-tui-theme@0.7.5` if you want the themes themselves.

## What changed in 0.8 (read before upgrading)

| 0.7.x feature | State in 0.8 |
| --- | --- |
| Three pink themes (runtime registration / static install) | **Removed.** Once the host ships the same names, built-ins outrank any same-named `~/.dsh-tui/themes/*.json` |
| Cached background follow (`followSystem`) | **Removed** (it only existed to switch between day and night pink) |
| Shadowed theme-file detection + cleanup dialog | **Removed**; a one-shot toast replaces it (below) |
| Blossom status line (rich view colours included) | **Kept**, now coloured from a family palette embedded in the package (`src/palette.ts`) |
| The **dsh-tui-theme** block in `/settings` (named `pink-theme` on 0.7.x) | **Kept**, reduced to the status-line group |
| Toast channel | **Kept**, for the migration notice above |

Migration notes:

- The plugin no longer writes into `~/.dsh-tui`. The single exception is the notice marker `theme-plugin-notice.json`, written once — when leftover theme files are found *and* the notice actually reached the host. The plugin only **reads** the host's `theme.json` to resolve the active theme.
- Files a 0.7.x install left behind (`~/.dsh-tui/themes/pink-*.json`) are never deleted. **On a host that ships the built-in family** (dsh-TUI ≥ 0.15.0) they no longer take effect (built-ins outrank same-named files); **a host below 0.15.0** still parses them as static themes, so an upgrade from 0.7.x keeps working as before.
- If you hand-tuned one of those files: **the field to change is the JSON `name`** (the host dedupes on it; the file name is just a label). Renaming `pink-night.json` to `my-pink.json` while `name` stays `pink-night` changes nothing — the theme never shows up in `/theme`, and selecting `pink-night` still yields the built-in palette (measured). Change `name` to a non-pink name (changing `displayName` and the file name to `my-pink` too is tidier), then pick it in the host's `/theme`: that is what makes the built-in step aside. Note the status-line scope `statusScope` defaults to `pink-only`, which matches the three `pink-*` names only; after the name change, switch **Status line display** to **All themes** in `/settings`, or the status line disappears.
- When leftover theme files are found the plugin sends one neutral toast; the marker is written **only once that toast reaches the host**, after which the plugin stays quiet. A host without the toast seam (< 0.10) shows nothing: that boot retries silently and the next one tries again — no nagging, no giving up — so the notice appears exactly once when the host is upgraded. The files themselves are never touched.
- `~/.dsh-tui/theme-follow.json` is read by nobody now and can be deleted.

## What it does

| Feature | Seam | Notes |
| --- | --- | --- |
| **Blossom status line** | `tuiStatus` | One decorated line above the prompt: ✿ · clock · live turn count; pink themes only by default |
| **Rich status view** | `tuiStatus.registerView` (≥ 0.10.1) | A one-row React view coloured from the embedded family palette; older hosts fall back to the colourless scalar line |
| **Settings section** | `tuiSettingsSections` | An editable block in `/settings` (glyph / glyph character / clock / turns / separator / scope); changes apply immediately |
| **Migration notice** | `tuiToast` (≥ 0.10.0) | A toast about leftover ≤0.7.x `pink-*.json` files, never repeated once delivered; hosts without the seam retry silently |

**Deliberately out of scope**: no shortcuts, no command registration or override, no input interception, no session events, no system-prompt injection, no theme files installed or registered.

## Quick start

```sh
# 0.8 is not published yet (npm @latest is the theme-carrying 0.7.5). Once it is, a prerelease needs the explicit version:
# dsh plugin --profile dsh-tui add -w dsh-tui-theme@0.8.0-pre.2
```

Local tarball install (development / personal use):

```sh
cd /path/to/dsh-tui-theme
npm run build
npm pack
dsh plugin --profile dsh-tui add -w ./dsh-tui-theme-0.8.0-pre.2.tgz
```

> Do not install the source directory as a dependency: its development `node_modules` can resolve a different Cordis/DSH framework instance than the dsh-TUI host, and the plugin will fail to register its services.

Once installed, the line only appears under a sakura-pink theme. To see it under every theme, switch “Status line display” to “All themes” in `/settings` (it renders uncoloured there).

## Configuration

Precedence: `/settings` user layer > `cordis.yml` config layer > built-in defaults. Open the **dsh-tui-theme** block in `/settings`:

| Field | Default | Notes |
| --- | --- | --- |
| `showGlyph` | `true` | Blossom glyph on/off (on = line starts with the glyph) |
| `statusGlyph` | `✿` | Glyph character: 1–2 display cells, control characters rejected, empty restores the default |
| `showClock` | `true` | Show an HH:MM clock |
| `showTurns` | `true` | Show the current session turn count (`N✦`, counted from this launch) |
| `statusSeparator` | `·` | Separator between segments; same validation as the glyph character |
| `statusScope` | `pink-only` | Where the status line shows: `pink-only` (built-in pink themes) or `all-themes` (uncoloured outside pink) |

Turning all three decorations (glyph / clock / turns) off hides the whole line. One profile-only switch lives in `cordis.patch.yml` and never appears in `/settings`: `statusEnabled`.

> This table *is* the plugin's editable surface: the card fields and `LIVE_CONFIG_KEYS` in `src/liveConfig.ts` match key for key, asserted both ways by `npm run verify`.

### Screenshot

The status-line group of the 0.7.x card in `/settings` (captured on dsh-TUI 0.14.0 + plugin v0.7.5): the `pink-theme` in the title is the 0.7.x card name (since 0.8 it is **dsh-tui-theme**); the six rows here match the 0.8 card, while 0.7.x's *background follow* group (`followSystem`) is removed wholesale in 0.8 — which is why the 0.8 card has this single group.

![dsh-tui-theme settings block](docs/screenshots/settings.png)

## Migration notice (toast)

Plugin logs are invisible to TUI users, so the one event worth knowing goes through a host toast (the `tuiToast` seam on ≥ 0.10.0; output only, never intercepting input; older hosts stay silent):

| Event | Toast |
| --- | --- |
| Leftover ≤0.7.x `pink-*.json` found | ✿ found legacy theme files …: where dsh-TUI ships the same pink built-ins they outrank the file; if you recoloured one, change its `name` field and set **Status line display** to **All themes** (`pink-only` only matches `pink-*`) |

The marker is recorded once the notice has **actually reached the host** (in `~/.dsh-tui/theme-plugin-notice.json`). A host without the toast seam (< 0.10) retries silently on every boot — no nagging — and the notice shows up once when the host is upgraded, never again afterwards. It only ever names the three files the plugin used to install — a theme you created yourself is never mentioned. The plugin neither deletes nor edits those files.

## How the status line relates to themes

- The line is **garnish**: the host owns rendering, clipping and sanitizing; the plugin submits scalar text or one component.
- **Visibility** follows the host's own precedence: the `DSH_TUI_THEME` environment variable over `~/.dsh-tui/theme.json` (0.14.0 adds a brand default tier that can outrank `theme.json` — see Compatibility). The plugin therefore knows the active theme *name* only, never a palette; the `pink-only` test is exactly those three built-in names.
- **Colours** come from three values embedded in `src/palette.ts` (the family's `accent` / `inactiveShimmer` / `subtle`, key-for-key identical to the host's built-ins). dsh-TUI exposes no palette-query seam to plugins (the runtime theme service accepts registrations only and reports nothing back), so this is the plugin's single colour source; non-pink themes stay uncoloured.
- **On older hosts the host renders scalar status text colourless + terminal dim** — outside the plugin's control; the rich view (≥ 0.10.1) exists precisely to get around that.
- The plugin installs, registers and repairs no theme files, and never rewrites `theme.json` (that is the host's user preference).

## Uninstall

```sh
# Remove the plugin
dsh plugin --profile dsh-tui remove -w dsh-tui-theme
```

### Clearing the old theme files (before or after uninstalling)

`~/.dsh-tui/themes/pink-*.json` is host user data: **this plugin never deletes it** (since 0.8 it only sends the one-shot notice and never rewrites those files), and uninstalling leaves it alone too. Once the host ships the built-in family those three files stop taking effect and are dead weight — and the host says nothing about it today, so cleaning up is manual:

```sh
# POSIX: only after checking you have no hand-tuned palette to keep
# (keep one by changing its `name` first, see Migration notes)
rm ~/.dsh-tui/themes/pink-{night,day,ansi}.json
rm ~/.dsh-tui/theme-follow.json
rm ~/.dsh-tui/theme-plugin-notice.json
```

```powershell
# PowerShell (Windows): same, delete only the files you mean to
Remove-Item "$env:USERPROFILE\.dsh-tui\themes\pink-night.json",
            "$env:USERPROFILE\.dsh-tui\themes\pink-day.json",
            "$env:USERPROFILE\.dsh-tui\themes\pink-ansi.json"
Remove-Item "$env:USERPROFILE\.dsh-tui\theme-follow.json" -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.dsh-tui\theme-plugin-notice.json" -ErrorAction SilentlyContinue
```

`theme-follow.json` (the 0.7.x background-follow cache) and `theme-plugin-notice.json` (this plugin's notice marker) are not themes; deleting them only drops a little history. **Do not delete `theme.json`** — that is the host's record of your current theme.

## Compatibility

- **Minimum dsh-TUI: 0.8.8** (status line and settings section; measured on 0.9.3). Since 0.10.1 the status line colours itself through the rich status view, and older hosts fall back to the colourless scalar line; hosts without the `dsh-tui-extensions` surface degrade silently instead of erroring.
- **The themes come from the host**: `pink-night` / `pink-day` / `pink-ansi` are built into dsh-TUI since 0.15.0 (upstream PR #1294 maintains their palettes and theme keys); this package no longer carries them. **The `pink-only` test is a theme *name*, never a host capability check**: the three names come from `DSH_TUI_THEME` or `~/.dsh-tui/theme.json` — on a ≥ 0.15.0 host they match the built-ins by construction. **Below 0.15.0**: an upgrade from 0.7.x that still has `~/.dsh-tui/themes/pink-*.json` keeps showing the line, because that host still parses those files as static themes. Only a fresh install — host below 0.15.0 *and* without those files — cannot obtain a pink theme name, and there the line stays hidden under `pink-only`; use `statusScope: all-themes`, or stay on `dsh-tui-theme@0.7.5` for the themes themselves.
- **dsh-TUI 0.14.0 adds a brand default tier that can outrank `theme.json`**: with no explicit `theme` prop and no `DSH_TUI_THEME`, the host picks by brand (`DSH_TUI_BRAND` / the `dsh-tui.brand` setting) — `claude-dark`/`claude-paper` for claude, `codex-lavender`/`codex-paper` for codex — and deliberately leaves `theme.json` unlocked. The host then renders the brand theme while the plugin still judges by the name in `theme.json`: if that is still `pink-*`, the ✿ line keeps showing and stays pink-coloured, out of step with what the host actually renders — a cosmetic mismatch, never a crash. The default brand `deepseek` is not in that table and the plugin reads no brand setting: an accepted divergence.
- **Both generations of `dsh-settings` are supported**: ≤ 0.1.6 (dsh-TUI 0.9.x/0.10.x) uses plugin-registered namespaces + `scope.watch`; ≥ 0.1.7 (dsh-TUI 0.11+) uses Config volatile-field projection + `loader/volatile-update` re-reads. The branch is chosen by capability probing, never by parsing versions, and failures on either path are logged rather than swallowed.
- **dsh runtimes from `0.2.0-rc.1` validate peers at startup**: the host reads each bundle's `peerDependencies`, compares every `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` range against its own runtime version, and skips the whole bundle on a mismatch (stderr reports `skipping profile bundle`). This plugin's peer ranges cover `0.1.0-rc.6`–`0.1.x` and `0.2.0-rc.1`–`0.2.x` (since v0.7.3; the new generation is declared as `^0.2.0-rc.1`), so 0.2 hosts load it normally. The host always evaluates with `includePrerelease` semantics, which is why 0.2 prereleases pass there.
- Node `^22.19 || >=24`, pure ESM, MIT.

## Development

```sh
npm install --include=dev   # this repo ships no lockfile, so --include=dev is required
npm run build
npm run verify
npm run verify:package
```

Install prerequisites, verification-script arguments (`verify:settings` / `verify:host`), CI gates and how to maintain the embedded palette live in [docs/development_EN.md](docs/development_EN.md).
