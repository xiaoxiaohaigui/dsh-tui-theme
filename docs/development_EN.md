# Development and verification

[简体中文](development.md) | **English**

Everything the README leaves out: environment, install prerequisites, verification-script arguments, CI gates, and how to maintain the embedded palette and the migration notice.

## Environment

- Node `^22.19 || >=24`, pure ESM; TypeScript compiles to `lib/types/`, the build output is committed, and CI checks it against a fresh build.
- Host baseline: the devDependency pins `@deepseek-harness-tui/dsh-tui@0.14.0`, engine packages pin `0.2.0-rc.1`; the devDependency `dsh-settings` belongs to the ≥ 0.1.7 Config-projection generation, so `verify:settings` runs real projection assertions by default (the ≤ 0.1.6 path is covered by scenario 2 of `verify.mjs` and by a manual `DSH_SETTINGS_DIR` run).
- ⚠️ The 0.14.0 host has **no built-in pink family** (upstream PR #1294 merged into main on 2026-10-12 but is not released with a host yet), yet it still parses `~/.dsh-tui/themes/pink-*.json` as static themes. The plugin's `pink-only` test is a theme *name* (`DSH_TUI_THEME` / `theme.json`), never a host capability check — which is why `verify.mjs` only has to write `pink-night` into its own sandbox `theme.json` to make the line visible. On a real host without the family, that name can only come from the theme files a 0.7.x install left behind. Real-machine checks of the built-in family need a host build that carries it (upstream main, or the local pink integration build `D:\dsh-tui-workspace\dsh-TUI-pink-0140`). Once a host release ships the family, raise the devDependency and CI's `DSH_TUI_EXPECTED_VERSION` together and gate 4 below turns from a skip note into a real check.

## Install prerequisites

Two things make a plain `npm install` fail or silently skip dependencies:

- **This repo deliberately ships no `package-lock.json`.** The host tarball in devDependencies bundles `@dsh-std/*` packages whose in-package manifests still declare `workspace:*`; a committed lockfile is replayed faithfully by npm, so both `npm install` and `npm ci` die with `EUNSUPPORTEDPROTOCOL`. Without the lockfile npm skips the bundled directories and the install works. Do not commit one back (CI's `contract` job fails on it).
- **Never install with `NODE_ENV=production`.** That variable makes npm omit devDependencies, which shows up as `up to date` with an empty `node_modules` and a missing `tsc`. Pass `--include=dev` explicitly (CI also pins `NODE_ENV=development`).

## Commands

```sh
npm install --include=dev
npm run build            # tsc → lib/types
npm run verify           # 17 scenarios: both status paths, both settings generations, toast, notice, no-theme invariants
npm run verify:package   # release manifest (npm pack --dry-run)
npm run verify:peers     # peer coverage contract (every validated runtime must be accepted by a peer range)
npm run verify:settings  # dsh-settings generation projection (capability-probed; legacy installs report and exit 0)
npm run verify:host      # build + real-host assembly (the 0.14.0 devDependency) + palette gate (compared only on hosts that carry the pink family)
npm run release:check    # build + verify + verify:package + verify:peers + verify:settings
```

After changing `devDependencies` / `overrides`, **delete `node_modules` and install fresh**: the bundled `@dsh-std/*` manifests still say `workspace:*`, and an incremental install re-reads them and fails with `EUNSUPPORTEDPROTOCOL` (`--no-package-lock` does not help). A fresh resolve makes npm skip the bundled directories. The install itself writes `package-lock.json`; this repo does not commit it — delete it afterwards.

## Pointing at another host version

`verify:host` uses the devDependency dsh-TUI (currently 0.14.0) with zero configuration and needs no local host checkout. To verify another host, point `DSH_TUI_ADAPTER_DIR` at that version's adapter, and set `DSH_TUI_EXPECTED_VERSION` when the version must be pinned:

```sh
DSH_TUI_ADAPTER_DIR=/path/to/dsh-TUI/lib/types/dsh-adapter \
DSH_TUI_EXPECTED_VERSION=0.9.3 \
npm run verify:host
```

> Since 0.8 `verify:host` only runs `scripts/headless-order-test.mjs` (rich status view / settings card / effect ledger against a real host). The two theme-only scripts — `runtime-themes-headless.mjs` (runtime registration) and `validate-themes-against-host.mjs` (theme keys against the host contract) — were deleted with the theme half, and `DSH_TUI_SOURCE_ROOT` is no longer read by any script.

`verify:settings` probes the `dsh-settings` generation: with the ≥ 0.1.7 devDependency it runs the projection assertions; to exercise another generation, point `DSH_SETTINGS_DIR` at that install:

```sh
DSH_SETTINGS_DIR="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings" npm run verify:settings
```

CI only covers the 0.14.0 zero-configuration line; 0.9.x compatibility runs still need the env overrides above on a local checkout. The host baseline (devDependency and CI's `DSH_TUI_EXPECTED_VERSION`) is guarded by `verify:peers`, which fails when the two disagree.

## CI gates

`.github/workflows/ci.yml` has two parallel jobs plus one summary gate (branch protection only needs `ci-gate`):

| Job | Contents |
| --- | --- |
| `contract` | Dependency-free, seconds: asserts `package-lock.json` is absent; runs `verify:package` |
| `verify` | Full: `npm install --include=dev` → `build` → no `lib/` drift → `verify` → `verify:package` → `verify:peers` → `verify:settings` → `verify:host` |

## The embedded palette (`src/palette.ts`)

The rich status view uses three colours, and only under pink themes: the family's `accent` (glyph), `inactiveShimmer` (clock / turns) and `subtle` (separator). They live in `src/palette.ts` and match the host's built-in pink family (the host's `src/theme.ts`: `pinkNightTheme` / `pinkDayTheme` / `pinkAnsiTheme`) key for key. The plugin reads no theme file and the host exposes no palette-query seam, so this table is the single source.

Maintaining it:

1. When upstream changes a family colour (or adds a pink theme name), update the table in `src/palette.ts`;
2. If a new theme name appears, update `PINK_THEMES` in `src/themePref.ts` too;
3. Scenarios 8 and 15 of `scripts/verify.mjs` pin the three palettes and the "non-pink stays uncoloured" rule — run `npm run verify` after the change;
4. Automatic comparison with the host: when the host build carries the built-in family, `verify:host` imports the host's `lib/types/theme.js` by path and compares its nine cells (`accent` / `inactiveShimmer` / `subtle` × three themes) against `src/palette.ts` by value (`#rrggbb` and `rgb()` normalized first), asserting as well that the host's pink names and `PINK_THEMES` agree; a host without the family (the 0.14.0 baseline included) prints a one-line skip note. For the full 73-key check, run the workspace-level probe `node probes/compare-preset-palettes.mjs` (see `D:\dsh-tui-theme\probes\README.md`).

## Migration notice and its marker (`src/legacyNotice.ts`)

- It looks for the three `pink-*.json` files the plugin used to install in `~/.dsh-tui/themes/`; a theme you created yourself is never mentioned.
- On a hit, and when `~/.dsh-tui/theme-plugin-notice.json` is absent, it sends one neutral toast and writes the marker **only once that toast is confirmed delivered**; every later boot stays quiet.
- The marker records a notice the user actually received, not an attempt: the toast seam (0.10) postdates this plugin's supported floor (0.8.8), so a host without the seam has no built-ins either and its legacy files still work — writing the marker there would swallow the notice for good (the marker outlives an upgrade), while the upgrade to a host carrying the built-in family is exactly when the user needs to hear it. An undelivered notice therefore records nothing: that boot retries silently (the chain gives up rather than nagging) and the next boot tries again until one delivery lands. The delivery report comes from `src/toast.ts` (`send()` answers the first attempt; a retry that lands reports through `onDelivered`), and scenarios 11/12 of `verify.mjs` assert "no marker without a delivery, a marker once one lands, and a failed notice re-issued on the next boot".
- The wording must hold for both host generations: state the built-in precedence as a condition ("where dsh-TUI ships the same pink built-ins"), name the JSON `name` field when advising a rename (the host dedupes on it; renaming the file alone does nothing), and pair that with its consequence — a renamed theme leaves `PINK_THEMES`, so the default `pink-only` scope would hide the status line and the notice has to point at the display scope too. Keep the README migration notes, toast table and the *Clearing the old theme files* section in step; scenario 12 of `verify.mjs` asserts those semantics (including `name`) and that the longest wording (three file names) fits the host's 200-cell toast cap.
- To re-test locally, delete the marker; the plugin never deletes or edits the files it mentions.

## One source of truth for the editable surface

`LIVE_CONFIG_KEYS` in `src/liveConfig.ts` drives the Config volatile marking and equals the `/settings` card fields key for key (`npm run verify` asserts both directions, `npm run verify:settings` asserts the real host projection once more). When you change a knob, update the card fields, the Config and the README configuration table together.

## Prerelease publishing

- The version looks like `0.8.0-pre.2`; npm's `latest` is still the theme-carrying `0.7.5`, so a prerelease needs an explicit version or its own dist-tag (for example `npm publish --tag next`, installed as `dsh-tui-theme@next`).
- **Publishing order**: only move 0.8 onto `latest` once a host release carries the built-in family. Before that `latest` stays 0.7.5 — a fresh install would otherwise get neither a host built-in nor a plugin theme, and no pink theme name at all. Upstream PR #1294 is merged (2026-10-12); only the host release is outstanding.
- The release chain is the usual one: `release:check` + `verify:host` green → bump → commit → tag → push → publish; only the dist-tag and the README install command differ.
- The 0.7.x line (with themes) stays on `latest` until the built-in pink family ships in a stable host release and this entry's 0.8 stable follows.
