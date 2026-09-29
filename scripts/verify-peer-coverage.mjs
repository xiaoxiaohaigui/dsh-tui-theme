/**
 * Peer-coverage contract for the `@deepseek-ai/dsh*` ranges this manifest ships.
 *
 * Why this exists: a dsh runtime from 0.2.0-rc.1 on evaluates every
 * `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer range at startup
 * (`@deepseek-ai/dsh-app-boot` `evaluatePluginCompatibility()`, called from
 * `loadProfileDirectory`) and drops the whole bundle layer on a mismatch — the
 * plugin simply never loads, and the only trace is a `skipping profile bundle`
 * line on stderr. A range that lags a runtime version this repo has validated
 * is therefore a silent boot failure, not a metadata nit: it happened once
 * (REVIEW.md R-009, dsh 0.2.0-rc.1 against the 0.7.2 manifest).
 *
 * What it checks:
 *   1. every runtime version this repo has validated satisfies every
 *      `@deepseek-ai/dsh*` peer range, under the evaluator's own semantics
 *      (`{ includePrerelease: true }`);
 *   2. the ranges do NOT claim an unvalidated generation (a range that swallows
 *      a future host would let it load unverified);
 *   3. each development baseline stays inside its published peer contract
 *      (`semver.subset`, same semantics);
 *   4. the devDependency baseline and CI's `DSH_TUI_EXPECTED_VERSION` agree, so
 *      a baseline bump cannot quietly leave CI on the old host (REVIEW.md
 *      R-011).
 *
 * Adding support for a new runtime means adding it to VALIDATED_RUNTIME_VERSIONS
 * and widening the ranges in package.json in the same change — that coupling is
 * the point. `semver` is an explicit devDependency for this script; the
 * dependency-free half of the manifest contract stays in verify-package.mjs so
 * CI's contract job can keep running without an install.
 *
 * Usage: `npm run verify:peers` (also part of `npm run release:check`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import semver from 'semver'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * Runtime versions this repo has verified. The list is deliberately explicit:
 * a host bump (devDependency + CI pin) is expected to arrive together with the
 * evidence that the new runtime loads the plugin, and this gate makes the
 * "evidence exists but the range stayed behind" case impossible to ship.
 */
const VALIDATED_RUNTIME_VERSIONS = [
  '0.1.2-alpha.3',
  '0.1.5-rc.1',
  '0.1.7-rc.1',
  '0.1.7-rc.2',
  '0.2.0-rc.1',
]

/**
 * Generations deliberately left out of the contract. `0.2.x` stays inside the
 * declared caret line on purpose (the plugin is verified on the 0.2.0 line and
 * the host's prerelease semantics accept the rest of it); everything above is
 * not validated and must not be claimed.
 */
const UNSUPPORTED_RUNTIME_VERSIONS = ['0.3.0-rc.1', '0.3.0', '1.0.0']

/** The host's evaluator semantics (dsh-app-boot evaluatePluginCompatibility). */
const HOST_SEMANTICS = { includePrerelease: true }

const checks = []
for (const [name, peerRange] of Object.entries(packageJson.peerDependencies)) {
  // Only the `@deepseek-ai/dsh*` family takes part in the startup validation:
  // cordis, schemastery and the host package itself are never evaluated by it.
  if (!/^@deepseek-ai\/dsh(?:-|$)/u.test(name)) continue
  for (const version of VALIDATED_RUNTIME_VERSIONS) {
    assert.equal(
      semver.satisfies(version, peerRange, HOST_SEMANTICS),
      true,
      `${name} must accept the validated runtime ${version}; widen its peer range (package.json)`,
    )
  }
  for (const version of UNSUPPORTED_RUNTIME_VERSIONS) {
    assert.equal(
      semver.satisfies(version, peerRange, HOST_SEMANTICS),
      false,
      `${name} must not claim the unvalidated runtime ${version}`,
    )
  }
  checks.push(`${name}: ${VALIDATED_RUNTIME_VERSIONS.length} validated runtime(s), ${UNSUPPORTED_RUNTIME_VERSIONS.length} rejected`)
}

for (const [name, peerRange] of Object.entries(packageJson.peerDependencies)) {
  if (!name.startsWith('@deepseek-ai/')) continue
  const devRange = packageJson.devDependencies?.[name]
  if (devRange === undefined) continue
  assert.equal(
    semver.subset(devRange, peerRange, HOST_SEMANTICS),
    true,
    `${name} dev baseline ${devRange} must stay inside its peer range ${peerRange}`,
  )
}

// The host baseline lives in two places: the devDependency this repo builds and
// tests against, and the version CI pins through DSH_TUI_EXPECTED_VERSION. The
// workflow is not part of the published tarball, so the check applies only when
// the file is there (always true in the repo and in CI).
const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url)
if (existsSync(workflowPath)) {
  const pinnedHost = /DSH_TUI_EXPECTED_VERSION:\s*(\S+)/u.exec(readFileSync(workflowPath, 'utf8'))?.[1]
  assert.equal(
    pinnedHost,
    packageJson.devDependencies?.['@deepseek-harness-tui/dsh-tui'],
    'CI must verify the same dsh-TUI baseline the repo pins in devDependencies',
  )
}

for (const line of checks) console.log(`✓ peer coverage: ${line}`)
console.log(
  `✓ peer contract: ${VALIDATED_RUNTIME_VERSIONS.length} validated runtime(s) covered, ` +
    `${UNSUPPORTED_RUNTIME_VERSIONS.length} unvalidated generation(s) rejected, dev baselines inside their ranges`,
)
