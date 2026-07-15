import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')

test('mantém o hook no local nativo e com tempo total limitado', async () => {
  const hooks = JSON.parse(await readFile(join(root, 'hooks', 'hooks.json'), 'utf8'))
  const hook = hooks.hooks.UserPromptSubmit[0].hooks[0]

  assert.match(hooks.description, /automaticamente/i)
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/image-hook.mjs"')
  assert.equal(hook.timeout, 70)
})

test('publica um manifesto Verboo válido como versão 0.3.4', async () => {
  const manifest = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  )
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

  assert.equal(manifest.name, 'verboo-vision-fallback')
  assert.equal(manifest.version, '0.3.4')
  assert.equal(packageJson.version, manifest.version)
  assert.match(manifest.description, /0\.12\.0/)
  assert.equal(manifest.homepage, 'https://github.com/NatanPimentel/verboo-vision-fallback')
  assert.equal(manifest.repository, manifest.homepage)
  assert.deepEqual(Object.keys(manifest.userConfig).sort(), [
    'api_key',
    'base_url',
    'fallback_models',
    'max_tokens',
    'model',
    'timeout_ms',
    'total_timeout_ms',
  ])
  assert.equal(manifest.userConfig.api_key.sensitive, true)
  assert.equal('default' in manifest.userConfig.api_key, false)
  assert.equal(manifest.userConfig.model.required, true)
  assert.equal('default' in manifest.userConfig.model, false)
  assert.equal(manifest.userConfig.fallback_models.default, '')
  assert.equal(manifest.userConfig.timeout_ms.default, 30000)
  assert.equal(manifest.userConfig.timeout_ms.max, 55000)
  assert.equal(manifest.userConfig.total_timeout_ms.default, 55000)
  assert.equal(manifest.userConfig.total_timeout_ms.max, 55000)
  assert.equal(manifest.userConfig.max_tokens.default, 1024)
  for (const option of Object.values(manifest.userConfig)) {
    assert.equal(typeof option.title, 'string')
    assert.ok(option.title.length > 0)
    assert.equal(typeof option.description, 'string')
    assert.ok(option.description.length > 0)
  }
  assert.equal('$schema' in manifest, false)
  assert.equal('displayName' in manifest, false)
  assert.equal('hooks' in manifest, false)
  assert.doesNotMatch(manifest.description, /settings\.json/i)
  assert.equal('verboo' in (packageJson.engines ?? {}), false)
})

test('publica um marketplace nativo consistente com o manifesto', async () => {
  const manifest = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  )
  const marketplace = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'),
  )

  assert.equal(marketplace.name, 'verboo-vision-fallback')
  assert.equal(marketplace.plugins.length, 1)

  const [plugin] = marketplace.plugins
  assert.equal(plugin.name, manifest.name)
  assert.equal(plugin.version, manifest.version)
  assert.equal(plugin.source, './')
  assert.equal(plugin.category, 'vision')
  assert.equal(plugin.homepage, manifest.homepage)
  assert.equal(plugin.repository, manifest.repository)
  assert.equal(plugin.strict, true)
  assert.ok(plugin.tags.includes('vision'))
  assert.ok(plugin.tags.includes('openai-compatible'))
  assert.equal(marketplace.metadata.version, manifest.version)
  assert.match(marketplace.metadata.description, /0\.12\.0/)
})

test('documenta a migração sem instruir edição manual de settings', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8')

  assert.match(readme, /remova somente essa entrada/i)
  assert.match(readme, /0\.2\.1/)
  assert.match(readme, /exatamente uma chamada de visão/i)
  assert.doesNotMatch(readme, /settings\.json/i)
  assert.doesNotMatch(readme, /registre o `?UserPromptSubmit` diretamente/i)
  assert.doesNotMatch(readme, /"hooks":\s*\{/i)
})

test('registra as notas da release 0.3.0', async () => {
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8')

  assert.match(changelog, /^## 0\.3\.0$/m)
  assert.match(changelog, /55 segundos/i)
  assert.match(changelog, /70 segundos/i)
})
