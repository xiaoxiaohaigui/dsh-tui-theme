/**
 * The settings contract this plugin publishes to the host's /settings form:
 * the namespace, every field's path + kind, and the select options of the
 * status scope. Both verification scripts assert against this single copy so
 * a field addition or reorder only needs one edit here — the assertions are
 * order-insensitive, so reordering the fields in sectionDefinition() is not
 * an error by itself.
 *
 * The namespace is derived from the package name, mirroring PLUGIN_ID in
 * src/pluginId.ts: if the package and its registration id ever drift apart,
 * the headless order test fails on the namespace comparison instead of
 * silently testing the wrong section.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const SETTINGS_NAMESPACE = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).name

/** [path, kind] pairs; compare as a set, never positionally. */
export const SETTINGS_FIELDS = [
  [['followSystem'], 'boolean'],
  [['showGlyph'], 'boolean'],
  [['showClock'], 'boolean'],
  [['showTurns'], 'boolean'],
  [['statusScope'], 'select'],
]

/** The values the statusScope select must expose, looked up by field path. */
export const STATUS_SCOPE_FIELD_PATH = ['statusScope']
export const STATUS_SCOPE_OPTIONS = ['pink-only', 'all-themes']

/** Assert a section object (ns + fields) matches the contract. */
export function assertSettingsContract(assert, section) {
  assert.equal(section.ns, SETTINGS_NAMESPACE, 'settings namespace must match')
  const actual = section.fields.map(field => [field.path, field.kind])
  const expected = SETTINGS_FIELDS.map(([path, kind]) => `${JSON.stringify(path)}:${kind}`)
  assert.deepEqual(
    actual.map(([path, kind]) => `${JSON.stringify(path)}:${kind}`).sort(),
    [...expected].sort(),
    'settings fields must remain compatible with the host form contract',
  )
  const scopeField = section.fields.find(
    field => JSON.stringify(field.path) === JSON.stringify(STATUS_SCOPE_FIELD_PATH),
  )
  assert.ok(scopeField, 'statusScope field must exist (looked up by path, not position)')
  assert.deepEqual(
    scopeField.options?.map(option => option.value),
    STATUS_SCOPE_OPTIONS,
    'status scope must expose both supported select values',
  )
}
