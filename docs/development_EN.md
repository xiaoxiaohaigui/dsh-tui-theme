# Development and verification

[简体中文](development.md) | **English**

This page holds the development details kept out of the README: environment, install prerequisites, verification-script arguments, CI gates and the palette workflow.

## Environment

- Node `^22.19 || >=24`, pure ESM; TypeScript compiles to `lib/types/`, and the build output is committed — CI fails if it drifts from a fresh build.
- Host baseline: the devDependency pins `@deepseek-harness-tui/dsh-tui@0.11.2` with the matching engine line at `0.2.0-rc.1`; the devDependency `dsh-settings` is the ≥ 0.1.7 Config-projection generation, so `verify:settings` really runs its projection assertions here (the legacy ≤ 0.1.6 path is covered by `verify.mjs` scenario 2 and by a manual `DSH_SETTINGS_DIR` run).

## Install prerequisites

Two things make a plain `npm install` fail or silently install nothing:

- **This repo deliberately ships no `package-lock.json`.** The host tarball in devDependencies bundles `@dsh-std/*` packages whose manifests still declare `workspace:*`; a committed lockfile is replayed faithfully by npm, so both `npm install` and `npm ci` die with `EUNSUPPORTEDPROTOCOL`. Without the lockfile npm skips the bundled directories and installs fine. Do not commit one back — CI's `contract` job rejects it.
- **Never install with `NODE_ENV=production`.** That variable makes npm omit devDependencies (`omit=dev`), which looks like `up to date` but leaves `node_modules` empty and then breaks `tsc`. Pass `--include=dev` explicitly (CI additionally pins `NODE_ENV=development`).

## Common commands

```sh
npm install --include=dev
npm run build            # tsc → lib/types
npm run verify           # plugin contract, theme validation, editable-surface cross-check
npm run verify:package   # release manifest (npm pack --dry-run)
npm run verify:peers     # peer-coverage contract (every validated runtime must be covered)
npm run verify:settings  # dsh-settings generation projection assertions (capability-probed; the older generation reports a skip and exits 0)
npm run verify:host      # build + zero-config host verification (0.11.2)
npm run release:check    # build + verify + verify:package + verify:peers + verify:settings
```

After touching `devDependencies` / `overrides`, delete `node_modules` and install fresh: the host tarball bundles `@dsh-std/*` manifests that still declare `workspace:*`, and an incremental install re-reads them and dies with `EUNSUPPORTEDPROTOCOL` (`--no-package-lock` does not help); a fresh resolution skips the bundled directories instead. The install itself writes a `package-lock.json` — this repo does not commit one, so delete it afterwards.

## Pointing at another host version

`verify:host` uses the devDependency dsh-TUI (currently 0.11.2) for zero-config verification — no local host checkout needed. To verify an older release or a release baseline, point it at the matching host adapter and source; set `DSH_TUI_EXPECTED_VERSION` as well to pin the version:

```sh
DSH_TUI_ADAPTER_DIR=/path/to/dsh-TUI/lib/types/dsh-adapter \
DSH_TUI_SOURCE_ROOT=/path/to/dsh-TUI-source \
DSH_TUI_EXPECTED_VERSION=0.9.3 \
npm run verify:host
```

Phase 4 of `runtime-themes-headless.mjs` (the real settings service) branches by capability: when the host's generation is ≤ 0.1.6 it mounts a real `SettingsProvider` and asserts the late namespace registration; on ≥ 0.1.7 it reports that this API no longer exists and points at `verify:settings` (instead of aborting the whole `verify:host` run with a `TypeError`). To exercise the legacy half, point `DSH_SETTINGS_DIR` at a ≤ 0.1.6 installation (for example a scratch `npm install @deepseek-ai/dsh-settings@0.1.5-rc.1`):

```sh
DSH_SETTINGS_DIR=/path/to/dsh-settings-0.1.5 npm run verify:host
```

`verify:settings` takes the same variable: with an older-generation `dsh-settings` in devDependencies the script reports that it skipped and exits 0; to verify the ≥ 0.1.7 Config projection, point `DSH_SETTINGS_DIR` at the real installation:

```sh
DSH_SETTINGS_DIR="$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings" npm run verify:settings
```

CI only covers the 0.11.2 zero-config line; 0.9.x compatibility regressions still need a local run with the env vars above pointing at the matching host worktree. The host baseline itself (devDependency vs CI's `DSH_TUI_EXPECTED_VERSION`) is guarded by `verify:peers`: it fails when the two disagree.

## CI gates

`.github/workflows/ci.yml` runs two parallel jobs plus one aggregating gate (branch protection only needs to watch `ci-gate`):

| Job | Contents |
| --- | --- |
| `contract` | Dependency-free, a few seconds: asserts `package-lock.json` is absent; runs `verify:package` |
| `verify` | Full: `npm install --include=dev` → `build` → no `lib/` drift → `verify` → `verify:package` → `verify:peers` → `verify:settings` → `verify:host` |

## Changing the palette

1. Edit `themes/*.json`;
2. Run `npm run verify` (official validator, contrast, full key coverage);
3. Delete the matching files under `~/.dsh-tui/themes/` so the plugin reinstalls them — the plugin never overwrites files that already exist.

## One source of truth for the editable surface

`LIVE_CONFIG_KEYS` in `src/liveConfig.ts` drives the Config's volatile markers and matches the `/settings` card fields key for key (`npm run verify` asserts both ways; `npm run verify:settings` asserts the real host projection again). When you add or remove a config field, update the card fields, the Config and the README config table together.
