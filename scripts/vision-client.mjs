import { lstat, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import {
  configFromEnv,
  resolveVisionConfig,
  validateVisionConfig,
} from './vision-config.mjs'
import { imageMimeTypes } from './cache.mjs'
import { doctorFixture } from './doctor-fixture.mjs'

export { imageMimeTypes }

// The limits are deliberately conservative for a hook process. They are
// applied before base64 encoding, so encoded data never becomes the first
// memory-boundary check.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_COUNT = 32
export const MAX_RESPONSE_BYTES = 1024 * 1024

const DEFAULT_QUESTION = 'Descreva detalhadamente esta imagem.'

export class VisionClientError extends Error {
  constructor(code, message = 'A solicitação de visão falhou.', options = {}) {
    super(message)
    this.name = 'VisionClientError'
    this.code = code
    this.status = options.status
  }
}

function publicMessage(code) {
  const messages = {
    credential: 'A credencial da API não está configurada.',
    config: 'A configuração de visão é inválida.',
    image: 'A imagem não pôde ser lida com segurança.',
    'image-too-large': 'Uma imagem excede o limite permitido.',
    'images-too-large': 'O conjunto de imagens excede o limite permitido.',
    'response-too-large': 'A resposta do endpoint excede o limite permitido.',
    'invalid-json': 'O endpoint retornou JSON inválido.',
    endpoint: 'O endpoint não é compatível com a API OpenAI de visão.',
    unauthenticated: 'O endpoint recusou a credencial (HTTP 401).',
    forbidden: 'A credencial não tem permissão para esse endpoint (HTTP 403).',
    'model-required': 'O modelo principal obrigatório não está configurado.',
    'model-missing': 'Um modelo configurado não está disponível no endpoint.',
    'image-rejected': 'O modelo rejeitou a imagem enviada.',
    http: 'O endpoint retornou uma resposta HTTP não bem-sucedida.',
    network: 'Não foi possível alcançar o endpoint de visão.',
    timeout: 'A tentativa de visão excedeu o tempo limite.',
    'total-timeout': 'O prazo total de visão foi excedido.',
    models: 'Nenhum modelo de visão configurado produziu uma descrição.',
  }
  return messages[code] ?? 'A solicitação de visão falhou.'
}

function clientError(code, options) {
  return new VisionClientError(code, publicMessage(code), options)
}

function isTimeoutError(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
}

function remainingMs(deadlineAt) {
  return deadlineAt - Date.now()
}

function requestTimeout(deadlineAt, timeoutMs) {
  const remaining = remainingMs(deadlineAt)
  if (remaining <= 0) throw clientError('total-timeout')
  return Math.max(1, Math.min(timeoutMs, remaining))
}

function timeoutCode(deadlineAt) {
  return remainingMs(deadlineAt) <= 1 ? 'total-timeout' : 'timeout'
}

function httpError(status, operation) {
  if (status === 401) return clientError('unauthenticated', { status })
  if (status === 403) return clientError('forbidden', { status })
  if (operation === 'models' && [400, 404, 405, 406, 415, 422].includes(status)) {
    return clientError('endpoint', { status })
  }
  if (operation === 'chat' && [404, 405, 406].includes(status)) {
    return clientError('endpoint', { status })
  }
  // During doctor, a known model that answers a minimal multimodal Chat
  // Completions request with these statuses has rejected the image payload.
  if (operation === 'chat' && [400, 415, 422].includes(status)) {
    return clientError('image-rejected', { status })
  }
  return clientError('http', { status })
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers?.get?.('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try {
      await response.body?.cancel?.()
    } catch {
      // The body is being discarded because it is already too large.
    }
    throw clientError('response-too-large')
  }

  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel()
        } catch {
          // Best effort; never surface a remote body.
        }
        throw clientError('response-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function readJsonResponse(response) {
  const text = await readLimitedText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw clientError('invalid-json')
  }
}

async function requestJson({
  fetchImpl,
  url,
  method,
  apiKey,
  body,
  deadlineAt,
  timeoutMs,
  operation,
}) {
  const timeout = requestTimeout(deadlineAt, timeoutMs)
  let response
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeout),
      // Do not forward a bearer credential to a redirect target.
      redirect: 'error',
    })
  } catch (error) {
    if (error instanceof VisionClientError) throw error
    if (isTimeoutError(error)) throw clientError(timeoutCode(deadlineAt))
    throw clientError('network', { cause: error })
  }

  if (!response.ok) throw httpError(response.status, operation)

  try {
    return await readJsonResponse(response)
  } catch (error) {
    if (error instanceof VisionClientError) throw error
    if (isTimeoutError(error)) throw clientError(timeoutCode(deadlineAt))
    throw clientError('network', { cause: error })
  }
}

function assertConfig(config, options) {
  const issues = validateVisionConfig(config, options)
  if (issues.length === 0) return
  if (issues.includes('api_key is missing')) throw clientError('credential')
  if (issues.includes('model is missing')) throw clientError('model-required')
  throw clientError('config')
}

