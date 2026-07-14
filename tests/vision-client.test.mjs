import assert from 'node:assert/strict'
import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  MAX_IMAGE_BYTES,
  MAX_RESPONSE_BYTES,
  VisionClientError,
  configuredApiKey,
  configuredModels,
  describeImages,
  doctorDiagnostic,
  runDoctor,
} from '../scripts/vision-client.mjs'
import { resolveVisionConfig } from '../scripts/vision-config.mjs'
import {
  createTempDirectory,
  pngFixture,
  readRequestBody,
  readRequestJson,
  startVisionServer,
  visionEnv,
} from './test-helpers.mjs'

function expectErrorCode(code) {
  return error => {
    assert.ok(error instanceof VisionClientError)
    assert.equal(error.code, code)
    return true
  }
}

async function captureDoctorFailure({ handler, envOverrides = {}, fetchImpl } = {}) {
  const server = handler ? await startVisionServer(handler) : null
  const home = await mkdtemp(join(tmpdir(), 'doctor-'))
  const env = visionEnv(home, server?.baseUrl ?? 'http://127.0.0.1:9/v1', {
    VISION_MODEL: 'ultra/doctor-primary',
    ...envOverrides,
  })

  try {
    await runDoctor({ env, fetchImpl })
    assert.fail('o doctor deveria falhar neste cenário')
  } catch (error) {
    return error
  } finally {
    await server?.close()
  }
}

test('prioriza VISION_* sobre opções do plugin e aceita api_key do plugin como fallback', async t => {
  const home = await createTempDirectory(t)
  const config = await resolveVisionConfig({
    VISION_API_KEY: 'vision-key',
    CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key',
    VISION_BASE_URL: 'https://vision.example.test/router/v1',
    CLAUDE_PLUGIN_OPTION_BASE_URL: 'https://plugin.example.test/v1',
    VISION_MODEL: 'ultra/early-adopters/Primary',
    CLAUDE_PLUGIN_OPTION_MODEL: 'plugin/model',
    VISION_FALLBACK_MODELS: 'vendor/Fallback another/Model',
    CLAUDE_PLUGIN_OPTION_FALLBACK_MODELS: 'plugin/fallback',
    VISION_TIMEOUT_MS: '123',
    CLAUDE_PLUGIN_OPTION_TIMEOUT_MS: '456',
    VISION_TOTAL_TIMEOUT_MS: '789',
    CLAUDE_PLUGIN_OPTION_TOTAL_TIMEOUT_MS: '999',
    VISION_MAX_TOKENS: '77',
    CLAUDE_PLUGIN_OPTION_MAX_TOKENS: '88',
  }, { home })

  assert.equal(config.apiKey, 'vision-key')
  assert.equal(config.baseUrl, 'https://vision.example.test/router/v1')
  assert.equal(config.primaryModel, 'ultra/early-adopters/Primary')
  assert.deepEqual(config.fallbackModels, ['vendor/Fallback', 'another/Model'])
  assert.equal(config.timeoutMs, 123)
  assert.equal(config.totalTimeoutMs, 789)
  assert.equal(config.maxTokens, 77)

  assert.equal(
    await configuredApiKey({
      VISION_API_KEY: ' ',
      CLAUDE_PLUGIN_OPTION_API_KEY: 'plugin-key',
    }),
    'plugin-key',
  )
  assert.equal(await configuredApiKey({}, { home }), null)
})

test('lê credencial do router Verboo a partir de opencode.json', async t => {
  const home = await createTempDirectory(t)
  const opencodePath = join(home, '.config', 'opencode')
  await mkdir(opencodePath, { recursive: true })
  await writeFile(
    join(opencodePath, 'opencode.json'),
    JSON.stringify({
      provider: {
        verboo: {
          options: {
            apiKey: 'vbk_test_123',
            baseURL: 'https://router.verboo.test/v1',
          },
        },
      },
    }),
  )

  const config = await resolveVisionConfig({}, { home })
  assert.equal(config.apiKey, 'vbk_test_123')
  assert.equal(config.baseUrl, 'https://router.verboo.test/v1')
  assert.equal(config.primaryModel, 'qwen3.6-27b')
})

