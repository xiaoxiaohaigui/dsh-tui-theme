# dsh-tui-theme 🌸

[简体中文](README.md) | **English**

A blossom status line for [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI): one `✿ · clock · turns` line above the prompt, an editable `/settings` block, and a one-shot migration notice — all through official seams, with no shortcuts and no commands.

> **Since 0.8 this package ships no themes.** The sakura-pink family (`pink-night` / `pink-day` / `pink-ansi`) is a **built-in dsh-TUI preset** now, with its palettes and theme keys maintained upstream; this package keeps only the non-theme garnish, so it can no longer compete with the built-ins over names, files, or palettes. Users on older hosts (no built-in pink family) who still want the 0.7.x themes should stay on `dsh-tui-theme@0.7.3`.

## What changed in 0.8 (read before upgrading)

| 0.7.x feature | State in 0.8 |
| --- | --- |
| Three pink themes (runtime registration / static install) | **Removed.** The host ships the same names, and built-ins outrank any same-named `~/.dsh-tui/themes/*.json` |
| Cached background follow (`followSystem`) | **Removed** (it only existed to switch between day and night pink) |
| Shadowed theme-file detection + cleanup dialog | **Removed**; a one-shot toast replaces it (below) |
| Blossom status line (rich view colours included) | **Kept**, now coloured from a family palette embedded in the package (`src/palette.ts`) |
| The pink-theme block in `/settings` | **Kept**, reduced to the status-line group |
| Toast channel | **Kept**, for the migration notice above |

Migration notes:

- The plugin no longer writes into `~/.dsh-tui`. The single exception is the notice marker `theme-plugin-notice.json`, written once and only when leftover theme files are actually found. The plugin only **reads** the host's `theme.json` to resolve the active theme.
- Files a 0.7.x install left behind (`~/.dsh-tui/themes/pink-night.json` and friends) are never deleted. On a host with the built-in family they **no longer take effect** (built-ins win); **if you hand-tuned one, rename it** (say `my-pink.json`) to keep using it.
- The first launch sends one neutral toast about that and stays quiet afterwards; the files themselves are never touched.
- `~/.dsh-tui/theme-follow.json` is read by nobody now and can be deleted.

## What it does

| Feature | Seam | Notes |
| --- | --- | --- |
| **Blossom status line** | `tuiStatus` | One decorated line above the prompt: ✿ · clock · live turn count; pink themes only by default |
| **Rich status view** | `tuiStatus.registerView` (≥ 0.10.1) | A one-row React view coloured from the embedded family palette; older hosts fall back to the colourless scalar line |
| **Settings section** | `tuiSettingsSections` | An editable block in `/settings` (glyph / clock / turns / separator / scope); changes apply immediately |
| **Migration notice** | `tuiToast` (≥ 0.10.0) | One toast about leftover ≤0.7.x `pink-*.json` files; silently skipped on older hosts |

**Deliberately out of scope**: no shortcuts, no command registration or override, no input interception, no session events, no system-prompt injection, no theme files installed or registered.

## Quick start

```sh
# Prerelease (npm @latest still points at the theme-carrying 0.7.3)
dsh plugin --profile dsh-tui add -w dsh-tui-theme@0.8.0-pre.1
```

Local tarball install (development / personal use):

```sh
cd /path/to/dsh-tui-theme
npm run build
npm pack
dsh plugin --profile dsh-tui add -w ./dsh-tui-theme-0.8.0-pre.1.tgz
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

The dsh-tui-theme block in `/settings` (captured on 0.7.x; since 0.8 the card keeps only the status-line group, with the same fields):

![dsh-tui-theme settings block](docs/screenshots/settings.png)

## Migration notice (toast)

Plugin logs are invisible to TUI users, so the one event worth knowing goes through a host toast (the `tuiToast` seam on ≥ 0.10.0; output only, never intercepting input; older hosts stay silent):

| Event | Toast |
| --- | --- |
| Leftover ≤0.7.x `pink-*.json` found | ✿ found legacy theme files …: pink-* is a dsh-TUI built-in now and outranks same-named files, this plugin no longer installs themes; rename a file you recoloured to keep using it |

It is sent once per install (recorded in `~/.dsh-tui/theme-plugin-notice.json`), and only ever names the three files the plugin used to install — a theme you created yourself is never mentioned. The plugin neither deletes nor edits those files.

## How the status line relates to themes

- The line is **garnish**: the host owns rendering, clipping and sanitizing; the plugin submits scalar text or one component.
- **Visibility** follows the host's own precedence: the `DSH_TUI_THEME` environment variable over `~/.dsh-tui/theme.json`. The plugin therefore knows the active theme *name* only, never a palette; the `pink-only` test is exactly those three built-in names.
- **Colours** come from three values embedded in `src/palette.ts` (the family's `accent` / `inactiveShimmer` / `subtle`, key-for-key identical to the host's built-ins). dsh-TUI exposes no palette-query seam to plugins (the runtime theme service accepts registrations only and reports nothing back), so this is the plugin's single colour source; non-pink themes stay uncoloured.
- **On older hosts the host renders scalar status text colourless + terminal dim** — outside the plugin's control; the rich view (≥ 0.10.1) exists precisely to get around that.
- The plugin installs, registers and repairs no theme files, and never rewrites `theme.json` (that is the host's user preference).

## Uninstall

```sh
# Remove the plugin
dsh plugin --profile dsh-tui remove -w dsh-tui-theme

# Optional: clear the local theme assets left by 0.7.x
rm ~/.dsh-tui/themes/pink-{night,day,ansi}.json
rm ~/.dsh-tui/theme-follow.json
rm ~/.dsh-tui/theme-plugin-notice.json
```

## Compatibility

- **Minimum dsh-TUI: 0.8.8** (status line and settings section; measured on 0.9.3). Since 0.10.1 the status line colours itself through the rich status view, and older hosts fall back to the colourless scalar line; hosts without the `dsh-tui-extensions` surface degrade silently instead of erroring.
- **The pink family must be built into the host**: the `pink-only` test uses the names `pink-night` / `pink-day` / `pink-ansi`. On a host that does not ship them yet (including the 0.11.2 baseline) this plugin offers no themes, so the line stays hidden under `pink-only` — use `statusScope: all-themes`, or stay on `dsh-tui-theme@0.7.3`.
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