async function readImageBlocks(imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw clientError('image')
  }
  if (imagePaths.length > MAX_IMAGE_COUNT) throw clientError('images-too-large')

  const inspected = []
  let totalBytes = 0
  for (const imagePath of imagePaths) {
    if (typeof imagePath !== 'string' || imagePath.length === 0) {
      throw clientError('image')
    }
    const extension = extname(imagePath).toLowerCase()
    const mimeType = imageMimeTypes.get(extension)
    if (!mimeType) throw clientError('image')

    let fileStat
    try {
      // lstat rejects symlinks for manual CLI inputs as well. Cache paths have
      // their own containment checks, but this keeps the transport invariant
      // simple: only a regular file is ever read.
      fileStat = await lstat(imagePath)
    } catch {
      throw clientError('image')
    }
    if (!fileStat.isFile()) throw clientError('image')
    if (fileStat.size > MAX_IMAGE_BYTES) throw clientError('image-too-large')
    totalBytes += fileStat.size
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw clientError('images-too-large')
    inspected.push({ imagePath, mimeType, expectedSize: fileStat.size })
  }

  const blocks = []
  for (const image of inspected) {
    let data
    try {
      data = await readFile(image.imagePath)
    } catch {
      // A cache file may disappear after discovery. Do not return a partial
      // request or disclose the path.
      throw clientError('image')
    }
    if (data.byteLength > MAX_IMAGE_BYTES) throw clientError('image-too-large')
    if (data.byteLength > image.expectedSize) {
      // A file changing between stat and read can otherwise bypass the total
      // cap. Recompute against all bytes read before base64 encoding.
      totalBytes += data.byteLength - image.expectedSize
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) throw clientError('images-too-large')
    }
    blocks.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${data.toString('base64')}`,
      },
    })
  }
  return blocks
}

export function extractDescription(body) {
  const content = body?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      part =>
        part &&
        (part.type === 'text' || part.type === 'output_text') &&
        typeof part.text === 'string',
    )
    .map(part => part.text.trim())
    .filter(Boolean)
    .join('\n')
}

function sanitizeDescription(description, apiKey) {
  let safe = description
  if (apiKey) safe = safe.replaceAll(apiKey, '[redacted]')
  // A compliant endpoint should never echo the request, but avoid returning a
  // credential-bearing or image-bearing fragment if it does.
  safe = safe.replace(/data:[^\s"']+;base64,[A-Za-z0-9+/=]+/gi, '[redacted data]')
  safe = safe.replace(/\b[A-Za-z0-9+/]{128,}={0,2}\b/g, '[redacted binary]')
  safe = safe.replace(/\b(?:authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, '[redacted credential]')
  safe = safe.replace(/\b(?:sk|rk|pk|api|key|token)[_-][A-Za-z0-9._-]{8,}\b/gi, '[redacted credential]')
  return safe
}

export async function configuredApiKey(env = process.env, options = {}) {
  return (await resolveVisionConfig(env, options)).apiKey
}

export async function configuredModels(env = process.env, options = {}) {
  return (await resolveVisionConfig(env, options)).models
}

/**
 * Calls the configured OpenAI-compatible Chat Completions endpoint. Models are
 * used exactly as supplied by configuration (or by the doctor's canonical
 * `/models` result); no prefix is removed or substituted.
 */
async function describePreparedImages({
  imageBlocks,
  question,
  env = process.env,
  config,
  models,
  deadlineAt,
  fetchImpl = fetch,
}) {
  if (!config) config = await configFromEnv(env)
  if (!models) models = config.models
  assertConfig(config)
  const uniqueModels = [...new Set(models.filter(model => typeof model === 'string' && model.trim() !== ''))]
  if (uniqueModels.length === 0) throw clientError('config')

  const effectiveDeadline = deadlineAt ?? Date.now() + config.totalTimeoutMs
  if (remainingMs(effectiveDeadline) <= 0) throw clientError('total-timeout')
  if (!Array.isArray(imageBlocks) || imageBlocks.length === 0) {
    throw clientError('image')
  }
  const content = [
    { type: 'text', text: question || DEFAULT_QUESTION },
    ...imageBlocks,
  ]
  const failures = []

  for (const model of uniqueModels) {
    if (remainingMs(effectiveDeadline) <= 0) {
      throw clientError('total-timeout')
    }
    try {
      const body = await requestJson({
        fetchImpl,
        url: config.chatUrl,
        method: 'POST',
        apiKey: config.apiKey,
        body: {
          model,
          messages: [{ role: 'user', content }],
          max_tokens: config.maxTokens,
        },
        deadlineAt: effectiveDeadline,
        timeoutMs: config.timeoutMs,
        operation: 'chat',
      })
      const description = sanitizeDescription(extractDescription(body), config.apiKey)
      if (description) return { description, model }
      failures.push('empty-description')
    } catch (error) {
      if (!(error instanceof VisionClientError)) throw clientError('network', { cause: error })
      if (['credential', 'config', 'unauthenticated', 'forbidden', 'endpoint', 'total-timeout'].includes(error.code)) {
        throw error
      }
      failures.push(error.code)
    }
  }

  const uniqueFailures = new Set(failures)
  if (uniqueFailures.size === 1 && uniqueFailures.has('image-rejected')) {
    throw clientError('image-rejected')
  }
  if (uniqueFailures.size === 1 && uniqueFailures.has('invalid-json')) {
    throw clientError('invalid-json')
  }
  if (uniqueFailures.size === 1 && uniqueFailures.has('response-too-large')) {
    throw clientError('response-too-large')
  }
  if (uniqueFailures.size === 1 && uniqueFailures.has('timeout')) {
    throw clientError('timeout')
  }
  throw clientError('models')
}

export async function describeImages({
  imagePaths,
  question,
  env = process.env,
  config,
  models,
  deadlineAt,
  fetchImpl = fetch,
}) {
  if (!config) config = await configFromEnv(env)
  if (!models) models = config.models
  assertConfig(config)
  const effectiveDeadline = deadlineAt ?? Date.now() + config.totalTimeoutMs
  if (remainingMs(effectiveDeadline) <= 0) throw clientError('total-timeout')
  const imageBlocks = await readImageBlocks(imagePaths)
  return describePreparedImages({
    imageBlocks,
    question,
    env,
    config,
    models,
    deadlineAt: effectiveDeadline,
    fetchImpl,
  })
}

export async function listModels({
  env = process.env,
  config,
  deadlineAt,
  fetchImpl = fetch,
}) {
  if (!config) config = await configFromEnv(env)
  assertConfig(config)
  const effectiveDeadline = deadlineAt ?? Date.now() + config.totalTimeoutMs
  const body = await requestJson({
    fetchImpl,
    url: config.modelsUrl,
    method: 'GET',
    apiKey: config.apiKey,
    deadlineAt: effectiveDeadline,
    timeoutMs: config.timeoutMs,
    operation: 'models',
  })
  if (!Array.isArray(body?.data)) throw clientError('endpoint')
  const ids = body.data
    .map(entry => entry?.id)
    .filter(id => typeof id === 'string' && id.length > 0)
  if (ids.length === 0 && body.data.length > 0) throw clientError('endpoint')
  return ids
}

/**
 * Match exactly whenever possible. Case-insensitive matching is a narrowly
 * scoped discovery convenience: the subsequent inference is sent using the
 * canonical ID returned by the server, never a case-rewritten local value.
 */
export function canonicalizeConfiguredModels(configuredModels, availableIds) {
  const canonical = []
  for (const configured of configuredModels) {
    if (typeof configured !== 'string') throw clientError('model-missing')
    const exact = availableIds.find(id => id === configured)
    if (exact) {
      canonical.push(exact)
      continue
    }
    const insensitive = availableIds.filter(
      id => id.toLowerCase() === configured.toLowerCase(),
    )
    if (insensitive.length === 1) {
      canonical.push(insensitive[0])
      continue
    }
    throw clientError('model-missing')
  }
  return canonical
}

/**
 * The explicit doctor shares one deadline across `/models` and a minimal
 * multimodal inference for every configured model. It validates all IDs for
 * availability and proves that each one accepts the fixture image.
 */
export async function runDoctor({ env = process.env, fetchImpl = fetch } = {}) {
  const config = await configFromEnv(env)
  assertConfig(config)
  const deadlineAt = Date.now() + config.totalTimeoutMs
  const availableIds = await listModels({ config, deadlineAt, fetchImpl })
  const canonicalModels = canonicalizeConfiguredModels(config.models, availableIds)
  const testedModels = []
  for (const model of canonicalModels) {
    const result = await describePreparedImages({
      imageBlocks: [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${doctorFixture.toString('base64')}`,
          },
        },
      ],
      question: 'Descreva esta imagem mínima em uma frase curta.',
      config,
      models: [model],
      deadlineAt,
      fetchImpl,
    })
    testedModels.push(result.model)
  }

  // Keep the fixture in memory so doctor cannot depend on cache state or a
  // temporary path. It still uses the same request/deadline path as normal
  // image descriptions after file validation.
  return {
    primaryModel: canonicalModels[0],
    testedModel: testedModels[0],
    testedModels,
    availableModels: canonicalModels,
  }
}

/**
 * Publicly safe, actionable diagnostics for the manual doctor command. It
 * intentionally excludes endpoint URLs, headers, remote error bodies, image
 * payloads and local paths.
 */
export function doctorDiagnostic(error) {
  if (error instanceof VisionClientError) return publicMessage(error.code)
  return 'Não foi possível concluir o diagnóstico de visão.'
}
