import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const pngFixture = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export async function createTempDirectory(t, prefix = 'verboo-vision-test-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

export async function createSessionCache(
  t,
  sessionId,
  fileNames,
  { configRoot } = {},
) {
  const root = configRoot ?? (await createTempDirectory(t))
  const sessionCache = join(root, 'image-cache', sessionId)
  await mkdir(sessionCache, { recursive: true })
  await Promise.all(fileNames.map(fileName => writeFile(join(sessionCache, fileName), pngFixture)))
  // Keep `verbooHome` as a compatibility alias for old fixtures. New tests
  // should exercise the documented VERBOO_CONFIG_DIR name explicitly.
  return { sessionCache, configRoot: root, verbooHome: root }
}

export async function startVisionServer(handler) {
  const sockets = new Set()
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
      }
      if (!response.writableEnded) response.end('{"error":"test handler failed"}')
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        server.close(error => (error ? reject(error) : resolve()))
      }),
  }
}

export async function readRequestBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

export async function readRequestJson(request) {
  return JSON.parse(await readRequestBody(request))
}

export async function runNodeScript(script, { args = [], cwd, env = {}, input } = {}) {
  // A developer's own configuration must not change the expected result of a
  // subprocess test. Empty values are intentionally retained because runtime
  // resolution treats them as unset and can then exercise plugin fallbacks.
  const isolatedRuntimeEnv = {
    VISION_API_KEY: '',
    VISION_BASE_URL: '',
    VISION_MODEL: '',
    VISION_FALLBACK_MODELS: '',
    VISION_TIMEOUT_MS: '',
    VISION_TOTAL_TIMEOUT_MS: '',
    VISION_MAX_TOKENS: '',
    CLAUDE_PLUGIN_OPTION_API_KEY: '',
    CLAUDE_PLUGIN_OPTION_BASE_URL: '',
    CLAUDE_PLUGIN_OPTION_MODEL: '',
    CLAUDE_PLUGIN_OPTION_FALLBACK_MODELS: '',
    CLAUDE_PLUGIN_OPTION_TIMEOUT_MS: '',
    CLAUDE_PLUGIN_OPTION_TOTAL_TIMEOUT_MS: '',
    CLAUDE_PLUGIN_OPTION_MAX_TOKENS: '',
    VERBOO_CONFIG_DIR: '',
    VERBOO_HOME: '',
  }
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...isolatedRuntimeEnv, ...env },
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
    ...(verbooHome ? { VERBOO_CONFIG_DIR: verbooHome } : {}),
    VISION_API_KEY: 'test-key',
    VISION_BASE_URL: baseUrl,
    VISION_MODEL: 'test/primary-model',
    VISION_FALLBACK_MODELS: '',
    VISION_TIMEOUT_MS: '1000',
    VISION_TOTAL_TIMEOUT_MS: '3000',
    VISION_MAX_TOKENS: '128',
    ...overrides,
  }
}
