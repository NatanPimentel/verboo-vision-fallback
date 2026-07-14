import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
  assert(url.protocol === 'http:' || url.protocol === 'https:', `${label} must use HTTP(S).`)
}

const packageJson = await readJson('package.json')
const manifest = await readJson('.claude-plugin/plugin.json')
const marketplace = await readJson('.claude-plugin/marketplace.json')
const hooks = await readJson('hooks/hooks.json')

assert(packageJson.version === '0.3.0', 'package.json must be version 0.3.0.')
assert(packageJson.engines?.node, 'package.json must declare the supported Node.js version.')
assert(!Object.hasOwn(packageJson.engines ?? {}, 'verboo'), 'package.json must not declare engines.verboo.')
assert(manifest.version === packageJson.version, 'package and plugin versions differ.')
assert(manifest.name === 'verboo-vision-fallback', 'unexpected plugin name.')
assert(manifest.description.includes('0.12.0'), 'minimum Verboo version is not declared.')
assert(manifest.author?.name, 'plugin author is required.')
assertUrl(manifest.author.url, 'plugin author.url')
assertUrl(manifest.homepage, 'plugin homepage')
assertUrl(manifest.repository, 'plugin repository')
assert(manifest.license === 'MIT', 'plugin license must be MIT.')

const options = manifest.userConfig ?? {}
const expectedOptions = {
  api_key: { type: 'string' },
  model: { type: 'string' },
  fallback_models: { type: 'string', default: '' },
  base_url: { type: 'string', default: 'https://code.verboo.ai/router/v1' },
  timeout_ms: { type: 'number', default: 30000 },
  total_timeout_ms: { type: 'number', default: 55000 },
  max_tokens: { type: 'number', default: 1024 },
}
assert(
  JSON.stringify(Object.keys(options).sort()) ===
    JSON.stringify(Object.keys(expectedOptions).sort()),
  'manifest userConfig keys do not match the public contract.',
)
for (const [key, expected] of Object.entries(expectedOptions)) {
  assert(options[key].type === expected.type, `${key}.type is invalid.`)
  if (Object.hasOwn(expected, 'default')) {
    assert(options[key].default === expected.default, `${key}.default is invalid.`)
  } else {
    assert(!Object.hasOwn(options[key], 'default'), `${key} must not declare a default.`)
  }
  assert(typeof options[key].title === 'string' && options[key].title.length > 0, `${key}.title is required.`)
  assert(
    typeof options[key].description === 'string' && options[key].description.length > 0,
    `${key}.description is required.`,
  )
}
assert(options.timeout_ms.max === 55000, 'timeout_ms.max must preserve hook fail-open margin.')
assert(options.total_timeout_ms.max === 55000, 'total_timeout_ms.max must preserve hook fail-open margin.')
assert(options.api_key.sensitive === true, 'api_key must be stored as a sensitive plugin option.')
assert(options.model.required === true, 'model must be required until an exact ID is smoke-tested.')
assert(!Object.hasOwn(manifest, 'hooks'), 'plugin.json must not duplicate the native hooks/hooks.json hook.')
assert(
  !Object.hasOwn(packageJson.engines ?? {}, 'verboo'),
  'engines.verboo is not a supported package contract field.',
)

assert(marketplace.name === 'verboo-vision-fallback', 'unexpected marketplace name.')
assert(marketplace.owner?.name, 'marketplace owner is required.')
assertUrl(marketplace.owner.url, 'marketplace owner.url')
assert(marketplace.metadata?.version === '0.3.0', 'marketplace metadata version is invalid.')
assert(marketplace.metadata?.description, 'marketplace metadata description is required.')
assert(Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1, 'marketplace must contain one plugin.')
const entry = marketplace.plugins[0]
assert(entry.name === manifest.name, 'marketplace and plugin names differ.')
assert(entry.version === manifest.version, 'marketplace and plugin versions differ.')
assert(entry.source === './', 'marketplace source must be ./.' )
assert(entry.strict === true, 'marketplace plugin must be strict.')
assert(entry.category === 'vision', 'marketplace category must be vision.')
assertUrl(entry.homepage, 'marketplace plugin homepage')
assertUrl(entry.repository, 'marketplace plugin repository')
assert(Array.isArray(entry.tags) && entry.tags.length > 0, 'marketplace plugin tags are required.')
assert(entry.tags.includes('vision'), 'marketplace plugin tags must include vision.')

assert(typeof hooks.description === 'string' && hooks.description.length > 0, 'hooks description is required.')
const promptHooks = hooks.hooks?.UserPromptSubmit
assert(Array.isArray(promptHooks) && promptHooks.length === 1, 'UserPromptSubmit hook is missing.')
const commandHook = promptHooks[0]?.hooks?.[0]
assert(commandHook?.type === 'command', 'UserPromptSubmit must use a command hook.')
assert(commandHook.command === 'node "${CLAUDE_PLUGIN_ROOT}/scripts/image-hook.mjs"', 'unexpected hook command.')
assert(commandHook.timeout === 70, 'hook timeout must be 70 seconds.')
assert(Object.keys(hooks.hooks).length === 1, 'legacy duplicate hook events must not be present.')

process.stdout.write('offline plugin contract valid for verboo-vision-fallback@0.3.0\n')
