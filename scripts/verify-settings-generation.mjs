/**
 * Verify the plugin against a real `@deepseek-ai/dsh-settings` install of the
 * ≥0.1.7 generation — the Config-derived forms the `/settings` screen reads.
 *
 * Why this exists: 0.1.7 removed the namespace-registration API entirely and
 * projects each profile entry's Cordis Config instead. A plugin that misses the
 * transition still boots, still registers its card, and simply renders
 * `命名空间未注册`; a card field whose Config key is not marked volatile renders
 * `（未设置）` forever. Both are silent, so they get a gate — the reference
 * record is docs/decisions/2026-09-24-settings-generation-adaptation.md (in the
 * dsh-tui-find repo), whose migration checklist this script implements for
 * dsh-tui-theme.
 *
 * What it checks (against the built `lib/types/`, not the sources):
 *   1. `volatileForm(Config)` is non-empty and holds exactly the live keys
 *      (the entry is listed by `describe()` only when it is);
 *   2. every live key is writable through the `isVolatilePath` gate;
 *   3. the card's field paths equal the live keys — the parity that keeps a
 *      field from rendering editable while nothing serves it;
 *   4. `projectForm` over a resolved row config yields a value for every live
 *      knob (all of them carry defaults, so nothing may read `（未设置）`);
 *   5. the wiring against a real-shaped service (no `register`, has
 *      `configure`): page policy opts out of the auto page on the plugin's own
 *      fiber, the initial value comes from the live config, and a
 *      `loader/volatile-update` re-read sees edited values.
 *
 * Usage:
 *   npm run build && node scripts/verify-settings-generation.mjs
 *   node scripts/verify-settings-generation.mjs --settings <dir>
 *   DSH_SETTINGS_DIR=<dir> node scripts/verify-settings-generation.mjs
 *
 * `<dir>` is a `@deepseek-ai/dsh-settings` package directory, e.g. the one a
 * real profile resolves:
 *   %USERPROFILE%\.dsh\profiles\node_modules\@deepseek-ai\dsh-settings
 *
 * Generation detection is behavioural, never a version parse: a legacy
 * install (≤0.1.6) is reported as "nothing to verify here" and exits 0 — its
 * path is covered by scripts/verify.mjs. So a green run with the repo's own
 * (legacy) dependency means "the new-generation path was not exercised", not
 * "verified"; point DSH_SETTINGS_DIR at a real 0.1.7+ install to gate it.
 * Exit code 1 on any failed check.
 *
 * The probe runs from a scratch directory inside the settings tree's own
 * `node_modules`, so the plugin's bare import (`@deepseek-ai/schemastery`)
 * resolves exactly as it does at runtime there — the marking only happens on a
 * schemastery that knows `.volatile()` (3.18.3+), and that is the host's copy,
 * not this repo's. The directory is removed on the way out.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function parseArgs(argv) {
  let settings
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--settings') {
      if (argv[i + 1] === undefined) throw new Error('--settings needs a directory argument')
      settings = argv[++i]
    } else {
      throw new Error(`unknown option: ${argv[i]}`)
    }
  }
  return { settings }
}

/** Where the settings package lives: --settings, then DSH_SETTINGS_DIR, then
 *  this repo's own tree. */
function resolveSettingsDir(explicit) {
  const candidate =
    explicit ?? process.env['DSH_SETTINGS_DIR'] ?? join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh-settings')
  if (!existsSync(join(candidate, 'package.json'))) {
    throw new Error(
      `no @deepseek-ai/dsh-settings at ${candidate}\n` +
        'pass --settings <dir> or set DSH_SETTINGS_DIR (a real profile resolves it under ' +
        '<DSH_HOME>/profiles/node_modules/@deepseek-ai/dsh-settings)',
    )
  }
  return candidate
}

const failures = []
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(label)
}
function note(text) {
  console.log(`  · ${text}`)
}

const { settings: explicitSettings } = parseArgs(process.argv.slice(2))
const settingsDir = resolveSettingsDir(explicitSettings)
const version = JSON.parse(readFileSync(join(settingsDir, 'package.json'), 'utf8')).version
console.log(`* @deepseek-ai/dsh-settings ${version} (${settingsDir})`)

