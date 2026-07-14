import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const directories = ['scripts', 'tests']
const files = []

for (const directory of directories) {
  const entries = await readdir(join(root, directory), { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(join(root, directory, entry.name))
    }
  }
}

for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`)
    process.exitCode = 1
    break
  }
}

if (!process.exitCode) {
  process.stdout.write(`syntax valid for ${files.length} .mjs modules\n`)
}
