import assert from 'node:assert/strict'
import {
  mkdir,
  realpath,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  findCachedImage,
  imageCacheRoot,
  isPathInside,
  latestCachedImage,
  normalizeImageId,
  normalizeSessionId,
} from '../scripts/cache.mjs'
import { resolveConfigRoot } from '../scripts/vision-config.mjs'
import { createTempDirectory, pngFixture } from './test-helpers.mjs'

test('prioriza VERBOO_CONFIG_DIR, mantém VERBOO_HOME como alias e usa image-cache', async t => {
  const root = await createTempDirectory(t, 'verboo-cache-root-')
  const configRoot = join(root, 'configured')
  const legacyRoot = join(root, 'legacy')

  assert.equal(
    resolveConfigRoot({ VERBOO_CONFIG_DIR: configRoot, VERBOO_HOME: legacyRoot }),
    resolve(configRoot),
  )
  assert.equal(resolveConfigRoot({ VERBOO_HOME: legacyRoot }), resolve(legacyRoot))
  assert.equal(
    imageCacheRoot({ VERBOO_CONFIG_DIR: configRoot, VERBOO_HOME: legacyRoot }),
    resolve(configRoot, 'image-cache'),
  )

  const configuredImage = join(configRoot, 'image-cache', 'session-config', '1.png')
  await mkdir(join(configRoot, 'image-cache', 'session-config'), { recursive: true })
  await mkdir(join(legacyRoot, 'image-cache', 'session-config'), { recursive: true })
  await writeFile(configuredImage, pngFixture)
  await writeFile(join(legacyRoot, 'image-cache', 'session-config', '1.png'), Buffer.from('legacy'))

  const found = await findCachedImage(
    imageCacheRoot({ VERBOO_CONFIG_DIR: configRoot, VERBOO_HOME: legacyRoot }),
    'session-config',
    '1',
  )
  assert.equal(found, await realpath(configuredImage))
})

test('aceita somente sessão segura, ID numérico, extensão suportada e arquivo regular', async t => {
  const root = await createTempDirectory(t, 'verboo-cache-regular-')
  const cacheRoot = imageCacheRoot({ VERBOO_CONFIG_DIR: root })
  const sessionPath = join(cacheRoot, 'safe-session')
  await mkdir(sessionPath, { recursive: true })
  const expected = join(sessionPath, '1.PNG')
  await writeFile(expected, pngFixture)
  await writeFile(join(sessionPath, '2.txt'), pngFixture)
  await mkdir(join(sessionPath, '3.png'))

  assert.equal(normalizeSessionId(' safe-session '), 'safe-session')
  assert.equal(normalizeImageId('0001'), '1')
  assert.equal(await findCachedImage(cacheRoot, 'safe-session', '0001'), await realpath(expected))
  assert.equal(await findCachedImage(cacheRoot, 'safe-session', '2'), null)
  assert.equal(await findCachedImage(cacheRoot, 'safe-session', '3'), null)
})

test('rejeita traversal, caminhos absolutos e IDs inválidos antes de tocar no cache', async t => {
  const root = await createTempDirectory(t, 'verboo-cache-traversal-')
  const cacheRoot = imageCacheRoot({ VERBOO_CONFIG_DIR: root })
  const outside = join(root, 'outside')
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, '1.png'), pngFixture)

  assert.equal(normalizeSessionId('../outside'), null)
  assert.equal(normalizeSessionId('..\\outside'), null)
  assert.equal(normalizeSessionId(resolve(outside)), null)
  assert.equal(normalizeSessionId(''), null)
  assert.equal(normalizeImageId('-1'), null)
  assert.equal(normalizeImageId('../1'), null)
  assert.equal(normalizeImageId('9'.repeat(65)), null)
  assert.equal(await findCachedImage(cacheRoot, '../outside', '1'), null)
  assert.equal(await findCachedImage(cacheRoot, '..\\outside', '1'), null)
  assert.equal(await findCachedImage(cacheRoot, 'safe', '../1'), null)
  assert.equal(isPathInside(cacheRoot, outside), false)
})

test('não segue symlink que escaparia do cache', async t => {
  const root = await createTempDirectory(t, 'verboo-cache-symlink-')
  const cacheRoot = imageCacheRoot({ VERBOO_CONFIG_DIR: root })
  const sessionPath = join(cacheRoot, 'session-link')
  const outsidePath = join(root, 'outside.png')
  await mkdir(sessionPath, { recursive: true })
  await writeFile(outsidePath, pngFixture)

  try {
    await symlink(outsidePath, join(sessionPath, '7.png'), 'file')
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error

    // Windows commonly disallows file symlinks without Developer Mode, but a
    // junction is still a symlink-like reparse point and exercises the more
    // important realpath containment boundary.
    const outsideSession = join(root, 'outside-session')
    await mkdir(outsideSession, { recursive: true })
    await writeFile(join(outsideSession, '7.png'), pngFixture)
    try {
      await symlink(outsideSession, join(cacheRoot, 'session-junction'), 'junction')
    } catch (junctionError) {
      if (junctionError?.code === 'EPERM' || junctionError?.code === 'EACCES') {
        t.skip('a criação de symlink ou junction não está autorizada neste Windows')
        return
      }
      throw junctionError
    }
    assert.equal(await findCachedImage(cacheRoot, 'session-junction', '7'), null)
    return
  }

  assert.equal(await findCachedImage(cacheRoot, 'session-link', '7'), null)
})

test('latest seleciona apenas arquivo regular compatível dentro do cache', async t => {
  const root = await createTempDirectory(t, 'verboo-cache-latest-')
  const cacheRoot = imageCacheRoot({ VERBOO_CONFIG_DIR: root })
  const olderPath = join(cacheRoot, 'first', '1.png')
  const newerPath = join(cacheRoot, 'second', '2.jpg')
  const invalidIdPath = join(cacheRoot, 'second', 'not-an-image-id.png')
  await mkdir(join(cacheRoot, 'first'), { recursive: true })
  await mkdir(join(cacheRoot, 'second'), { recursive: true })
  await writeFile(olderPath, pngFixture)
  await writeFile(newerPath, pngFixture)
  await writeFile(invalidIdPath, pngFixture)
  const now = new Date()
  await utimes(olderPath, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000))
  await utimes(newerPath, now, now)
  await utimes(invalidIdPath, new Date(now.getTime() + 10_000), new Date(now.getTime() + 10_000))

  assert.equal(await latestCachedImage(cacheRoot), await realpath(newerPath))
})