// Generation detection: the Config-derived surface needs `lib/types/schema.js`
// (volatileForm/projectForm/isVolatilePath) and there must be no
// namespace-registration class to fall back on.
const schemaModule = join(settingsDir, 'lib', 'types', 'schema.js')
const lib = await import(pathToFileURL(join(settingsDir, 'lib', 'index.js')).href)
const provider =
  lib.SettingsForms ??
  lib.default ??
  Object.values(lib).find(value => typeof value === 'function' && value.prototype !== undefined)
const legacyRegister = typeof provider?.prototype?.register === 'function'
if (!existsSync(schemaModule) || legacyRegister) {
  console.log('* ≤0.1.6 generation (namespace registration): nothing to verify here.')
  console.log('  The plugin\'s legacy path is covered by scripts/verify.mjs.')
  console.log('  Point DSH_SETTINGS_DIR at a real ≥0.1.7 install to exercise the Config-derived path.')
  process.exit(0)
}
console.log('* ≥0.1.7 generation (Config-derived forms): verifying the plugin card against it.')

const buildDir = join(repoRoot, 'lib', 'types')
for (const file of ['index.js', 'liveConfig.js', 'settingsSection.js']) {
  if (!existsSync(join(buildDir, file))) {
    throw new Error(`lib/types/${file} is missing — run \`npm run build\` first`)
  }
}