test('preserva IDs de modelo opacos, a ordem e deduplica apenas valores idênticos', async t => {
  const home = await createTempDirectory(t)
  const primary = 'ultra/early-adopters/Kimi-K2.7'
  const fallback = 'vendor/Prévia-ß'
  const caseVariant = 'VENDOR/Prévia-ß'
  const env = {
    VISION_MODEL: primary,
    VISION_FALLBACK_MODELS: `${fallback} ${primary} ${fallback} ${caseVariant}`,
  }

  const models = await configuredModels(env, { home })
  assert.deepEqual(models, [primary, fallback, caseVariant])
  assert.equal(models[0], primary)
  assert.equal(models[1], fallback)
})

test('envia IDs configurados byte a byte, sem remover prefixos, e preserva fallback', async t => {
  const directory = await createTempDirectory(t, 'verboo-client-opaque-')
  const imagePath = join(directory, 'image.png')
  await writeFile(imagePath, pngFixture)

  const primary = 'ultra/early-adopters/Kimi-K2.7'
  const fallback = 'vendor/Prévia-ß'
  const requestedModels = []
  const rawBodies = []
  const server = await startVisionServer(async (request, response) => {
    const rawBody = await readRequestBody(request)
    const body = JSON.parse(rawBody)
    rawBodies.push(rawBody)
    requestedModels.push(body.model)

    if (body.model === primary) {
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end('{"error":{"message":"indisponível"}}')
      return
    }

    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'Primeira parte.' },
                { type: 'image_url', image_url: { url: 'ignorada' } },
                { type: 'output_text', text: 'Segunda parte.' },
              ],
            },
          },
        ],
      }),
    )
  })
  t.after(server.close)

  const result = await describeImages({
    imagePaths: [imagePath],
    question: 'O que a imagem contém?',
    env: visionEnv(undefined, server.baseUrl, {
      VISION_MODEL: primary,
      VISION_FALLBACK_MODELS: `${fallback} ${primary} ${fallback}`,
    }),
  })

  assert.equal(result.model, fallback)
  assert.equal(result.description, 'Primeira parte.\nSegunda parte.')
  assert.deepEqual(requestedModels, [primary, fallback])
  assert.deepEqual(
    requestedModels.map(model => Buffer.from(model, 'utf8')),
    [Buffer.from(primary, 'utf8'), Buffer.from(fallback, 'utf8')],
  )
  assert.match(rawBodies[0], new RegExp(JSON.stringify(primary)))
  assert.match(rawBodies[1], new RegExp(JSON.stringify(fallback)))
})

test('valida tamanho individual da imagem antes de chamar o endpoint', async t => {
  const directory = await createTempDirectory(t, 'verboo-client-size-')
  const imagePath = join(directory, 'too-large.png')
  await writeFile(imagePath, Buffer.alloc(MAX_IMAGE_BYTES + 1))

  let called = false
  await assert.rejects(
    describeImages({
      imagePaths: [imagePath],
      env: visionEnv(undefined, 'http://127.0.0.1:9/v1'),
      fetchImpl: async () => {
        called = true
        throw new Error('não deve chamar a rede')
      },
    }),
    expectErrorCode('image-too-large'),
  )
  assert.equal(called, false)
})

test('valida o limite total do conjunto antes de ler ou codificar imagens', async t => {
  const directory = await createTempDirectory(t, 'verboo-client-total-size-')
  const imagePaths = ['1.png', '2.png', '3.png'].map(fileName => join(directory, fileName))
  await Promise.all(imagePaths.map(imagePath => writeFile(imagePath, Buffer.alloc(0))))
  // Arquivos esparsos bastam: o cliente deve rejeitar pelo tamanho obtido via
  // lstat, antes de readFile/base64 e antes de qualquer chamada HTTP.
  await Promise.all(imagePaths.map(imagePath => truncate(imagePath, 7 * 1024 * 1024)))

  let called = false
  await assert.rejects(
    describeImages({
      imagePaths,
      env: visionEnv(undefined, 'http://127.0.0.1:9/v1'),
      fetchImpl: async () => {
        called = true
        throw new Error('não deve chamar a rede')
      },
    }),
    expectErrorCode('images-too-large'),
  )
  assert.equal(called, false)
})

