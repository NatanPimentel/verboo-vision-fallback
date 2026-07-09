import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export async function createSessionCache(t, sessionId, fileNames) {
  const verbooHome = await mkdtemp(join(tmpdir(), 'verboo-vision-test-'))
  const sessionCache = join(verbooHome, 'image-cache', sessionId)
  await mkdir(sessionCache, { recursive: true })
  await Promise.all(fileNames.map(fileName => writeFile(join(sessionCache, fileName), pngFixture)))
  t.after(() => rm(verbooHome, { recursive: true, force: true }))
  return { sessionCache, verbooHome }
}

export async function startVisionServer(handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
  }
}

export async function runNodeScript(script, { args = [], cwd, env = {}, input } = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
  child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
  child.stdin.end(input)

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  return { exitCode, stdout, stderr }
}

export function visionEnv(verbooHome, baseUrl, overrides = {}) {
  return {
    ...(verbooHome ? { VERBOO_HOME: verbooHome } : {}),
    VISION_API_KEY: 'test-key',
    VISION_BASE_URL: baseUrl,
    VISION_MODEL: 'ultra/kimi-k2.7',
    VISION_FALLBACK_MODELS: '',
    VISION_TIMEOUT_MS: '1000',
    ...overrides,
  }
}
