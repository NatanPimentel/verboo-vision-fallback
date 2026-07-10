import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'

export const imageMimeTypes = new Map([
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeModel(value) {
  return value.trim().replace(/^ultra\//, '')
}

function configuredModels(env) {
  const fallbacks = env.VISION_FALLBACK_MODELS ?? 'ultra/kimi-k2.7'
  return [env.VISION_MODEL || 'ultra/qwen3.6-27b', ...fallbacks.split(/[\s,]+/)]
    .filter(Boolean)
    .map(normalizeModel)
    .filter((model, index, all) => model && all.indexOf(model) === index)
}

async function loadApiKey({ cwd, env, verbooHome }) {
  if (env.VISION_API_KEY?.trim()) return env.VISION_API_KEY.trim()

  const candidates = [
    cwd && join(cwd, 'opencode.json'),
    join(homedir(), '.config', 'opencode', 'opencode.json'),
    join(verbooHome, 'opencode.json'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const config = JSON.parse(await readFile(candidate, 'utf8'))
      const apiKey = config.provider?.verboo?.options?.apiKey
      if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim()
    } catch {
      // Arquivo ausente ou inválido: tenta a próxima origem.
    }
  }

  return null
}

function extractDescription(body) {
  const content = body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text.trim())
    .filter(Boolean)
    .join('\n')
}

async function imageBlock(imagePath) {
  const extension = extname(imagePath).toLowerCase()
  const mimeType = imageMimeTypes.get(extension)
  if (!mimeType) throw new Error(`Formato de imagem não suportado: ${extension || '(sem extensão)'}`)
  const data = await readFile(imagePath)
  return {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${data.toString('base64')}` },
  }
}

export async function describeImages({
  imagePaths,
  question,
  cwd = process.cwd(),
  env = process.env,
  verbooHome = env.VERBOO_HOME || join(homedir(), '.verboo'),
}) {
  const startedAt = Date.now()
  const totalTimeoutMs = positiveInteger(env.VISION_TOTAL_TIMEOUT_MS, 60_000)
  const apiKey = await loadApiKey({ cwd, env, verbooHome })
  if (!apiKey) throw new Error('Credencial do router Verboo não encontrada.')

  const models = configuredModels(env)
  if (models.length === 0) throw new Error('Nenhum modelo de visão foi configurado.')

  const content = [
    { type: 'text', text: question || 'Descreva detalhadamente esta imagem.' },
    ...(await Promise.all(imagePaths.map(imageBlock))),
  ]
  const baseUrl = (env.VISION_BASE_URL || 'https://code.verboo.ai/router/v1').replace(/\/$/, '')
  const timeoutMs = positiveInteger(env.VISION_TIMEOUT_MS, 30_000)
  const maxTokens = positiveInteger(env.VISION_MAX_TOKENS, 1024)
  const failures = []

  for (const model of models) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      failures.push('limite total excedido')
      break
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content }],
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, remainingMs)),
      })

      if (!response.ok) {
        failures.push(`${model}: HTTP ${response.status}`)
        continue
      }

      const description = extractDescription(await response.json())
      if (!description) {
        failures.push(`${model}: resposta sem descrição`)
        continue
      }

      return { description, model: `ultra/${model}` }
    } catch (error) {
      failures.push(`${model}: ${error?.name === 'TimeoutError' ? 'timeout' : 'erro de rede ou resposta'}`)
    }
  }

  throw new Error(`Todos os modelos de visão falharam (${failures.join('; ')}).`)
}