test('limita o corpo HTTP recebido sem retornar conteúdo remoto bruto', async t => {
  const directory = await createTempDirectory(t, 'verboo-client-response-size-')
  const imagePath = join(directory, 'image.png')
  await writeFile(imagePath, pngFixture)
  const oversizedRemoteBody = 'x'.repeat(MAX_RESPONSE_BYTES + 1)
  await assert.rejects(
    describeImages({
      imagePaths: [imagePath],
      env: visionEnv(undefined, 'http://127.0.0.1:9/v1'),
      fetchImpl: async () =>
        new Response(oversizedRemoteBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    }),
    expectErrorCode('response-too-large'),
  )
})

test('doctor consulta /models e usa IDs canônicos na cadeia visual principal/fallback', async t => {
  const configuredPrimary = 'ULTRA/DOCTOR-PRIMARY'
  const canonicalPrimary = 'ultra/doctor-primary'
  const fallback = 'vendor/fallback'
  const requests = []
  const server = await startVisionServer(async (request, response) => {
    requests.push(request.url)
    if (request.url === '/v1/models') {
      assert.equal(request.method, 'GET')
      assert.equal(request.headers.authorization, 'Bearer test-key')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: canonicalPrimary }, { id: fallback }] }))
      return
    }

    assert.equal(request.url, '/v1/chat/completions')
    const body = await readRequestJson(request)
    assert.equal(body.messages[0].content[0].type, 'text')
    assert.match(body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/)
    assert.ok([canonicalPrimary, fallback].includes(body.model))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'Imagem mínima aceita.' } }] }))
  })
  t.after(server.close)

  const result = await runDoctor({
    env: visionEnv(undefined, server.baseUrl, {
      VISION_MODEL: configuredPrimary,
      VISION_FALLBACK_MODELS: fallback,
    }),
  })

  assert.equal(result.primaryModel, canonicalPrimary)
  assert.equal(result.testedModel, canonicalPrimary)
  assert.deepEqual(result.testedModels, [canonicalPrimary, fallback])
  assert.deepEqual(result.availableModels, [canonicalPrimary, fallback])
  assert.deepEqual(requests, ['/v1/models', '/v1/chat/completions', '/v1/chat/completions'])
})

test('doctor oferece diagnósticos distintos sem expor detalhes remotos', async t => {
  await t.test('chave ausente', async () => {
    const error = await captureDoctorFailure({
      envOverrides: { VISION_API_KEY: '', CLAUDE_PLUGIN_OPTION_API_KEY: '' },
    })
    assert.equal(error.code, 'credential')
    assert.match(doctorDiagnostic(error), /credencial.*não está configurada/i)
  })

  await t.test('modelo principal obrigatório ausente', async () => {
    const error = await captureDoctorFailure({
      envOverrides: { VISION_MODEL: '', CLAUDE_PLUGIN_OPTION_MODEL: '' },
    })
    assert.equal(error.code, 'model-required')
    assert.match(doctorDiagnostic(error), /modelo principal obrigatório/i)
  })

  await t.test('HTTP 401', async () => {
    const error = await captureDoctorFailure({
      handler: (_request, response) => {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"segredo remoto"}}')
      },
    })
    assert.equal(error.code, 'unauthenticated')
    assert.match(doctorDiagnostic(error), /HTTP 401/)
  })

  await t.test('HTTP 403', async () => {
    const error = await captureDoctorFailure({
      handler: (_request, response) => {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"segredo remoto"}}')
      },
    })
    assert.equal(error.code, 'forbidden')
    assert.match(doctorDiagnostic(error), /HTTP 403/)
  })

  await t.test('endpoint incompatível', async () => {
    const error = await captureDoctorFailure({
      handler: (_request, response) => {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"rota privada"}}')
      },
    })
    assert.equal(error.code, 'endpoint')
    assert.match(doctorDiagnostic(error), /compatível/i)
  })

  await t.test('JSON inválido', async () => {
    const error = await captureDoctorFailure({
      handler: (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":')
      },
    })
    assert.equal(error.code, 'invalid-json')
    assert.match(doctorDiagnostic(error), /JSON inválido/i)
  })

  await t.test('modelo ausente', async () => {
    const error = await captureDoctorFailure({
      handler: (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'another/model' }] }))
      },
    })
    assert.equal(error.code, 'model-missing')
    assert.match(doctorDiagnostic(error), /modelo configurado.*disponível/i)
  })

  await t.test('modelo rejeita imagem', async () => {
    const error = await captureDoctorFailure({
      handler: async (request, response) => {
        if (request.url === '/v1/models') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ data: [{ id: 'ultra/doctor-primary' }] }))
          return
        }
        await readRequestBody(request)
        response.writeHead(422, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"imagem não aceita"}}')
      },
    })
    assert.equal(error.code, 'image-rejected')
    assert.match(doctorDiagnostic(error), /rejeitou a imagem/i)
  })

  await t.test('erro de rede', async () => {
    const error = await captureDoctorFailure({
      fetchImpl: async () => {
        throw new Error('segredo de rede que não pode aparecer')
      },
    })
    assert.equal(error.code, 'network')
    assert.match(doctorDiagnostic(error), /alcançar/i)
    assert.doesNotMatch(doctorDiagnostic(error), /segredo de rede/i)
  })

  await t.test('timeout', async () => {
    const error = await captureDoctorFailure({
      envOverrides: {
        VISION_TIMEOUT_MS: '10',
        VISION_TOTAL_TIMEOUT_MS: '100',
      },
      fetchImpl: async () => {
        const timeout = new Error('a requisição expirou')
        timeout.name = 'TimeoutError'
        throw timeout
      },
    })
    assert.equal(error.code, 'timeout')
    assert.match(doctorDiagnostic(error), /tempo limite/i)
  })
})

