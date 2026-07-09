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
  assert.equal(hook.timeout, 45)
})

test('publica a nova arquitetura como versão 0.2.0', async () => {
  const manifest = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  )

  assert.equal(manifest.version, '0.2.0')
  assert.match(manifest.description, /processa imagens automaticamente/i)
})