// Scratch dir inside the settings tree's node_modules: bare specifiers resolve
// from there exactly as the plugin's own copy would at runtime.
const probeRoot = join(dirname(dirname(settingsDir)), `.dsh-tui-theme-settings-probe-${process.pid}`)
try {
  rmSync(probeRoot, { recursive: true, force: true })
  mkdirSync(probeRoot, { recursive: true })
  cpSync(buildDir, join(probeRoot, 'types'), { recursive: true })

  const plugin = name => import(pathToFileURL(join(probeRoot, 'types', name)).href)
  const helper = name => import(pathToFileURL(join(settingsDir, 'lib', 'types', name)).href)

  const { Config } = await plugin('index.js')
  const { LIVE_CONFIG_KEYS, hasLiveConfigFields, readConfigValues } = await plugin('liveConfig.js')
  const { registerPinkSettings, resolveSettingsNamespace, SETTINGS_NS } = await plugin('settingsSection.js')
  const { volatileForm, projectForm, plainConfig, isVolatilePath } = await helper('schema.js')

  // The host's own schemastery: 3.18.3+ parses marked fields into live refs.
  const hostRequire = createRequire(join(settingsDir, 'lib', 'index.js'))
  const z = (await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/schemastery')).href)).default
  const volatileCapable = typeof z?.string?.().volatile === 'function'

  const liveKeys = [...LIVE_CONFIG_KEYS].sort()
  const form = volatileForm(Config)
  check('a live marker exists on the shipped Config', hasLiveConfigFields(Config))
  check('volatileForm(Config) is non-empty (describe() lists the entry)', form !== undefined)
  const formKeys = Object.keys(form?.dict ?? {}).sort()
  check(
    'live keys == form-projected keys',
    JSON.stringify(formKeys) === JSON.stringify(liveKeys),
    formKeys.join(', '),
  )
  check('every live key passes the write gate', LIVE_CONFIG_KEYS.every(key => isVolatilePath(Config, [key])))

  // The namespace follows the Loader entry id on this generation (dsh-TUI
  // #990's fragility: the host keys by entry id, so a renamed row must move
  // the card with it) and falls back to the constant for an unusable id.
  const withEntry = id => ({ fiber: { entry: { options: { id } } } })
  check(
    'namespace follows the Loader entry id',
    resolveSettingsNamespace(withEntry('custom-theme')) === 'custom-theme',
    resolveSettingsNamespace(withEntry('custom-theme')),
  )
  check(
    'namespace falls back for an unusable entry id',
    resolveSettingsNamespace(withEntry('Custom.TUI')) === SETTINGS_NS,
  )
  check('namespace defaults to the constant without a Loader entry', resolveSettingsNamespace({}) === SETTINGS_NS)

  // Every live knob carries a schema default here, so the projection must
  // serve a value for each one (the `（未设置）` symptom is a defaulted field
  // missing from the form).
  const unset = projectForm(form, plainConfig(Config({})))
  const unsetMissing = LIVE_CONFIG_KEYS.filter(key => unset[key] === undefined)
  check('every live knob is served (no （未设置）)', unsetMissing.length === 0, unsetMissing.join(', '))

  const rowConfig = Config({
    followSystem: true,
    statusGlyph: '❀',
    statusSeparator: '✦',
    showGlyph: true,
    showClock: false,
    showTurns: true,
    statusScope: 'all-themes',
  })
  const view = projectForm(form, plainConfig(rowConfig))
  check(
    'user values survive the projection',
    view.statusGlyph === '❀' &&
      view.statusSeparator === '✦' &&
      view.showClock === false &&
      view.statusScope === 'all-themes' &&
      view.followSystem === true,
    JSON.stringify(view),
  )

  if (volatileCapable) {
    check(
      'the host sends marked fields as live refs',
      typeof rowConfig.statusGlyph === 'object' && rowConfig.statusGlyph !== null,
    )
    check('apply-time config resolves through live refs', readConfigValues(rowConfig).statusGlyph === '❀')
  } else {
    note('this host schemastery has no .volatile(): values stay plain; meta marking still projects')
  }

  // The wiring, against a service shaped like the real one: no `register`, a
  // per-instance page policy, and the values coming from the live Config.
  const warns = []
  const cards = []
  const configured = []
  const applied = []
  let refresh
  const service = {
    configure: (presentation, owner) => {
      configured.push({ presentation, owner })
      return () => {}
    },
    describe: () => [],
    update: async () => {},
    mutate: async () => {},
  }
  const sections = {
    register: section => {
      cards.push(section)
      return () => {}
    },
  }
  const logger = { warn: message => warns.push(String(message)), info: () => {}, error: () => {} }
  const child = dep => ({
    [dep]: dep === 'settings' ? service : sections,
    effect: factory => factory(),
    logger,
  })
  const ctx = {
    get: key => (key === 'tuiSettingsSections' ? sections : undefined),
    effect: factory => factory(),
    inject: (deps, callback) => {
      for (const dep of deps) callback(child(dep))
    },
    on: (event, listener) => {
      check('listens on loader/volatile-update', event === 'loader/volatile-update', event)
      refresh = listener
      return () => {}
    },
    // The plugin's own fiber, as the Loader reports it: the namespace source
    // and the owner the page policy must attach to.
    fiber: { entry: { options: { id: SETTINGS_NS } } },
    logger,
  }

  const live = { current: rowConfig }
  registerPinkSettings(
    ctx,
    {
      cordis: { statusGlyph: '✿', statusSeparator: '·', showGlyph: true, showClock: true, showTurns: true, statusScope: 'pink-only', statusEnabled: true, followSystem: false },
      readLive: () => readConfigValues(live.current),
      hasLiveFields: hasLiveConfigFields(Config),
      onDoc: doc => applied.push(doc),
    },
    join(probeRoot, 'data'),
  )

  check('the card takes the Loader entry id as its namespace', cards[0]?.ns === SETTINGS_NS, String(cards[0]?.ns))
  check('no namespace registration is attempted', typeof service.register === 'undefined')
  check(
    'page policy opts out of the auto page on the plugin fiber',
    configured.length === 1 &&
      configured[0].presentation.auto === false &&
      configured[0].owner === ctx.fiber,
  )
  const cardPaths = (cards[0]?.fields ?? []).map(field => field.path.join('.')).sort()
  check('card fields == live keys', JSON.stringify(cardPaths) === JSON.stringify(liveKeys), cardPaths.join(', '))
  check('initial value comes from the live config', applied.at(-1)?.statusGlyph === '❀')
  check('a healthy ≥0.1.7 host logs no warning', warns.length === 0, warns.join(' | '))

  const edited = Config({
    followSystem: false,
    statusGlyph: '🌸',
    statusSeparator: '·',
    showGlyph: false,
    showClock: true,
    showTurns: false,
    statusScope: 'pink-only',
  })
  // Model the loader's in-place rewrite: the plugin re-reads the same object.
  for (const key of Object.keys(edited)) live.current[key] = edited[key]
  refresh?.()
  check(
    'a volatile update re-reads the edited config',
    applied.at(-1)?.statusGlyph === '🌸' &&
      applied.at(-1)?.showGlyph === false &&
      applied.at(-1)?.showClock === true &&
      applied.at(-1)?.followSystem === false,
    JSON.stringify(applied.at(-1)),
  )
} finally {
  rmSync(probeRoot, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
