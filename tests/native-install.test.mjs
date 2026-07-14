import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')

test('instalação nativa registra exatamente um hook, sem manifest.hooks duplicado', async () => {
  const hooks = JSON.parse(await readFile(join(root, 'hooks', 'hooks.json'), 'utf8'))
  const manifest = JSON.parse(
    await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'),
  )
  const installedHooks = hooks.hooks?.UserPromptSubmit
    ?.flatMap(entry => entry.hooks ?? [])
    .filter(hook => hook.type === 'command')
    .filter(hook => hook.command.includes('scripts/image-hook.mjs'))

  assert.deepEqual(installedHooks, [
    {
      type: 'command',
      command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/image-hook.mjs"',
      timeout: 70,
    },
  ])
  assert.equal('hooks' in manifest, false)
})

test('documenta migração da entrada manual antiga sem pedir edição de settings', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8')

  assert.match(readme, /remova somente essa entrada/i)
  assert.match(readme, /versão antiga `0\.2\.1`/i)
  assert.match(readme, /atualize ou reinstale o plugin/i)
  assert.match(readme, /exatamente uma chamada de visão/i)
  assert.doesNotMatch(readme, /settings\.json/i)
  assert.match(readme, /não registre outro `?UserPromptSubmit`?/i)
})
