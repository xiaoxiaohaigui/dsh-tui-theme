# Development and verification

[简体中文](development.md) | **English**

Everything the README leaves out: environment, install prerequisites, verification-script arguments, CI gates, and how to maintain the embedded palette and the migration notice.

## Environment

- Node `^22.19 || >=24`, pure ESM; TypeScript compiles to `lib/types/`, the build output is committed, and CI checks it against a fresh build.
- Host baseline: the devDependency pins `@deepseek-harness-tui/dsh-tui@0.11.2`, engine packages pin `0.2.0-rc.1`; the devDependency `dsh-settings` belongs to the ≥ 0.1.7 Config-projection generation, so `verify:settings` runs real projection assertions by default (the ≤ 0.1.6 path is covered by scenario 2 of `verify.mjs` and by a manual `DSH_SETTINGS_DIR` run).
- ⚠️ The 0.11.2 host has **no built-in pink family**: the `pink-only` test never passes there, which is why `verify.mjs` writes `pink-night` into its own sandbox `theme.json` to make the line visible. Real-machine checks of the built-in family need a host build that carries it.

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
npm run verify:host      # build + real-host assembly (the 0.11.2 devDependency)
npm run release:check    # build + verify + verify:package + verify:peers + verify:settings
```

After changing `devDependencies` / `overrides`, **delete `node_modules` and install fresh**: the bundled `@dsh-std/*` manifests still say `workspace:*`, and an incremental install re-reads them and fails with `EUNSUPPORTEDPROTOCOL` (`--no-package-lock` does not help). A fresh resolve makes npm skip the bundled directories. The install itself writes `package-lock.json`; this repo does not commit it — delete it afterwards.

## Pointing at another host version

`verify:host` uses the devDependency dsh-TUI (currently 0.11.2) with zero configuration and needs no local host checkout. To verify another host, point `DSH_TUI_ADAPTER_DIR` at that version's adapter, and set `DSH_TUI_EXPECTED_VERSION` when the version must be pinned:

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

CI only covers the 0.11.2 zero-configuration line; 0.9.x compatibility runs still need the env overrides above on a local checkout. The host baseline (devDependency and CI's `DSH_TUI_EXPECTED_VERSION`) is guarded by `verify:peers`, which fails when the two disagree.

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
4. To confirm key-for-key equality with the host, run `node probes/compare-preset-palettes.mjs` against the host worktree (a workspace-level probe, see `D:\dsh-tui-theme\probes\README.md`).

## Migration notice and its marker (`src/legacyNotice.ts`)

- It looks for the three `pink-*.json` files the plugin used to install in `~/.dsh-tui/themes/`; a theme you created yourself is never mentioned.
- On a hit, and when `~/.dsh-tui/theme-plugin-notice.json` is absent, it sends one neutral toast and writes the marker; every later boot stays quiet.
- The marker records the *attempt*, not a confirmed render: `tuiToast` and the built-in pink family landed in the same 0.10 line, so a host without the seam does not need the notice anyway, while a repeated one would nag.
- To re-test locally, delete the marker; the plugin never deletes or edits the files it mentions.

## One source of truth for the editable surface

`LIVE_CONFIG_KEYS` in `src/liveConfig.ts` drives the Config volatile marking and equals the `/settings` card fields key for key (`npm run verify` asserts both directions, `npm run verify:settings` asserts the real host projection once more). When you change a knob, update the card fields, the Config and the README configuration table together.

## Prerelease publishing

- The version looks like `0.8.0-pre.1`; npm's `latest` still points at the theme-carrying `0.7.3`, so a prerelease needs an explicit version or its own dist-tag (for example `npm publish --tag next`, installed as `dsh-tui-theme@next`).
- The release chain is the usual one: `release:check` + `verify:host` green → bump → commit → tag → push → publish; only the dist-tag and the README install command differ.
- The 0.7.x line (with themes) stays on `latest` until the built-in pink family ships in a stable host release and this entry's 0.8 stable follows.
