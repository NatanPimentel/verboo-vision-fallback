import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// These defaults do not choose a provider credential or model. They only keep
// the OpenAI-compatible transport bounded when the user has configured a
// credential and a model.
export const DEFAULT_BASE_URL = 'https://code.verboo.ai/router/v1'
export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_TOTAL_TIMEOUT_MS = 55_000
export const DEFAULT_MAX_TOKENS = 1_024

export const MAX_TIMEOUT_MS = 55_000
export const MAX_TOTAL_TIMEOUT_MS = 55_000
export const MAX_TOKENS = 32_768

function asString(value) {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : String(value)
}

function nonBlank(value) {
  return value !== undefined && value.trim() !== ''
}

/**
 * Runtime overrides deliberately win over values injected by the plugin host.
 * Empty strings are treated as unset so a blank shell variable cannot disable a
 * correctly configured sensitive plugin option by accident.
 */
function optionValue(env, visionName, pluginName, fallback = '') {
  const direct = asString(env[visionName])
  if (nonBlank(direct)) return direct

  const plugin = asString(env[`CLAUDE_PLUGIN_OPTION_${pluginName}`])
  if (nonBlank(plugin)) return plugin

  return fallback
}

/**
 * Parse the documented comma/whitespace-separated fallback field without
 * rewriting IDs. JSON arrays are also accepted for programmatic callers and
 * preserve every nonblank string byte-for-byte.
 */
export function parseModelList(value) {
  if (Array.isArray(value)) {
    return value
      .map(asString)
      .filter(nonBlank)
  }

  const raw = asString(value)
  if (!nonBlank(raw)) return []

  if (raw.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parseModelList(parsed)
    } catch {
      // Continue with the documented delimiter format.
    }
  }

  return raw.split(/[\s,]+/).filter(Boolean)
}

function integerOption(value, fallback, minimum, maximum, issues, label) {
  const raw = asString(value)
  if (!nonBlank(raw)) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issues.push(`${label} is invalid`)
    return fallback
  }
  return parsed
}

export function resolveConfigRoot(env = process.env, home = homedir()) {
  const configured = asString(env.VERBOO_CONFIG_DIR)
  if (nonBlank(configured)) return resolve(configured.normalize('NFC'))

  const legacy = asString(env.VERBOO_HOME)
  if (nonBlank(legacy)) return resolve(legacy.normalize('NFC'))

  return resolve(join(home, '.verboo').normalize('NFC'))
}

export function parseBaseUrl(value) {
  const raw = asString(value)
  let url
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'base URL is invalid' }
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return { ok: false, reason: 'base URL is invalid' }
  }

  let pathname = url.pathname.replace(/\/+$/, '')
  for (const suffix of ['/chat/completions', '/models']) {
    if (pathname.endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, '')
      break
    }
  }

  const root = `${url.origin}${pathname}`
  const baseUrl = root || url.origin
  return {
    ok: true,
    baseUrl,
    chatUrl: `${baseUrl}/chat/completions`,
    modelsUrl: `${baseUrl}/models`,
  }
}

export function resolveVisionConfig(env = process.env) {
  const issues = []
  const base = parseBaseUrl(
    optionValue(env, 'VISION_BASE_URL', 'BASE_URL', DEFAULT_BASE_URL),
  )
  if (!base.ok) issues.push(base.reason)

  const timeoutMs = integerOption(
    optionValue(env, 'VISION_TIMEOUT_MS', 'TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)),
    DEFAULT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
    issues,
    'timeout_ms',
  )
  const totalTimeoutMs = integerOption(
    optionValue(
      env,
      'VISION_TOTAL_TIMEOUT_MS',
      'TOTAL_TIMEOUT_MS',
      String(DEFAULT_TOTAL_TIMEOUT_MS),
    ),
    DEFAULT_TOTAL_TIMEOUT_MS,
    1,
    MAX_TOTAL_TIMEOUT_MS,
    issues,
    'total_timeout_ms',
  )
  const maxTokens = integerOption(
    optionValue(env, 'VISION_MAX_TOKENS', 'MAX_TOKENS', String(DEFAULT_MAX_TOKENS)),
    DEFAULT_MAX_TOKENS,
    1,
    MAX_TOKENS,
    issues,
    'max_tokens',
  )

  const primaryModel = optionValue(env, 'VISION_MODEL', 'MODEL', '')
  const fallbackModels = parseModelList(
    optionValue(env, 'VISION_FALLBACK_MODELS', 'FALLBACK_MODELS', ''),
  )
  const models = [primaryModel, ...fallbackModels]
    .filter(nonBlank)
    .filter((model, index, all) => all.indexOf(model) === index)
  const apiKey = optionValue(env, 'VISION_API_KEY', 'API_KEY', '').trim() || null

  return {
    apiKey,
    baseUrl: base.ok ? base.baseUrl : null,
    chatUrl: base.ok ? base.chatUrl : null,
    modelsUrl: base.ok ? base.modelsUrl : null,
    primaryModel: nonBlank(primaryModel) ? primaryModel : '',
    fallbackModels,
    models,
    timeoutMs,
    totalTimeoutMs,
    maxTokens,
    issues,
  }
}

export function validateVisionConfig(
  config,
  { requireCredential = true, requireModel = true } = {},
) {
  const issues = [...config.issues]
  if (requireCredential && !config.apiKey) issues.push('api_key is missing')
  if (requireModel && !nonBlank(config.primaryModel)) issues.push('model is missing')
  return [...new Set(issues)]
}

export function configFromEnv(env = process.env) {
  return {
    ...resolveVisionConfig(env),
    configRoot: resolveConfigRoot(env),
  }
}
