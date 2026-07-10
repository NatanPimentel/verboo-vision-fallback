import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')

test('registra o hook direto em Node com tempo total limitado', async () => {
  const hooks = JSON.parse(await readFile(join(root, 'hooks', 'hooks.json'), 'utf8'))
  const hook = hooks.hooks.UserPromptSubmit[0].hooks[0]

  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/image-hook.mjs"')
  assert.equal(hook.timeout, 60)
})

test('publica um manifesto Verboo válido como versão 0.2.2', async () => {
  const manifest = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  )
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

  assert.equal(manifest.name, 'verboo-vision-fallback')
  assert.equal(manifest.version, '0.2.2')
  assert.equal(packageJson.version, manifest.version)
  assert.match(manifest.description, /processa imagens automaticamente/i)
  assert.deepEqual(Object.keys(manifest).sort(), [
    'author',
    'description',
    'keywords',
    'license',
    'name',
    'version',
  ])
  assert.equal('$schema' in manifest, false)
  assert.equal('displayName' in manifest, false)
  assert.equal('hooks' in manifest, false)
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
  assert.equal(plugin.strict, true)
})