test('doctor não mascara modelo principal que rejeita imagens com um fallback', async t => {
  const requestedModels = []
  const server = await startVisionServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'primary/no-vision' }, { id: 'fallback/vision' }] }))
      return
    }
    requestedModels.push((await readRequestJson(request)).model)
    response.writeHead(422, { 'content-type': 'application/json' })
    response.end('{"error":{"message":"imagem não aceita"}}')
  })
  t.after(server.close)

  await assert.rejects(
    runDoctor({
      env: visionEnv(undefined, server.baseUrl, {
        VISION_MODEL: 'primary/no-vision',
        VISION_FALLBACK_MODELS: 'fallback/vision',
      }),
    }),
    expectErrorCode('image-rejected'),
  )
  assert.deepEqual(requestedModels, ['primary/no-vision'])
})

test('limita AbortError por tentativa, usa fallback e respeita o deadline total', async t => {
  const directory = await createTempDirectory(t, 'verboo-client-timeout-')
  const imagePath = join(directory, 'image.png')
  await writeFile(imagePath, pngFixture)

  const attemptedModels = []
  const fallbackResult = await describeImages({
    imagePaths: [imagePath],
    env: visionEnv(undefined, 'http://127.0.0.1:9/v1', {
      VISION_MODEL: 'primary/slow-model',
      VISION_FALLBACK_MODELS: 'fallback/fast-model',
      VISION_TIMEOUT_MS: '20',
      VISION_TOTAL_TIMEOUT_MS: '300',
    }),
    fetchImpl: async (_url, init) => {
      const model = JSON.parse(init.body).model
      attemptedModels.push(model)
      if (model === 'primary/slow-model') {
        const error = new Error('aborted by request deadline')
        error.name = 'AbortError'
        throw error
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Fallback dentro do prazo.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    },
  })

  assert.equal(fallbackResult.model, 'fallback/fast-model')
  assert.deepEqual(attemptedModels, ['primary/slow-model', 'fallback/fast-model'])

  const totalAttempts = []
  await assert.rejects(
    describeImages({
      imagePaths: [imagePath],
      env: visionEnv(undefined, 'http://127.0.0.1:9/v1', {
        VISION_MODEL: 'primary/slow-model',
        VISION_FALLBACK_MODELS: 'fallback/fast-model',
        VISION_TIMEOUT_MS: '1000',
        VISION_TOTAL_TIMEOUT_MS: '20',
      }),
      fetchImpl: async (_url, init) => {
        totalAttempts.push(JSON.parse(init.body).model)
        await new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('total deadline elapsed')
            error.name = 'TimeoutError'
            reject(error)
          })
        })
        return new Response('{}', { status: 200 })
      },
    }),
    expectErrorCode('total-timeout'),
  )
  assert.deepEqual(totalAttempts, ['primary/slow-model'])
})
